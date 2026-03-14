// /api/create-checkout-session.js
export const config = { api: { bodyParser: false } };

/* ------------------------------- utils ---------------------------------- */
function setCors(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
async function readJson(req) {
  let raw;
  if (typeof req.text === "function") raw = await req.text();
  else {
    const chunks = [];
    for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
    raw = Buffer.concat(chunks).toString("utf8");
  }
  return raw ? JSON.parse(raw) : {};
}
function absUrl(pathOrUrl, base) {
  try { return new URL(pathOrUrl).toString(); }
  catch { return new URL(pathOrUrl, base).toString(); }
}
function nowIso() { return new Date().toISOString(); }
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}
async function getLatestTrialSignals(supabaseAdmin, { user_id, email }) {
  const normalizedEmail = normalizeEmail(email);
  const customerIds = new Set();

  if (user_id) {
    const { data: customerRows } = await supabaseAdmin
      .from("app_stripe_customers")
      .select("customer_id")
      .eq("user_id", user_id)
      .limit(20);
    (customerRows || []).forEach((row) => row?.customer_id && customerIds.add(row.customer_id));
  }

  if (normalizedEmail) {
    const { data: emailCustomerRows } = await supabaseAdmin
      .from("app_stripe_customers")
      .select("customer_id")
      .ilike("email", normalizedEmail)
      .limit(20);
    (emailCustomerRows || []).forEach((row) => row?.customer_id && customerIds.add(row.customer_id));
  }

  let appUserTrial = null;
  if (user_id) {
    const { data } = await supabaseAdmin
      .from("app_users")
      .select("trial_start, trial_end")
      .eq("user_id", user_id)
      .maybeSingle();
    appUserTrial = data || null;
  }

  let directSubRows = [];
  if (user_id) {
    const { data } = await supabaseAdmin
      .from("app_subscriptions")
      .select("status, trial_start, trial_end, user_id, stripe_customer_id, customer_id, updated_at")
      .eq("user_id", user_id)
      .order("updated_at", { ascending: false })
      .limit(20);
    directSubRows = data || [];
  }

  const customerSubRows = [];
  for (const customerId of customerIds) {
    const { data } = await supabaseAdmin
      .from("app_subscriptions")
      .select("status, trial_start, trial_end, user_id, stripe_customer_id, customer_id, updated_at")
      .or(`stripe_customer_id.eq.${customerId},customer_id.eq.${customerId}`)
      .order("updated_at", { ascending: false })
      .limit(20);
    (data || []).forEach((row) => customerSubRows.push(row));
  }

  const allSubRows = [];
  const seen = new Set();
  for (const row of [...(directSubRows || []), ...(customerSubRows || [])]) {
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
    allSubRows.push(row);
  }

  let sawAnyTrialSignal = !!(appUserTrial?.trial_start || appUserTrial?.trial_end);
  if (!sawAnyTrialSignal) {
    sawAnyTrialSignal = allSubRows.some((row) => {
      const status = String(row?.status || "").toLowerCase();
      return !!(row?.trial_start || row?.trial_end || status === "trialing");
    });
  }

  return {
    sawAnyTrialSignal,
    customerIds: [...customerIds],
  };
}

