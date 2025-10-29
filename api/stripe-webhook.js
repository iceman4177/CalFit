// /api/stripe-webhook.js
import Stripe from "stripe";
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";

export const config = { api: { bodyParser: false } };

/* ----------------------------- raw body reader ---------------------------- */
async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    try {
      const chunks = [];
      req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    } catch (e) {
      reject(e);
    }
  });
}

/* --------------------------- env + stripe setup --------------------------- */
const useLive =
  process.env.NODE_ENV === "production" && !!process.env.STRIPE_SECRET_KEY_LIVE;

const stripe = new Stripe(
  useLive ? process.env.STRIPE_SECRET_KEY_LIVE : process.env.STRIPE_SECRET_KEY,
  { apiVersion: "2023-10-16" }
);

const endpointSecret = useLive
  ? process.env.STRIPE_WEBHOOK_SECRET_LIVE
  : process.env.STRIPE_WEBHOOK_SECRET;

const ENV = useLive ? "LIVE" : "TEST";

/* -------------------------------- helpers -------------------------------- */
const toIso = (sec) => (sec ? new Date(sec * 1000).toISOString() : null);
const nowIso = () => new Date().toISOString();

/** Ensure app_users exists/updated */
async function upsertUser(user_id, email) {
  if (!user_id) return;
  const { error } = await supabaseAdmin
    .from("app_users")
    .upsert(
      {
        user_id,
        email: email ?? null,
        updated_at: nowIso(),
      },
      { onConflict: "user_id" }
    );
  if (error) console.warn("[wh] app_users upsert warn:", error.message);
}

/** Map a Stripe customer to our user_id via app_stripe_customers */
async function resolveUserIdFromCustomer(stripeCustomerId) {
  if (!stripeCustomerId) return null;
  const { data, error } = await supabaseAdmin
    .from("app_stripe_customers")
    .select("user_id")
    .eq("customer_id", stripeCustomerId)
    .maybeSingle();
  if (error) console.warn("[wh] resolve user_id warn:", error.message);
  return data?.user_id ?? null;
}

/** Normalize + persist subscriptions for clean admin views */
async function upsertSubscription({ user_id, sub }) {
  const item = sub.items?.data?.[0];
  const price = item?.price;

  const payload = {
    // Primary key / conflict target
    subscription_id: sub.id,

    // Stripe identifiers
    stripe_subscription_id: sub.id,
    customer_id: sub.customer || null,
    stripe_customer_id: sub.customer || null,

    // Relationship
    user_id: user_id ?? null,

    // Status
    status: sub.status || null,
    cancel_at_period_end: !!sub.cancel_at_period_end,

    // Price info
    price_id: price?.id || null,
    price_nickname: price?.nickname || null,
    currency: price?.currency || null,
    interval: price?.recurring?.interval || null,
    amount: typeof price?.unit_amount === "number" ? price.unit_amount : null,

    // Periods / dates
    started_at: toIso(sub.start_date),
    current_period_start: toIso(sub.current_period_start),
    current_period_end: toIso(sub.current_period_end),
    canceled_at: toIso(sub.canceled_at),
    trial_start: toIso(sub.trial_start),
    trial_end: toIso(sub.trial_end),

    // Meta
    env: ENV.toLowerCase(),
    updated_at: nowIso(),
  };

  console.log(`[wh:${ENV}] upsert subscription`, {
    sub_id: payload.stripe_subscription_id,
    status: payload.status,
    user_id: payload.user_id,
    cancel_at_period_end: payload.cancel_at_period_end,
  });

  const { error } = await supabaseAdmin
    .from("app_subscriptions")
    .upsert(payload, { onConflict: "subscription_id", ignoreDuplicates: false });

  if (error) {
    console.error("[wh] upsert app_subscriptions ERROR:", error.message, { payload });
  } else {
    console.log("[wh] upsert app_subscriptions OK");
  }

  // Opportunistic flip of is_pro (keep any DB-side triggers you have)
  if (user_id) {
    if (["active", "trialing", "past_due"].includes(sub.status)) {
      await supabaseAdmin
        .from("app_users")
        .update({
          is_pro: true,
          trial_start: toIso(sub.trial_start),
          trial_end: toIso(sub.trial_end),
          updated_at: nowIso(),
        })
        .eq("user_id", user_id);
    } else if (["canceled", "unpaid", "incomplete_expired"].includes(sub.status)) {
      await supabaseAdmin
        .from("app_users")
        .update({ is_pro: false, updated_at: nowIso() })
        .eq("user_id", user_id);
    }
  }
}

/* ------------------------------- main handler ---------------------------- */
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  let event;
  try {
    const rawBody = await readRawBody(req);
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
  } catch (err) {
    console.error(`[wh:${ENV}] ❌ Signature verification failed:`, err?.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      /* -------------------- Checkout completed -------------------- */
      case "checkout.session.completed": {
        const session = event.data.object;

        const user_id =
          session?.metadata?.app_user_id ||
          session?.metadata?.user_id ||
          session?.client_reference_id ||
          (await resolveUserIdFromCustomer(session?.customer)) ||
          null;

        const email =
          session?.customer_details?.email ||
          session?.metadata?.email ||
          null;

        await upsertUser(user_id, email);

        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          await upsertSubscription({ user_id, sub });
        }
        break;
      }

      /* -------------------- Subscription lifecycle -------------------- */
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;

        const user_id =
          sub?.metadata?.app_user_id ||
          sub?.metadata?.user_id ||
          (await resolveUserIdFromCustomer(sub?.customer)) ||
          null;

        // Best-effort user email update when available
        await upsertUser(user_id, sub?.customer_email || null);

        await upsertSubscription({ user_id, sub });
        break;
      }

      /* -------------------- Invoice outcomes (optional) -------------------- */
      case "invoice.payment_succeeded": {
        const inv = event.data.object;
        console.log(`[wh:${ENV}] invoice.payment_succeeded`, inv.id);
        break;
      }
      case "invoice.payment_failed": {
        const inv = event.data.object;
        console.warn(`[wh:${ENV}] invoice.payment_failed`, inv.id);
        break;
      }

      case "customer.subscription.trial_will_end": {
        const sub = event.data.object;
        console.log(`[wh:${ENV}] trial_will_end for`, sub.id);
        break;
      }

      default:
        console.log(`[wh:${ENV}] Ignored event`, event.type);
        break;
    }

    // Return 200 so Stripe considers the event delivered
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error(`[wh:${ENV}] handler error:`, err);
    // Return 200 to avoid repeated retries if the failure is non-critical
    return res.status(200).json({ received: true, note: "handled with warnings" });
  }
}
