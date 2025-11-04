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

async function notify(subject, payload = {}) {
  try {
    const base =
      process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ||
      (process.env.VERCEL_URL
        ? (process.env.VERCEL_URL.startsWith("http")
            ? process.env.VERCEL_URL
            : `https://${process.env.VERCEL_URL}`).replace(/\/$/, "")
        : "");
    if (!base) return;
    const url = `${base}/api/_notify-email`;
    if (!process.env.NOTIFY_SECRET) return;

    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Notify-Secret": process.env.NOTIFY_SECRET,
      },
      body: JSON.stringify({
        subject,
        text: JSON.stringify(payload, null, 2),
        html: `<pre>${JSON.stringify(payload, null, 2)}</pre>`,
      }),
    });
  } catch {
    // do not fail webhook because of notify
  }
}

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

/** Try to fetch user email for notifications */
async function getEmailForUser(user_id, fallbackEmail = null) {
  if (!user_id) return fallbackEmail;
  const { data } = await supabaseAdmin
    .from("app_users")
    .select("email")
    .eq("user_id", user_id)
    .maybeSingle();
  return data?.email || fallbackEmail;
}

/** Normalize + persist subscriptions for clean admin views */
async function upsertSubscription({ user_id, sub }) {
  const item = sub.items?.data?.[0];
  const price = item?.price;

  const payload = {
    subscription_id: sub.id,
    stripe_subscription_id: sub.id,
    customer_id: sub.customer || null,
    stripe_customer_id: sub.customer || null,
    user_id: user_id ?? null,
    status: sub.status || null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    price_id: price?.id || null,
    price_nickname: price?.nickname || null,
    currency: price?.currency || null,
    interval: price?.recurring?.interval || null,
    amount: typeof price?.unit_amount === "number" ? price.unit_amount : null,
    started_at: toIso(sub.start_date),
    current_period_start: toIso(sub.current_period_start),
    current_period_end: toIso(sub.current_period_end),
    canceled_at: toIso(sub.canceled_at),
    trial_start: toIso(sub.trial_start),
    trial_end: toIso(sub.trial_end),
    env: ENV.toLowerCase(),
    updated_at: nowIso(),
  };

  const { error } = await supabaseAdmin
    .from("app_subscriptions")
    .upsert(payload, { onConflict: "subscription_id", ignoreDuplicates: false });

  if (error) {
    console.error("[wh] upsert app_subscriptions ERROR:", error.message, { payload });
  }

  // Opportunistic is_pro flip
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

          // Notify if we're already in trial at this moment
          if (sub.status === "trialing") {
            const notifyEmail = await getEmailForUser(user_id, email);
            await notify(`Trial started: ${notifyEmail || user_id}`, {
              user_id,
              email: notifyEmail,
              subscription_id: sub.id,
              trial_start: toIso(sub.trial_start),
              trial_end: toIso(sub.trial_end),
              env: ENV,
            });
          }
        }
        break;
      }

      /* -------------------- Subscription lifecycle -------------------- */
      case "customer.subscription.created": {
        const sub = event.data.object;
        const user_id =
          sub?.metadata?.app_user_id ||
          sub?.metadata?.user_id ||
          (await resolveUserIdFromCustomer(sub?.customer)) ||
          null;

        await upsertUser(user_id, sub?.customer_email || null);
        await upsertSubscription({ user_id, sub });

        if (sub.status === "trialing") {
          const notifyEmail = await getEmailForUser(user_id, sub?.customer_email || null);
          await notify(`Trial started: ${notifyEmail || user_id}`, {
            user_id,
            email: notifyEmail,
            subscription_id: sub.id,
            trial_start: toIso(sub.trial_start),
            trial_end: toIso(sub.trial_end),
            env: ENV,
          });
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;
        const previous = event.data.previous_attributes || {};
        const user_id =
          sub?.metadata?.app_user_id ||
          sub?.metadata?.user_id ||
          (await resolveUserIdFromCustomer(sub?.customer)) ||
          null;

        await upsertUser(user_id, sub?.customer_email || null);
        await upsertSubscription({ user_id, sub });

        // Detect transition to trialing (rare but possible)
        if (sub.status === "trialing" && previous.status !== "trialing") {
          const notifyEmail = await getEmailForUser(user_id, sub?.customer_email || null);
          await notify(`Trial started (update): ${notifyEmail || user_id}`, {
            user_id,
            email: notifyEmail,
            subscription_id: sub.id,
            trial_start: toIso(sub.trial_start),
            trial_end: toIso(sub.trial_end),
            env: ENV,
          });
        }

        // Detect TRIAL -> ACTIVE (paid conversion)
        const nowSec = Math.floor(Date.now() / 1000);
        const converted =
          sub.status === "active" &&
          sub.trial_end &&
          sub.trial_end < nowSec &&
          previous.status !== "active";

        if (converted) {
          const notifyEmail = await getEmailForUser(user_id, sub?.customer_email || null);
          await notify(`Trial converted to PAID: ${notifyEmail || user_id}`, {
            user_id,
            email: notifyEmail,
            subscription_id: sub.id,
            current_period_end: toIso(sub.current_period_end),
            env: ENV,
          });
        }
        break;
      }

      /* -------------------- Invoice (backup conversion signal) -------------------- */
      case "invoice.payment_succeeded": {
        const inv = event.data.object;
        const subId = inv.subscription;

        // Retrieve the sub to check conversion condition
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          const nowSec = Math.floor(Date.now() / 1000);
          const converted = sub.status === "active" && sub.trial_end && sub.trial_end < nowSec;

          if (converted) {
            const user_id =
              sub?.metadata?.app_user_id ||
              sub?.metadata?.user_id ||
              (await resolveUserIdFromCustomer(sub?.customer)) ||
              null;
            const email = inv.customer_email || (await getEmailForUser(user_id, null));
            await notify(`Trial converted to PAID: ${email || user_id}`, {
              user_id,
              email,
              subscription_id: sub.id,
              invoice_id: inv.id,
              current_period_end: toIso(sub.current_period_end),
              env: ENV,
            });
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const user_id =
          sub?.metadata?.app_user_id ||
          sub?.metadata?.user_id ||
          (await resolveUserIdFromCustomer(sub?.customer)) ||
          null;

        await upsertUser(user_id, sub?.customer_email || null);
        await upsertSubscription({ user_id, sub });
        // (Optional) notify on cancel; you didn't request it, so skipping
        break;
      }

      case "customer.subscription.trial_will_end": {
        const sub = event.data.object;
        // Optional: notify that trial is about to end
        break;
      }

      default:
        // keep logs light in prod
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error(`[wh:${ENV}] handler error:`, err);
    // still 200 so Stripe doesn't retry forever on non-critical failures
    return res.status(200).json({ received: true, note: "handled with warnings" });
  }
}
