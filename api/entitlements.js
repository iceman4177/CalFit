// /api/entitlements.js
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";

function allowCors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

const DEFAULT = {
  isPro: false,
  status: "none",
  trialEnd: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: null,
  customerId: null,
  priceId: null,
};

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const email      = (req.query.email     || "").trim().toLowerCase();
  const customerId = (req.query.customer  || "").trim();
  const userIdIn   = (req.query.user_id   || "").trim();

  try {
    // --- 1) Resolve user_id in a robust order ----------------------------
    let user_id = userIdIn || null;

    // If not provided, try by Stripe customer mapping
    if (!user_id && customerId) {
      const { data: custRow, error: custErr } = await supabaseAdmin
        .from("app_stripe_customers")
        .select("user_id, customer_id")
        .eq("customer_id", customerId)
        .maybeSingle();
      if (custErr) throw custErr;
      user_id = custRow?.user_id || null;
    }

    // If still unknown, try via app_users by email (best-effort)
    if (!user_id && email) {
      const { data: userRow, error: userErr } = await supabaseAdmin
        .from("app_users")
        .select("user_id")
        .eq("email", email)
        .maybeSingle();
      if (userErr) throw userErr;
      user_id = userRow?.user_id || null;
    }

    if (!user_id) {
      // No mapping found → return safe default
      return res.status(200).json(DEFAULT);
    }

    // --- 2) Read entitlements from the view (freshest row per user) ------
    const { data: ent, error: entErr } = await supabaseAdmin
      .from("v_user_entitlements")
      .select(
        "status, is_pro_active, trial_end, current_period_end, cancel_at_period_end"
      )
      .eq("user_id", user_id)
      .maybeSingle();

    if (entErr) {
      // Fail closed (free)
      console.warn("[entitlements] view read error", entErr.message);
      return res.status(200).json(DEFAULT);
    }

    // --- 3) Optional enrich: price & stripe_customer_id for UI hooks -----
    const { data: subRow, error: subErr } = await supabaseAdmin
      .from("app_subscriptions")
      .select("price_id, stripe_customer_id")
      .eq("user_id", user_id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subErr) {
      console.warn("[entitlements] subs read warn:", subErr.message);
    }

    const payload = {
      isPro: !!ent?.is_pro_active,
      status: ent?.status || "none",
      trialEnd: ent?.trial_end || null,
      currentPeriodEnd: ent?.current_period_end || null,
      cancelAtPeriodEnd: ent?.cancel_at_period_end ?? null,
      customerId: subRow?.stripe_customer_id || customerId || null,
      priceId: subRow?.price_id || null,
    };

    return res.status(200).json(payload);
  } catch (err) {
    console.error("/api/entitlements error", err);
    return res.status(200).json(DEFAULT); // fail closed (free)
  }
}
