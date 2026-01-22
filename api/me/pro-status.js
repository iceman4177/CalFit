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
      reason: "missing_identity",
      trial_eligible: true, // unknown user -> treat as eligible on client if desired
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

    const subStatus = String(subRow?.status || "").toLowerCase();
    const subActive =
      !!subStatus &&
      OK.has(subStatus) &&
      isFuture(toDate(subRow?.current_period_end));

    // IMPORTANT:
    // - isProActive is "can use Pro features now" (active sub OR active trial)
    // - is_pro_flag is "has pro flag" (may be used elsewhere as an indicator)
    const is_pro_flag = !!userRow?.is_pro;
    const isProActive = trialActive || subActive;

    // One-time trial eligibility:
    // If we've ever seen *any* trial signal in app_users or subscriptions, trial is NOT eligible anymore.
    const sawAnyTrialSignal =
      !!userTrialStart ||
      !!userTrialEnd ||
      !!subTrialEnd ||
      subStatus === "trialing";

    const trial_eligible = !sawAnyTrialSignal;

    // Optional: surface a cleaner, UI-friendly "plan_status"
    // - If Pro active now: return sub status if present else "trialing"
    // - If not active: return "none"
    const plan_status =
      isProActive ? (subRow?.status || (trialActive ? "trialing" : null)) : "none";

    // 4) Response (include both modern and legacy flags)
    return res.status(200).json({
      isProActive,
      isPro: isProActive, // legacy compatibility for old callers expecting `isPro`
      source: (subActive || trialActive) ? "subscriptions" : "none",

      // helpful details
      is_pro: is_pro_flag,
      status: subRow?.status || null, // raw subscription status (may be stale/old but kept for debugging)
      plan_status, // derived, safer for UI

      trial: {
        active: trialActive,
        end: trialEnd ? trialEnd.toISOString() : null,
      },
      trial_eligible,

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
      trial_eligible: true, // fail-open on eligibility; UI can still choose to be conservative
    });
  }
}
