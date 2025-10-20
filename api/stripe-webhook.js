// api/stripe-webhook.js
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
function toIso(sec) {
  return sec ? new Date(sec * 1000).toISOString() : null;
}

// --- utils for DB writes ---------------------------------------------------
async function upsertUser(user_id, email) {
  if (!user_id) return;
  try {
    await supabaseAdmin
      .from("app_users")
      .upsert({ user_id, email: email ?? null }, { onConflict: "user_id" });
  } catch (e) {
    console.warn("[wh] app_users upsert warn:", e?.message || e);
  }
}

async function upsertSubscription({ user_id, sub }) {
  const payload = {
    subscription_id: sub.id,
    user_id,
    stripe_customer_id: sub.customer,
    status: sub.status,
    price_id: sub.items?.data?.[0]?.price?.id || null,
    price_nickname: sub.items?.data?.[0]?.price?.nickname || null,
    current_period_start: toIso(sub.current_period_start),
    current_period_end: toIso(sub.current_period_end),
    cancel_at_period_end: !!sub.cancel_at_period_end,
    canceled_at: toIso(sub.canceled_at),
    trial_start: toIso(sub.trial_start),
    trial_end: toIso(sub.trial_end),
    updated_at: new Date().toISOString(),
    env: useLive ? "live" : "test",
  };

  await supabaseAdmin.from("app_subscriptions").upsert(payload, {
    onConflict: "subscription_id",
    ignoreDuplicates: false,
  });

  // --- also mark user as Pro if active or trialing ---
  if (user_id && sub.status && ["active", "trialing"].includes(sub.status)) {
    try {
      await supabaseAdmin
        .from("app_users")
        .update({
          is_pro: true,
          trial_start: toIso(sub.trial_start),
          trial_end: toIso(sub.trial_end),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user_id);
    } catch (e) {
      console.warn("[wh] could not update is_pro:", e?.message || e);
    }
  }

  // --- if canceled, mark is_pro = false ---
  if (user_id && sub.status === "canceled") {
    try {
      await supabaseAdmin
        .from("app_users")
        .update({ is_pro: false, updated_at: new Date().toISOString() })
        .eq("user_id", user_id);
    } catch (e) {
      console.warn("[wh] could not revoke is_pro:", e?.message || e);
    }
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
          null;
        const email =
          session?.customer_details?.email || session?.metadata?.email || null;

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

        // 1) metadata
        let user_id =
          sub.metadata?.app_user_id || sub.metadata?.user_id || null;

        // 2) fallback: query subscriptions for same customer
        if (!user_id && sub.customer) {
          const list = await stripe.subscriptions.list({
            customer: sub.customer,
            limit: 10,
          });
          user_id = list.data
            .map((s) => s.metadata?.app_user_id || s.metadata?.user_id)
            .find(Boolean);
        }

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
    // Always respond 200 to prevent Stripe retries
    return res
      .status(200)
      .json({ received: true, note: "handled with warnings" });
  }
}
