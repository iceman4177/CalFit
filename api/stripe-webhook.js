// api/stripe-webhook.js
import Stripe from "stripe";
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

// Dev-only: quick sanity that we're using the intended secret
console.log("[wh] using secret suffix:", (process.env.STRIPE_WEBHOOK_SECRET || "").slice(-8));

export const config = { api: { bodyParser: false } };

// Read raw stream (Vercel Node serverless)
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

  const sig = req.headers["stripe-signature"];
  let event;
  try {
    const buf = await buffer(req);
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
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
      console.log("[wh] checkout.session.completed", { id: s.id, mode: s.mode, customer: s.customer });

      // 1) Ensure customer mapping exists (capture email and ideally user_id if present in metadata/client_reference_id)
      await upsertCustomer({
        stripe_customer_id: s.customer,
        email: s.customer_details?.email ?? s.customer_email ?? null,
        // If you pass user_id via client_reference_id or metadata at checkout, capture it:
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

      // Make sure customer mapping exists (in case this event arrives before checkout.completed)
      await upsertCustomer({
        stripe_customer_id: sub.customer,
        email: null,
        user_id: null, // we may or may not know it here; that's okay
      });

      await upsertSubscription(sub);
      break;
    }

    case "invoice.paid": {
      // Optional: keep an eye on successful payments if you want to update period_end or status
      const inv = event.data.object;
      console.log("[wh] invoice.paid", { id: inv.id, customer: inv.customer });
      break;
    }

    default:
      console.log("[wh] ignored event", event.type);
  }
}

/**
 * Upserts a row in app_stripe_customers
 * Expects a schema like:
 *   app_stripe_customers (
 *     stripe_customer_id text primary key,
 *     user_id uuid null,
 *     email text,
 *     created_at timestamptz default now(),
 *     updated_at timestamptz default now()
 *   )
 *
 * If your table currently uses `customer_id` instead of `stripe_customer_id`, you can keep it,
 * but consider standardizing to `stripe_customer_id` for clarity.
 */
async function upsertCustomer({ stripe_customer_id, email, user_id }) {
  if (!stripe_customer_id) return;

  // Build payload using your column names (your current code uses "customer_id")
  const payload = {
    customer_id: stripe_customer_id, // <-- keep your existing column name to avoid a migration right now
    email: email ?? null,
    updated_at: new Date().toISOString(),
  };
  if (user_id) payload.user_id = user_id; // add user mapping if we have it

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
 * Upserts a row in app_subscriptions tied to the user's id, not just the customer.
 * Expects a schema like:
 *   app_subscriptions (
 *     stripe_subscription_id text primary key,
 *     user_id uuid not null,
 *     status text not null,
 *     current_period_end timestamptz,
 *     price_id text,
 *     product_id text,
 *     cancel_at_period_end boolean default false,
 *     trial_end timestamptz null,
 *     created_at timestamptz default now(),
 *     updated_at timestamptz default now()
 *   )
 *
 * If your table currently uses "customer_id" as the key, switch to "stripe_subscription_id"
 * (or at least set onConflict to "stripe_subscription_id")—customers can have multiple subs.
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

  // 1) Resolve user_id from app_stripe_customers mapping
  const { data: custRow, error: custErr } = await supabaseAdmin
    .from("app_stripe_customers")
    .select("user_id")
    .eq("customer_id", stripe_customer_id) // your current column name
    .maybeSingle();

  if (custErr) {
    console.error("[wh] customer lookup error", custErr);
    throw custErr;
  }
  const user_id = custRow?.user_id;
  if (!user_id) {
    console.warn("[wh] ⚠ No user_id for stripe_customer_id", stripe_customer_id, "—skipping subscription upsert");
    return; // Optionally: queue retry once user_id is known
  }

  // 2) Upsert subscription keyed by its own id
  const { error: subErr } = await supabaseAdmin
    .from("app_subscriptions")
    .upsert(
      {
        stripe_subscription_id,  // unique key
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
