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

// NOTE: OK means “paid/pro access should be active if current_period_end is in the future”
const OK = new Set(["active", "trialing", "past_due"]);
const toDate = (v) => (v ? new Date(v) : null);
const isValidDate = (d) => d instanceof Date && !isNaN(d);
const isFuture = (d) => isValidDate(d) && d.getTime() > Date.now();
const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

async function getTrialSignals({ user_id, emailHint }) {
  const normalizedEmail = normalizeEmail(emailHint);
  const customerIds = new Set();

  if (user_id) {
    const { data: userCustomerRows } = await supabaseAdmin
      .from("app_stripe_customers")
      .select("customer_id")
      .eq("user_id", user_id)
      .limit(20);
    (userCustomerRows || []).forEach((row) => row?.customer_id && customerIds.add(row.customer_id));
  }

  if (normalizedEmail) {
    const { data: emailCustomerRows } = await supabaseAdmin
      .from("app_stripe_customers")
      .select("customer_id")
      .ilike("email", normalizedEmail)
      .limit(20);
    (emailCustomerRows || []).forEach((row) => row?.customer_id && customerIds.add(row.customer_id));
  }

  const rows = [];
  const seen = new Set();

  async function addRows(queryBuilder) {
    const { data } = await queryBuilder;
    for (const row of data || []) {
      if (!row) continue;
      const key = JSON.stringify([
        row.user_id || null,
        row.stripe_customer_id || null,
        row.customer_id || null,
        row.trial_start || null,
        row.trial_end || null,
        row.status || null,
        row.updated_at || null,
      ]);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }

  if (user_id) {
    await addRows(
      supabaseAdmin
        .from("app_subscriptions")
        .select("status, current_period_end, trial_start, trial_end, updated_at, user_id, stripe_customer_id, customer_id")
        .eq("user_id", user_id)
        .order("updated_at", { ascending: false })
        .limit(20)
    );
  }

  for (const customerId of customerIds) {
    await addRows(
      supabaseAdmin
        .from("app_subscriptions")
        .select("status, current_period_end, trial_start, trial_end, updated_at, user_id, stripe_customer_id, customer_id")
        .or(`stripe_customer_id.eq.${customerId},customer_id.eq.${customerId}`)
        .order("updated_at", { ascending: false })
        .limit(20)
    );
  }

  return rows;
}

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
      status: null,
      plan_status: "none",
      trial: { active: false, end: null },
      current_period_end: null,
      email: emailHint || null,
      user_id: user_id || null,
    });
  }
  if (!supabaseAdmin) {
    return res.status(200).json({
      isProActive: false,
      isPro: false,
      reason: "server_config",
      trial_eligible: true,
      status: null,
      plan_status: "none",
      trial: { active: false, end: null },
      current_period_end: null,
      email: emailHint || null,
      user_id: user_id || null,
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

    // 2) Latest subscription snapshot plus linked historical trial signals
    const trialSignalRows = await getTrialSignals({
      user_id: userRow?.user_id || user_id,
      emailHint: userRow?.email || emailHint,
    });

    const subRow = trialSignalRows[0] || null;

    // 3) Derive truth (trial)
    const userTrialStart = toDate(userRow?.trial_start);
    const userTrialEnd = toDate(userRow?.trial_end);
    const subTrialStart = toDate(subRow?.trial_start);
    const subTrialEnd = toDate(subRow?.trial_end);

    const trialEnd = userTrialEnd || subTrialEnd || null;
    const trialActive = isFuture(trialEnd);

    // 3b) Derive truth (paid sub)
    const rawSubStatus = subRow?.status ?? null;
    const subStatus = String(rawSubStatus || "").toLowerCase();
    const currentPeriodEnd = toDate(subRow?.current_period_end);

    const subActive =
      !!subStatus &&
      OK.has(subStatus) &&
      isFuture(currentPeriodEnd);

    // IMPORTANT:
    // - isProActive is "can use Pro features now" (active sub OR active trial)
    // - is_pro_flag is "has pro flag" (may be used elsewhere as an indicator)
    const is_pro_flag = !!userRow?.is_pro;
    const isProActive = trialActive || subActive;

    // 3c) Normalize stale “trialing” status AFTER trial ends
    // This prevents your UI from thinking someone is trialing forever.
    let effectiveStatus = rawSubStatus ? String(rawSubStatus) : null;
    const lowerEffective = String(effectiveStatus || "").toLowerCase();
    if (lowerEffective === "trialing" && !trialActive) {
      // Once trial_end is in the past, "trialing" should not remain the UI-driving status.
      // Use "canceled" as a safe, schema-valid inactive state.
      effectiveStatus = "canceled";
    }

    // One-time trial eligibility:
    // If we've ever seen *any* trial signal in app_users or subscriptions, trial is NOT eligible anymore.
    const sawAnyTrialSignal =
      !!userTrialStart ||
      !!userTrialEnd ||
      !!subTrialStart ||
      !!subTrialEnd ||
      trialSignalRows.some((row) => {
        const status = String(row?.status || "").toLowerCase();
        return !!(row?.trial_start || row?.trial_end || status === "trialing");
      });

    const trial_eligible = !sawAnyTrialSignal;

    // UI-safe plan_status:
    // - If Pro active now: prefer sub status if present else "trialing"
    // - If not active: "none"
    // - If status was stale "trialing" but trial is over: plan_status should be "none"
    let plan_status = "none";
    if (isProActive) {
      plan_status = rawSubStatus || (trialActive ? "trialing" : "active");
    } else {
      plan_status = "none";
    }
    if (!trialActive && String(plan_status || "").toLowerCase() === "trialing") {
      plan_status = "none";
    }

    // 4) Response (include both modern and legacy flags)
    return res.status(200).json({
      isProActive,
      isPro: isProActive, // legacy compatibility for old callers expecting `isPro`
      source: (subActive || trialActive) ? "subscriptions" : "none",

      // helpful details
      is_pro: is_pro_flag,

      // keep raw subscription status for debugging, but ALSO return an effective status for UI
      status: rawSubStatus,
      effective_status: effectiveStatus, // ✅ use this if your UI previously relied on status

      plan_status, // ✅ derived, safer for UI

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
      status: null,
      effective_status: null,
      plan_status: "none",
      trial: { active: false, end: null },
      current_period_end: null,
      email: emailHint || null,
      user_id: user_id || null,
    });
  }
}
