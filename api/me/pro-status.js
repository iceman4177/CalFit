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
const isValidDate = (d) => d instanceof Date && !isNaN(d);
const isFuture = (d) => isValidDate(d) && d.getTime() > Date.now();
const isPastOrNow = (d) => isValidDate(d) && d.getTime() <= Date.now();

/* ------------------------------- handler -------------------------------- */
export default async function handler(req, res) {
  setCors(res, process.env.ALLOWED_ORIGIN || "https://slimcal.ai");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const q = parseQuery(req.url);
  const user_id = q.user_id || "";
  const emailHint = q.email || "";

  if (!user_id && !emailHint) {
    // Keep 200 to avoid noisy console errors; client can treat as logged out
    return res.status(200).json({
      isProActive: false,
      isPro: false,
      trialEligible: true, // unknown user; trial eligibility is account-scoped
      trialUsed: false,
      reason: "missing_identity",
    });
  }
  if (!supabaseAdmin) {
    return res.status(200).json({
      isProActive: false,
      isPro: false,
      trialEligible: false,
      trialUsed: false,
      reason: "server_config",
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
    const resolvedUid = userRow?.user_id || user_id || "";
    if (resolvedUid) {
      const { data, error } = await supabaseAdmin
        .from("app_subscriptions")
        .select("status, current_period_end, trial_end, updated_at")
        .eq("user_id", resolvedUid)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!error) subRow = data || null;
    }

    // 3) Derive server truth
    const userTrialStart = toDate(userRow?.trial_start);
    const userTrialEnd = toDate(userRow?.trial_end);
    const subTrialEnd = toDate(subRow?.trial_end);

    // Prefer app_users trial_end; fallback to subscription trial_end
    const trialEnd = userTrialEnd || subTrialEnd || null;

    // Trial is ACTIVE only if trial_end is in the future
    const trialActive = isFuture(trialEnd);

    // "Trial used" should be sticky once they ever start/end a trial
    // We infer it from any of:
    // - app_users.trial_start exists
    // - trial_end exists and is in the past (or future)
    // - subscription trial_end exists
    const trialUsed =
      !!userTrialStart ||
      !!userTrialEnd ||
      !!subTrialEnd ||
      (trialEnd ? isPastOrNow(trialEnd) || isFuture(trialEnd) : false);

    const subActive =
      !!subRow?.status &&
      OK.has(String(subRow.status).toLowerCase()) &&
      isFuture(toDate(subRow?.current_period_end));

    // IMPORTANT:
    // - Paid Pro is determined by subscription (subActive), NOT by old trial dates.
    // - trialActive grants temporary Pro (unlimited) while active.
    const isProActive = !!subActive || !!trialActive;

    // Trial eligibility:
    // - If trial was already used at any point, they are no longer eligible for another.
    // - If they are currently Pro active (paid), trial eligibility is irrelevant; keep false.
    const trialEligible = !trialUsed && !subActive;

    const is_pro_flag = !!userRow?.is_pro;

    return res.status(200).json({
      isProActive,
      isPro: isProActive, // legacy compatibility
      source: isProActive ? "subscriptions_or_trial" : "none",

      // details
      is_pro: is_pro_flag,
      status: subRow?.status || (trialActive ? "trialing" : "none"),
      trial: { active: trialActive, end: trialEnd ? trialEnd.toISOString() : null },

      trialEligible,
      trialUsed,

      current_period_end: subRow?.current_period_end || null,
      email: userRow?.email || emailHint || null,
      user_id: resolvedUid || null,
    });
  } catch (e) {
    return res.status(200).json({
      isProActive: false,
      isPro: false,
      trialEligible: false,
      trialUsed: false,
      reason: "error",
      detail: e?.message || String(e),
    });
  }
}
