// /api/stripe-webhook.js
import Stripe from "stripe";
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";

export const config = { api: { bodyParser: false } };

// --- raw body reader (required for Stripe signature verification) ---
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

// -----------------------------------------------------------------------------
// Live/Test key selection
// -----------------------------------------------------------------------------
const useLive =
  process.env.NODE_ENV === "production" && process.env.STRIPE_SECRET_KEY_LIVE;

const stripe = new Stripe(
  useLive ? process.env.STRIPE_SECRET_KEY_LIVE : process.env.STRIPE_SECRET_KEY,
  { apiVersion: "2023-10-16" }
);

const endpointSecret = useLive
  ? process.env.STRIPE_WEBHOOK_SECRET_LIVE
  : process.env.STRIPE_WEBHOOK_SECRET;

// --- helpers ---------------------------------------------------------------
const toIso = (sec) => (sec ? new Date(sec * 1000).toISOString() : null);

// --- utils for DB writes ---------------------------------------------------
async function upsertUser(user_id, email) {
  if (!user_id) return;
  const { error } = await supabaseAdmin
    .from("app_users")
    .upsert({ user_id, email: email ?? null }, { onConflict: "user_id" });
  if (error) console.warn("[wh] app_users upsert warn:", error.message);
}

async function resolveUserIdFromCustomer(stripeCustomerId) {
  if (!stripeCustomerId) return null;
  const { data, error } = await supabaseAdmin
    .from("app_stripe_customers")
    .select("user_id")
    .eq("customer_id", stripeCustomerId)
    .maybeSingle();
  if (error) console.warn("[wh] resolve user_id from customer warn:", error.message);
  return data?.user_id ?? null;
}

// ✅ UPDATED: persist Stripe subscription/customer ids for clean admin views
async function upsertSubscription({ user_id, sub }) {
  // pull common price fields
  const item = sub.items?.data?.[0];
  const price = item?.price;

  const payload = {
    // Existing identifier you already use to dedupe (keep it):
    subscription_id: sub.id, // onConflict uses this

    // New normalized identifiers (text) for reporting/joins:
    stripe_subscription_id: sub.id,               // "sub_..."
    customer_id: sub.customer || null,            // "cus_..."
    stripe_customer_id: sub.customer || null,     // keep legacy field too

    // Relationships / status
    user_id,
    status: sub.status || null,

    // Price details
    price_id: price?.id || null,
    price_nickname: price?.nickname || null,
    currency: price?.currency || null,
    interval: price?.recurring?.interval || null,
    amount: typeof price?.unit_amount === "number" ? price.unit_amount : null,

    // Periods / dates
    started_at: toIso(sub.start_date),
    current_period_start: toIso(sub.current_period_start),
    current_period_end: toIso(sub.current_period_end),
    cancel_at_period_end: !!sub.cancel_at_period_end,
    canceled_at: toIso(sub.canceled_at),
    trial_start: toIso(sub.trial_start),
    trial_end: toIso(sub.trial_end),

    // Metadata
    env: useLive ? "live" : "test",
    updated_at: new Date().toISOString(),
  };

  console.log("[wh] upserting subscription", {
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

  // Flip is_pro quickly (keep your SQL trigger behavior too)
  if (user_id && sub.status && ["active", "trialing"].includes(sub.status)) {
    await supabaseAdmin
      .from("app_users")
      .update({
        is_pro: true,
        trial_start: toIso(sub.trial_start),
        trial_end: toIso(sub.trial_end),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user_id);
  }
  if (user_id && sub.status === "canceled") {
    await supabaseAdmin
      .from("app_users")
      .update({ is_pro: false, updated_at: new Date().toISOString() })
      .eq("user_id", user_id);
  }
}

// -----------------------------------------------------------------------------
// Main handler
// -----------------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  let event;
  try {
    const rawBody = await readRawBody(req);
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
  } catch (err) {
    console.error(
      `[wh:${useLive ? "LIVE" : "TEST"}] ❌ Signature verification failed:`,
      err?.message
    );
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
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

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;

        // Prefer metadata, then mapping via customer id
        let user_id =
          sub?.metadata?.app_user_id ||
          sub?.metadata?.user_id ||
          (await resolveUserIdFromCustomer(sub?.customer)) ||
          null;

        // Best-effort email update
        await upsertUser(user_id, sub?.customer_email || null);

        await upsertSubscription({ user_id, sub });
        break;
      }

      case "invoice.paid":
      case "invoice.payment_failed":
      case "customer.subscription.trial_will_end":
        console.log(`[wh:${useLive ? "LIVE" : "TEST"}] ${event.type} observed.`);
        break;

      default:
        console.log(`[wh:${useLive ? "LIVE" : "TEST"}] Ignored event`, event.type);
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error(`[wh:${useLive ? "LIVE" : "TEST"}] handler error:`, err);
    // Return 200 so Stripe doesn't retry forever (we log to inspect)
    return res.status(200).json({ received: true, note: "handled with warnings" });
  }
}
