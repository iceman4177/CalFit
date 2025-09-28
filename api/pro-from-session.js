// api/pro-from-session.js
import Stripe from "stripe";
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });
const iso = (ts) => (typeof ts === "number" ? new Date(ts * 1000).toISOString() : null);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const asUuidOrNull = (v) => (UUID_RE.test(String(v || "")) ? v : null);

async function upsertCustomer({ customer_id, user_id, email }) {
  if (!customer_id) return;
  const payload = { customer_id, email: email ?? null, updated_at: new Date().toISOString() };
  if (user_id) payload.user_id = user_id;
  const { error } = await supabaseAdmin
    .from("app_stripe_customers")
    .upsert(payload, { onConflict: "customer_id" });
  if (error) throw new Error(error.message);
}

async function resolveUserIdFromCustomer(customer_id) {
  if (!customer_id) return null;
  const { data, error } = await supabaseAdmin
    .from("app_stripe_customers")
    .select("user_id")
    .eq("customer_id", customer_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.user_id || null;
}

async function insertOrUpdateSubscription({
  user_id,
  customer_id,
  status,
  current_period_end,
  price_id,
  cancel_at_period_end,
  trial_end,
}) {
  let existingId = null;

  if (user_id) {
    const { data } = await supabaseAdmin
      .from("app_subscriptions")
      .select("id")
      .eq("user_id", user_id)
      .limit(1)
      .maybeSingle();
    existingId = data?.id || null;
  }
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
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabaseAdmin
      .from("app_subscriptions")
      .insert(payload);
    if (error) throw new Error(error.message);
  }
}

async function upsertSubscription(sub, userHint = null) {
  const customer_id = sub.customer;
  let user_id = asUuidOrNull(userHint) || asUuidOrNull(sub.metadata?.user_id) || null;
  if (!user_id) user_id = await resolveUserIdFromCustomer(customer_id);
  if (!user_id) throw new Error("user_id missing for subscription");

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
  if (entErr) throw new Error(entErr.message);
}

export default async function handler(req, res) {
  try {
    if (!supabaseAdmin) return res.status(200).json({ ok: false, reason: "server_config" });

    const url = new URL(req.url, "http://x");
    const session_id = url.searchParams.get("session_id");
    if (!session_id) return res.status(200).json({ ok: false, reason: "missing_session_id" });

    const s = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ["subscription", "customer", "subscription.items.data.price"],
    });

    const customer_id = s.customer || null;
    const email = s.customer_details?.email ?? s.customer_email ?? null;
    const user_id =
      asUuidOrNull(s.client_reference_id) || asUuidOrNull(s.metadata?.user_id) || null;

    await upsertCustomer({ customer_id, user_id, email });

    if (s.mode === "subscription" && s.subscription) {
      const sub =
        typeof s.subscription === "string"
          ? await stripe.subscriptions.retrieve(s.subscription, { expand: ["items.data.price"] })
          : s.subscription;
      await upsertSubscription(sub, user_id);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[pro-from-session] error:", e.message || e);
    return res.status(200).json({ ok: false, reason: "error", detail: e.message || String(e) });
  }
}
