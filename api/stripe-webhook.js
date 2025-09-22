// api/stripe-webhook.js
import Stripe from "stripe";
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

export const config = { api: { bodyParser: false } };

// Read raw stream without modifying bytes (needed for Stripe signature)
async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function tsToIso(ts) {
  return typeof ts === "number" ? new Date(ts * 1000).toISOString() : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).send("Missing Stripe-Signature");

  let rawBuf;
  try {
    rawBuf = await buffer(req);
  } catch (e) {
    console.error("[wh] ❌ Failed to read raw body:", e);
    return res.status(400).send("Invalid body");
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBuf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[wh] ❌ Signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    await handleEvent(event);
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[wh] ❌ Handler error:", err);
    // 400 so Stripe retries if we failed transiently
    return res.status(400).json({ error: "Webhook handler failed" });
  }
}

async function handleEvent(event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object;
      const user_id = s.client_reference_id || s.metadata?.user_id || null;
      const stripe_customer_id = s.customer || null;
      const email = s.customer_details?.email ?? s.customer_email ?? null;

      // 1) Make sure we store the customer → user mapping as early as possible
      await upsertCustomer({
        stripe_customer_id,
        email,
        user_id,
      });

      // 2) If this was a subscription checkout, upsert subscription immediately
      if (s.mode === "subscription" && s.subscription) {
        const sub = await stripe.subscriptions.retrieve(s.subscription, {
          expand: ["items.data.price.product"],
        });
        await upsertSubscription(sub, user_id); // pass user hint
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      await upsertSubscription(sub); // no user hint here; function will resolve mapping/fallbacks
      break;
    }

    case "invoice.paid":
    case "invoice.payment_failed":
    case "customer.subscription.trial_will_end":
      // Optional to log
      break;

    default:
      // Ignore other events
      break;
  }
}

/**
 * Upsert Stripe customer mapping
 * Table: app_stripe_customers (customer_id PK, user_id, email, updated_at)
 */
async function upsertCustomer({ stripe_customer_id, email, user_id }) {
  if (!stripe_customer_id) return;

  const payload = {
    customer_id: stripe_customer_id,
    email: email ?? null,
    updated_at: new Date().toISOString(),
  };
  if (user_id) payload.user_id = user_id;

  const { error } = await supabaseAdmin
    .from("app_stripe_customers")
    .upsert(payload, { onConflict: "customer_id" });

  if (error) {
    console.error("[wh] upsertCustomer error:", error);
    throw error;
  }
}

/**
 * Upsert subscription + entitlements.
 * - Will resolve user_id in this order:
 *   1) explicit userHint (from checkout.session.completed)
 *   2) subscription.metadata.user_id
 *   3) mapping table app_stripe_customers by customer_id
 *
 * Tables:
 *   app_subscriptions (
 *     stripe_subscription_id text PK,
 *     user_id uuid NOT NULL,
 *     status text NOT NULL,
 *     current_period_end timestamptz,
 *     price_id text,
 *     product_id text,
 *     cancel_at_period_end boolean,
 *     trial_end timestamptz,
 *     updated_at timestamptz
 *   )
 *
 *   entitlements (
 *     user_id uuid PK,
 *     is_pro boolean,
 *     status text,
 *     current_period_end timestamptz,
 *     updated_at timestamptz
 *   )
 */
async function upsertSubscription(sub, userHint = null) {
  const stripe_subscription_id = sub.id;
  const stripe_customer_id = sub.customer;
  const status = sub.status;
  const current_period_end = tsToIso(sub.current_period_end);
  const price_id = sub.items?.data?.[0]?.price?.id ?? null;
  const product_id = sub.items?.data?.[0]?.price?.product?.id ?? null;
  const cancel_at_period_end = !!sub.cancel_at_period_end;
  const trial_end = tsToIso(sub.trial_end);

  // ---- Resolve user_id ----
  let user_id = userHint || sub.metadata?.user_id || null;

  if (!user_id && stripe_customer_id) {
    const { data: custRow, error: custErr } = await supabaseAdmin
      .from("app_stripe_customers")
      .select("user_id")
      .eq("customer_id", stripe_customer_id)
      .maybeSingle();

    if (custErr) {
      console.error("[wh] customer lookup error:", custErr);
      throw custErr;
    }
    user_id = custRow?.user_id || null;
  }

  if (!user_id) {
    // Do not throw; just log and let Stripe retry—mapping may arrive shortly.
    console.warn("[wh] ⚠ No user_id for subscription", stripe_subscription_id, "customer", stripe_customer_id);
    return;
  }

  // ---- Upsert app_subscriptions ----
  const { error: subErr } = await supabaseAdmin
    .from("app_subscriptions")
    .upsert(
      {
        stripe_subscription_id,
        user_id,
        status,
        current_period_end,
        price_id,
        product_id,
        cancel_at_period_end,
        trial_end,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id" }
    );

  if (subErr) {
    console.error("[wh] upsertSubscription error:", subErr);
    throw subErr;
  }

  // ---- Upsert entitlements (optional but recommended) ----
  const is_pro = status === "active" || status === "trialing";
  const { error: entErr } = await supabaseAdmin
    .from("entitlements")
    .upsert(
      {
        user_id,
        is_pro,
        status,
        current_period_end,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (entErr) {
    console.error("[wh] upsertEntitlements error:", entErr);
    throw entErr;
  }
}
