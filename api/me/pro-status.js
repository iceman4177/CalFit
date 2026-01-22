// /api/me/pro-status.js
import { supabaseAdmin } from "../_lib/supabaseAdmin.js";

export const config = { api: { bodyParser: false } };

/* ------------------------------- utils ---------------------------------- */
function setCors(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin || "https://slimcal.ai");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function parseQuery(reqUrl) {
  try {
    return Object.fromEntries(new URL(reqUrl, "http://x").searchParams.entries());
  } catch {
    return {};
  }
}
const OK = new Set(["active", "trialing", "past_due"]);
const toDate = (v) => (v ? new Date(v) : null);
const isFuture = (d) => d instanceof Date && !isNaN(d) && d.getTime() > Date.now();

/* ------------------------------- handler -------------------------------- */
export default async function handler(req, res) {
  setCors(res, process.env.ALLOWED_ORIGIN || "https://slimcal.ai");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const q = parseQuery(req.url);
  const user_id = q.user_id || "";
  const emailHint = q.email || "";

  if (!user_id && !emailHint) {
    return res.status(200).json({
      isProActive: false,
      isPro: false,
      reason: "missing_identity",
      trial_eligible: true,
    });
  }
  if (!supabaseAdmin) {
    return res.status(200).json({
      isProActive: false,
      isPro: false,
      reason: "server_config",
      trial_eligible: true,
    });
  }

  try {
    // 1) app_users (authoritative for is_pro + trial dates)
    let userRow = null;

    if (user_id) {
      const { data } = await supabaseAdmin
        .from("app_users")
        .select("user_id, email, is_pro, trial_start, trial_end, updated_at")
        .eq("user_id", user_id)
        .maybeSingle();
      userRow = data || null;
    } else if (emailHint) {
      const { data } = await supabaseAdmin
        .from("app_users")
        .select("user_id, email, is_pro, trial_start, trial_end, updated_at")
        .eq("email", emailHint)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      userRow = data || null;
    }

    // 2) Latest subscription snapshot (fallback/extra signal)
    let subRow = null;
    if (userRow?.user_id || user_id) {
      const uid = userRow?.user_id || user_id;
      const { data, error } = await supabaseAdmin
        .from("app_subscriptions")
        .select("status, current_period_end, trial_end, updated_at")
        .eq("user_id", uid)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!error) subRow = data || null;
    }

    // 3) Derive truth
    const userTrialStart = toDate(userRow?.trial_start);
    const userTrialEnd = toDate(userRow?.trial_end);

    const subTrialEnd = toDate(subRow?.trial_end);
    const trialEnd = userTrialEnd || subTrialEnd || null;
    const trialActive = isFuture(trialEnd);

    const subActive =
      !!subRow?.status &&
      OK.has(String(subRow.status).toLowerCase()) &&
      isFuture(toDate(subRow?.current_period_end));

    // ✅ "One trial only" eligibility:
    // Eligible ONLY if we have no record of trial ever starting/ending.
    // (If you store trial history elsewhere, add it here too.)
    const trialUsed = !!(userTrialStart || userTrialEnd);
    const trialEligible = !trialUsed;

    const is_pro_flag = !!userRow?.is_pro;
    const isProActive = trialActive || subActive;

    return res.status(200).json({
      isProActive,
      isPro: isProActive, // legacy compatibility
      source: (subActive || trialActive) ? "subscriptions" : "none",

      is_pro: is_pro_flag,
      status: subRow?.status || null,
      trial: { active: trialActive, end: trialEnd ? trialEnd.toISOString() : null },
      trial_eligible: trialEligible,

      current_period_end: subRow?.current_period_end || null,
      email: userRow?.email || emailHint || null,
      user_id: userRow?.user_id || user_id || null,
    });
  } catch (e) {
    return res.status(200).json({
      isProActive: false,
      isPro: false,
      reason: "error",
      detail: e?.message || String(e),
      trial_eligible: true,
    });
  }
}
