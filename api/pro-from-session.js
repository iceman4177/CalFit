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
  if (error) throw new Error(`upsert customers failed: ${error.message}`);
}

async function resolveUserIdFromCustomer(customer_id) {
  if (!customer_id) return null;
  const { data, error } = await supabaseAdmin
    .from("app_stripe_customers")
    .select("user_id")
    .eq("customer_id", customer_id)
    .maybeSingle();
  if (error) throw new Error(`lookup mapping failed: ${error.message}`);
  return data?.user_id || null;
}

async function upsertSubscription(sub, userHint = null) {
  const stripe_subscription_id = sub.id;
  const customer_id = sub.customer;
  let user_id = asUuidOrNull(userHint) || asUuidOrNull(sub.metadata?.user_id) || null;
  if (!user_id) user_id = await resolveUserIdFromCustomer(customer_id);
  if (!user_id) throw new Error("user_id missing for subscription upsert");

  const item = sub.items?.data?.[0];
  const price = item?.price;
  const price_id = price?.id ?? null;
  const product_id = typeof price?.product === "string" ? price.product : price?.product?.id ?? null;

  const { error: subErr } = await supabaseAdmin
    .from("app_subscriptions")
    .upsert(
      {
        stripe_subscription_id,
        user_id,
        status: sub.status,
        current_period_end: iso(sub.current_period_end),
        price_id,
        product_id,
        cancel_at_period_end: !!sub.cancel_at_period_end,
        trial_end: iso(sub.trial_end),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id" }
    );
  if (subErr) throw new Error(`upsert subscriptions failed: ${subErr.message}`);

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
  if (entErr) throw new Error(`upsert entitlements failed: ${entErr.message}`);
}

export default async function handler(req, res) {
  try {
    if (!supabaseAdmin) return res.status(200).json({ ok: false, reason: "server_config" });

    const url = new URL(req.url, "http://x");
    const session_id = url.searchParams.get("session_id") || null;
    if (!session_id) return res.status(200).json({ ok: false, reason: "missing_session_id" });

    // 1) Pull the checkout session
    const s = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ["subscription", "customer", "line_items", "subscription.items.data.price"],
    });

    const customer_id = s.customer || null;
    const email = s.customer_details?.email ?? s.customer_email ?? null;
    const user_id = asUuidOrNull(s.client_reference_id) || asUuidOrNull(s.metadata?.user_id) || null;

    // 2) Ensure mapping
    await upsertCustomer({ customer_id, user_id, email });

    // 3) Upsert subscription (from session or fetch by id)
    if (s.mode === "subscription") {
      const sub = s.subscription?.id
        ? s.subscription // expanded object (if available)
        : await stripe.subscriptions.retrieve(s.subscription, { expand: ["items.data.price"] });
      await upsertSubscription(sub, user_id);
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[pro-from-session] error:", e.message || e);
    return res.status(200).json({ ok: false, reason: "error", detail: e.message || String(e) });
  }
}