/* ------------------------------- handler -------------------------------- */
export default async function handler(req, res) {
  const {
    NODE_ENV,
    STRIPE_SECRET_KEY,
    STRIPE_PRICE_ID_MONTHLY,
    STRIPE_PRICE_ID_ANNUAL,

    STRIPE_SECRET_KEY_LIVE,
    STRIPE_PRICE_ID_MONTHLY_LIVE,
    STRIPE_PRICE_ID_ANNUAL_LIVE,

    STRIPE_TRIAL_DAYS,

    APP_BASE_URL = "https://slimcal.ai",
    ALLOWED_ORIGIN = "https://slimcal.ai",
  } = process.env;

  setCors(res, ALLOWED_ORIGIN);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const useLive = NODE_ENV === "production" && !!STRIPE_SECRET_KEY_LIVE;
  const envLabel = useLive ? "LIVE" : "TEST";

  let stripe; // declare up here so catch can log
  try {
    const secretKey = useLive ? STRIPE_SECRET_KEY_LIVE : STRIPE_SECRET_KEY;
    const priceMonthly = useLive ? STRIPE_PRICE_ID_MONTHLY_LIVE : STRIPE_PRICE_ID_MONTHLY;
    const priceAnnual  = useLive ? STRIPE_PRICE_ID_ANNUAL_LIVE  : STRIPE_PRICE_ID_ANNUAL;

    if (!secretKey) throw new Error(`[${envLabel}] Missing Stripe secret key`);
    const { default: Stripe } = await import("stripe");
    stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" });

    const body = await readJson(req);
    const {
      user_id,
      email,
      period, // "monthly" | "annual"
      success_path = "/pro-success",
      cancel_path  = "/",
      // client hint only — server enforces anyway
      trial_eligible: trialEligibleHint,
    } = body || {};

    if (!user_id) throw new Error("Missing user_id");
    if (period !== "monthly" && period !== "annual") {
      throw new Error("period must be 'monthly' or 'annual'");
    }

    const priceId = period === "annual" ? priceAnnual : priceMonthly;
    if (!priceId) throw new Error(`[${envLabel}] Missing price for period='${period}'`);

    // Supabase admin (optional but used for trial enforcement + customer mapping)
    let supabaseAdmin = null;
    try {
      const mod = await import("./_lib/supabaseAdmin.js");
      supabaseAdmin = mod.supabaseAdmin || null;
    } catch {
      /* optional */
    }

    // ---- ONE-TRIAL-ONLY ENFORCEMENT (server-side) -------------------------
    let trialEligibleServer = true;
    let knownCustomerIds = [];

    if (supabaseAdmin) {
      const trialSignals = await getLatestTrialSignals(supabaseAdmin, { user_id, email });
      trialEligibleServer = !trialSignals.sawAnyTrialSignal;
      knownCustomerIds = trialSignals.customerIds || [];
    }

    // Default trialDays from env, but only apply if eligible
    const trialDaysEnv = Number.isFinite(Number(STRIPE_TRIAL_DAYS)) ? Number(STRIPE_TRIAL_DAYS) : 0;
    const trialDaysEffective = (trialDaysEnv > 0 && trialEligibleServer) ? trialDaysEnv : 0;

    // If client claims eligible but server says no, we ignore client.
    // If server can't check (no supabaseAdmin), we fall back to client hint (best-effort).
    const trialEligible =
      supabaseAdmin ? trialEligibleServer : !!trialEligibleHint;

    // Try to find an existing Stripe customer mapping for this user first, then email-linked history.
    let stripeCustomerId = null;
    if (supabaseAdmin) {
      const { data: rows, error: selectErr } = await supabaseAdmin
        .from("app_stripe_customers")
        .select("customer_id, updated_at, user_id, email")
        .eq("user_id", user_id)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (selectErr && selectErr.code !== "PGRST116") {
        console.warn("[checkout] supabase app_stripe_customers select error:", selectErr);
      }
      stripeCustomerId = rows?.[0]?.customer_id || knownCustomerIds?.[0] || null;
    }

    if (stripeCustomerId) {
      try {
        await stripe.customers.retrieve(stripeCustomerId);
      } catch {
        stripeCustomerId = null;
      }
    }

    // Build URLs
    const successUrl = absUrl(
      success_path.includes("session_id")
        ? success_path
        : `${success_path}${success_path.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`,
      APP_BASE_URL
    );
    const cancelUrl = absUrl(cancel_path, APP_BASE_URL);

    // Base session payload
    const sessionPayload = {
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      client_reference_id: user_id,
      metadata: {
        user_id,
        email: email || null,
        period,
        env: envLabel,
        trial_eligible: trialEligible ? "true" : "false",
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    };

    // Apply trial only if eligible (and trial days configured)
    if (trialDaysEffective > 0) {
      sessionPayload.subscription_data = {
        trial_period_days: trialDaysEffective,
        metadata: { user_id, email: email || null, env: envLabel },
      };
    }

    // EITHER customer OR customer_email (never both)
    if (stripeCustomerId) {
      sessionPayload.customer = stripeCustomerId;
    } else {
      if (!email) throw new Error("Missing email for new customer checkout");
      sessionPayload.customer_email = email;
    }

    const session = await stripe.checkout.sessions.create(sessionPayload);

    // Keep mapping up to date if we have customer immediately
    if (session.customer && typeof session.customer === "string" && supabaseAdmin) {
      try {
        await supabaseAdmin
          .from("app_stripe_customers")
          .upsert(
            {
              customer_id: session.customer,
              user_id,
              email: email ?? null,
              updated_at: nowIso(),
            },
            { onConflict: "customer_id" }
          );
      } catch (e) {
        console.warn("[checkout] upsert app_stripe_customers warning:", e?.message || e);
      }
    }

    console.log(
      `[checkout:${envLabel}] session ${session.id} created for ${
        stripeCustomerId ? `customer ${stripeCustomerId}` : (email || user_id)
      } -> ${session.url} | trialEligible=${trialEligible} trialDays=${trialDaysEffective}`
    );

    return res.status(200).json({ id: session.id, url: session.url, trialEligible, trialDays: trialDaysEffective });
  } catch (err) {
    console.error(`[checkout:${envLabel}] error`, err);
    return res.status(400).json({ error: err?.message || "Failed to create checkout session" });
  }
}
