// api/stripe-webhook.js
import Stripe from "stripe";
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";

// Use your existing Stripe API version (adjust if needed)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

// Dev-only sanity logs (safe to keep; redact in prod if you prefer)
console.log("[wh] env:", process.env.VERCEL_ENV || "local");
console.log("[wh] using secret suffix:", (process.env.STRIPE_WEBHOOK_SECRET || "").slice(-8));

/**
 * Important: preserve the raw request body (Vercel Node serverless).
 * If you run locally, prefer `vercel dev` rather than Vite proxying, which can alter the body.
 */
export const config = { api: { bodyParser: false } };

// Read raw stream without modifying bytes
async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  // Stripe signature header must be present
  const sig = req.headers["stripe-signature"];
  console.log("[wh] sig header present:", Boolean(sig));

  let rawBuf;
  try {
    rawBuf = await buffer(req);
    console.log(
      "[wh] raw length =",
      rawBuf.length,
      "first 80 chars:",
      rawBuf.toString("utf8").slice(0, 80)
    );
  } catch (e) {
    console.error("[wh] ❌ Failed to read raw body:", e);
    return res.status(400).send("Invalid body");
  }

  // Verify signature against the EXACT raw bytes
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBuf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("[wh] ❌ Signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log("[wh] received", event.type);

  try {
    await handleEvent(event);
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[wh] ❌ Handler error:", err);
    return res.status(500).json({ error: "Webhook handler failed" });
  }
}

async function handleEvent(event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object;
      console.log("[wh] checkout.session.completed", {
        id: s.id,
        mode: s.mode,
        customer: s.customer,
      });

      // 1) Ensure customer mapping exists (capture email and optionally user_id if passed)
      await upsertCustomer({
        stripe_customer_id: s.customer,
        email: s.customer_details?.email ?? s.customer_email ?? null,
        user_id: s.client_reference_id || s.metadata?.user_id || null,
      });

      // 2) If subscription checkout, fetch full subscription and upsert it
      if (s.mode === "subscription" && s.subscription) {
        const sub = await stripe.subscriptions.retrieve(s.subscription, {
          expand: ["items.data.price.product"],
        });
        await upsertSubscription(sub);
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      console.log("[wh]", event.type, { id: sub.id, status: sub.status, customer: sub.customer });

      // Ensure we have a customer mapping (in case this arrives first)
      await upsertCustomer({
        stripe_customer_id: sub.customer,
        email: null,
        user_id: null,
      });

      await upsertSubscription(sub);
      break;
    }

    case "invoice.paid": {
      // Optional billing signal; useful for debugging flow
      const inv = event.data.object;
      console.log("[wh] invoice.paid", { id: inv.id, customer: inv.customer });
      break;
    }

    default:
      console.log("[wh] ignored event", event.type);
  }
}

/**
 * Upserts into app_stripe_customers.
 * Your existing schema uses "customer_id" (keep it) instead of "stripe_customer_id".
 *
 * Table shape assumed:
 *   app_stripe_customers (
 *     customer_id text primary key,
 *     user_id uuid null,
 *     email text,
 *     created_at timestamptz default now(),
 *     updated_at timestamptz default now()
 *   )
 */
async function upsertCustomer({ stripe_customer_id, email, user_id }) {
  if (!stripe_customer_id) return;

  const payload = {
    customer_id: stripe_customer_id, // keep your column name
    email: email ?? null,
    updated_at: new Date().toISOString(),
  };
  if (user_id) payload.user_id = user_id;

  const { data, error } = await supabaseAdmin
    .from("app_stripe_customers")
    .upsert(payload, { onConflict: "customer_id" })
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[wh] upsertCustomer error", error);
    throw error;
  }
  console.log("[wh] ✅ upserted customer", stripe_customer_id, "→ user", data?.user_id || user_id || null);
}

/**
 * Upserts into app_subscriptions using the subscription's own id.
 *
 * Table shape assumed:
 *   app_subscriptions (
 *     stripe_subscription_id text primary key,
 *     user_id uuid not null,
 *     status text not null,
 *     current_period_end timestamptz,
 *     price_id text,
 *     product_id text,
 *     cancel_at_period_end boolean default false,
 *     trial_end timestamptz,
 *     created_at timestamptz default now(),
 *     updated_at timestamptz default now()
 *   )
 */
async function upsertSubscription(sub) {
  const stripe_subscription_id = sub.id;
  const stripe_customer_id = sub.customer;
  const status = sub.status;
  const current_period_end = sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;
  const price_id = sub.items?.data?.[0]?.price?.id ?? null;
  const product_id = sub.items?.data?.[0]?.price?.product?.id ?? null;
  const cancel_at_period_end = !!sub.cancel_at_period_end;
  const trial_end = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;

  // Resolve user_id from the customer mapping
  const { data: custRow, error: custErr } = await supabaseAdmin
    .from("app_stripe_customers")
    .select("user_id")
    .eq("customer_id", stripe_customer_id)
    .maybeSingle();

  if (custErr) {
    console.error("[wh] customer lookup error", custErr);
    throw custErr;
  }

  const user_id = custRow?.user_id;
  if (!user_id) {
    console.warn("[wh] ⚠ No user_id for stripe_customer_id", stripe_customer_id, "—skipping subscription upsert");
    return; // Optionally queue a retry once user_id is known
  }

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
    console.error("[wh] upsertSubscription error", subErr);
    throw subErr;
  }
  console.log("[wh] ✅ upserted subscription", stripe_subscription_id, "for user", user_id, "status", status);
}
