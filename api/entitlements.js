// /api/entitlements.js
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";

function allowCors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

const ACTIVE = new Set(["active", "trialing", "past_due"]);

const DEFAULT = {
  isPro: false,
  status: "none",
  trialEnd: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: null,
  customerId: null,
  priceId: null,
  source: "none",
};

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  if (!supabaseAdmin) return res.status(200).json(DEFAULT);

  const emailRaw   = (req.query.email    || "").trim();
  const email      = emailRaw.toLowerCase();
  const customerId = (req.query.customer || "").trim();
  const userIdIn   = (req.query.user_id  || "").trim();

  try {
    // -------- 1) Resolve user_id robustly --------
    let user_id = userIdIn || null;

    // a) If not provided, try by Stripe customer mapping
    if (!user_id && customerId) {
      const { data: custRow, error: custErr } = await supabaseAdmin
        .from("app_stripe_customers")
        .select("user_id")
        .eq("customer_id", customerId)
        .maybeSingle();
      if (custErr) throw custErr;
      user_id = custRow?.user_id || null;
    }

    // b) If still unknown, try via app_users by email
    if (!user_id && email) {
      const { data: userRow, error: userErr } = await supabaseAdmin
        .from("app_users")
        .select("user_id")
        .eq("email", email)
        .maybeSingle();
      if (userErr) throw userErr;
      user_id = userRow?.user_id || null;
    }

    // c) If still unknown, try app_stripe_customers by email (latest row)
    if (!user_id && email) {
      const { data: mapRow, error: mapErr } = await supabaseAdmin
        .from("app_stripe_customers")
        .select("user_id")
        .eq("email", email)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (mapErr) throw mapErr;
      user_id = mapRow?.user_id || null;
    }

    if (!user_id) {
      return res.status(200).json(DEFAULT);
    }

    // -------- 2) Prefer view v_user_entitlements --------
    let payload = null;
    try {
      const { data: ent, error: entErr } = await supabaseAdmin
        .from("v_user_entitlements")
        .select("status, is_pro_active, trial_end, current_period_end, cancel_at_period_end")
        .eq("user_id", user_id)
        .maybeSingle();

      if (!entErr && ent) {
        const status = (ent.status || "none").toLowerCase();
        const isPro = Boolean(ent.is_pro_active) || ACTIVE.has(status);

        // Enrich from latest subscription (customer_id/price_id)
        const { data: subRow } = await supabaseAdmin
          .from("app_subscriptions")
          .select("price_id, stripe_customer_id")
          .eq("user_id", user_id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        payload = {
          isPro,
          status,
          trialEnd: ent.trial_end || null,
          currentPeriodEnd: ent.current_period_end || null,
          cancelAtPeriodEnd: ent.cancel_at_period_end ?? null,
          customerId: subRow?.stripe_customer_id || customerId || null,
          priceId: subRow?.price_id || null,
          source: "v_user_entitlements",
        };
      }
    } catch {
      // view may not exist — fall through to fallback
    }

    // -------- 3) Fallback to latest app_subscriptions row --------
    if (!payload) {
      const { data: sub, error: subErr } = await supabaseAdmin
        .from("app_subscriptions")
        .select("status, trial_end, current_period_end, cancel_at_period_end, stripe_customer_id, price_id")
        .eq("user_id", user_id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (subErr || !sub) {
        return res.status(200).json(DEFAULT);
      }

      const status = (sub.status || "none").toLowerCase();
      const isPro  = ACTIVE.has(status);

      payload = {
        isPro,
        status,
        trialEnd: sub.trial_end || null,
        currentPeriodEnd: sub.current_period_end || null,
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? null,
        customerId: sub.stripe_customer_id || customerId || null,
        priceId: sub.price_id || null,
        source: "app_subscriptions",
      };
    }

    return res.status(200).json(payload);
  } catch (err) {
    console.error("/api/entitlements error", err);
    return res.status(200).json(DEFAULT); // fail closed (free)
  }
}
