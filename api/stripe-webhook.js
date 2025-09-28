import Stripe from "stripe";
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

// ---------- helpers ----------
async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}
const iso = (ts) => (typeof ts === "number" ? new Date(ts * 1000).toISOString() : null);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const asUuidOrNull = (v) => (UUID_RE.test(String(v || "")) ? v : null);

function logDbError(where, error) {
  if (error) console.error(`[wh] DB error @ ${where}:`, error.message || error);
}

async function upsertCustomer({ customer_id, user_id, email }) {
  if (!customer_id) return;

  const payload = {
    customer_id,
    email: email ?? null,
    updated_at: new Date().toISOString(),
  };
  if (user_id) payload.user_id = user_id;

  const { error } = await supabaseAdmin
    .from("app_stripe_customers")
    .upsert(payload, { onConflict: "customer_id" });

  logDbError("app_stripe_customers.upsert", error);
  if (error) throw new Error(`upsert app_stripe_customers failed: ${error.message}`);
}

async function resolveUserIdFromCustomer(customer_id) {
  if (!customer_id) return null;
  const { data, error } = await supabaseAdmin
    .from("app_stripe_customers")
    .select("user_id")
    .eq("customer_id", customer_id)
    .maybeSingle();
  logDbError("app_stripe_customers.select", error);
  if (error) throw new Error(`lookup mapping failed: ${error.message}`);
  return data?.user_id || null;
}

// Insert or update by existing row for this user/customer (no unique constraint required)
async function insertOrUpdateSubscription({
  user_id,
  customer_id,
  status,
  current_period_end,
  price_id,
  cancel_at_period_end,
  trial_end,
}) {
  // Try to find an existing row for this user (or customer) to update
  let existingId = null;

  // Prefer user_id match
  if (user_id) {
    const { data } = await supabaseAdmin
      .from("app_subscriptions")
      .select("id")
      .eq("user_id", user_id)
      .limit(1)
      .maybeSingle();
    existingId = data?.id || null;
  }

  // Fallback: look by customer_id
  if (!existingId && customer_id) {
    const { data } = await supabaseAdmin
      .from("app_subscriptions")
      .select("id")
      .eq("customer_id", customer_id)
      .limit(1)
      .maybeSingle();
    existingId = data?.id || null;
  }

  const payload = {
    user_id,
    customer_id,
    status,
    current_period_end,
    price_id,
    cancel_at_period_end,
    trial_end,
    updated_at: new Date().toISOString(),
  };

  if (existingId) {
    const { error } = await supabaseAdmin
      .from("app_subscriptions")
      .update(payload)
      .eq("id", existingId);
    logDbError("app_subscriptions.update", error);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabaseAdmin
      .from("app_subscriptions")
      .insert(payload); // id will auto-generate (uuid default)
    logDbError("app_subscriptions.insert", error);
    if (error) throw new Error(error.message);
  }
}

async function upsertSubscription(sub, userHint = null) {
  const customer_id = sub.customer;
  let user_id =
    asUuidOrNull(userHint) ||
    asUuidOrNull(sub.metadata?.user_id) ||
    null;

  if (!user_id) user_id = await resolveUserIdFromCustomer(customer_id);
  if (!user_id) {
    console.warn("[wh] ⚠ no user_id for subscription", { customer_id });
    throw new Error("user_id missing for subscription upsert");
  }

  const item = sub.items?.data?.[0];
  const price = item?.price;
  const price_id = price?.id ?? null;

  await insertOrUpdateSubscription({
    user_id,
    customer_id,
    status: sub.status,
    current_period_end: iso(sub.current_period_end),
    price_id,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    trial_end: iso(sub.trial_end),
  });

  // Mirror entitlements
  const is_pro = sub.status === "active" || sub.status === "trialing";
  const { error: entErr } = await supabaseAdmin
    .from("entitlements")
    .upsert(
      {
        user_id,
        is_pro,
        status: sub.status,
        current_period_end: iso(sub.current_period_end),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  logDbError("entitlements.upsert", entErr);
  if (entErr) throw new Error(`upsert entitlements failed: ${entErr.message}`);
}

// ---------- handler ----------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  if (!supabaseAdmin) {
    console.error("[wh] missing Supabase admin client (check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    return res.status(500).send("Server config error");
  }

  // Verify signature
  let event;
  try {
    const sig = req.headers["stripe-signature"];
    if (!sig) return res.status(400).send("Missing Stripe-Signature");
    const raw = await readRaw(req);
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("[wh] ❌ signature/parse error:", e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  try {
    console.log("[wh] recv", { id: event.id, type: event.type });

    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        const userId =
          asUuidOrNull(s.client_reference_id) ||
          asUuidOrNull(s.metadata?.user_id) ||
          null;

        const customerId = s.customer || null;
        const email = s.customer_details?.email ?? s.customer_email ?? null;

        console.log("[wh] checkout.session.completed", { userId, customerId });

        await upsertCustomer({ customer_id: customerId, user_id: userId, email });

        if (s.mode === "subscription" && s.subscription) {
          const sub = await stripe.subscriptions.retrieve(s.subscription, {
            expand: ["items.data.price"],
          });
          await upsertSubscription(sub, userId);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        console.log("[wh] subscription", {
          subId: sub.id,
          status: sub.status,
          customer: sub.customer,
          metaUser: sub.metadata?.user_id,
        });
        await upsertSubscription(sub);
        break;
      }

      case "invoice.paid":
      case "invoice.payment_failed":
      case "customer.subscription.trial_will_end":
        console.log("[wh] info", { type: event.type });
        break;

      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error("[wh] ❌ handler error:", e.message);
    // 400 so Stripe retries if we failed transiently
    return res.status(400).send("Webhook handler failed");
  }
}
