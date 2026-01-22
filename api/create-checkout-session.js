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
  try {
    return new URL(pathOrUrl).toString();
  } catch {
    return new URL(pathOrUrl, base).toString();
  }
}
function nowIso() {
  return new Date().toISOString();
}
function toDate(v) {
  try {
    return v ? new Date(v) : null;
  } catch {
    return null;
  }
}
function isValidDate(d) {
  return d instanceof Date && !isNaN(d);
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
    const priceAnnual = useLive ? STRIPE_PRICE_ID_ANNUAL_LIVE : STRIPE_PRICE_ID_ANNUAL;

    if (!secretKey) throw new Error(`[${envLabel}] Missing Stripe secret key`);
    const { default: Stripe } = await import("stripe");
    stripe = new Stripe(secretKey, { apiVersion: "2024-06-20" });

    const body = await readJson(req);
    const {
      user_id,
      email,
      period, // "monthly" | "annual"
      success_path = "/pro-success",
      cancel_path = "/",

      // Optional hint from client — SERVER DOES NOT TRUST IT
      trial_eligible: trialEligibleHint,
    } = body || {};

    if (!user_id) throw new Error("Missing user_id");
    if (period !== "monthly" && period !== "annual") {
      throw new Error("period must be 'monthly' or 'annual'");
    }

    const priceId = period === "annual" ? priceAnnual : priceMonthly;
    if (!priceId) throw new Error(`[${envLabel}] Missing price for period='${period}'`);

    // Try to find an existing Stripe customer mapping for this user.
    // If found, we pass customer (only). If not found, we pass customer_email (only).
    let supabaseAdmin = null;
    try {
      const mod = await import("./_lib/supabaseAdmin.js");
      supabaseAdmin = mod.supabaseAdmin || null;
    } catch {
      /* optional */
    }

    // -------------------------------
    // Enforce ONE TRIAL PER ACCOUNT (server-truth)
    // -------------------------------
    let trialUsed = false;
    let trialEligible = false;

    if (supabaseAdmin) {
      try {
        // app_users is authoritative for "has trial ever happened"
        const { data: userRow, error: userErr } = await supabaseAdmin
          .from("app_users")
          .select("user_id, email, trial_start, trial_end")
          .eq("user_id", user_id)
          .maybeSingle();

        if (userErr && userErr.code !== "PGRST116") {
          console.warn("[checkout] app_users select error:", userErr);
        }

        const userTrialStart = toDate(userRow?.trial_start);
        const userTrialEnd = toDate(userRow?.trial_end);

        // Also check latest subscription snapshot for trial_end (extra safety)
        const { data: subRow, error: subErr } = await supabaseAdmin
          .from("app_subscriptions")
          .select("trial_end, updated_at")
          .eq("user_id", user_id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (subErr && subErr.code !== "PGRST116") {
          console.warn("[checkout] app_subscriptions select error:", subErr);
        }

        const subTrialEnd = toDate(subRow?.trial_end);

        trialUsed =
          !!userTrialStart ||
          !!userTrialEnd ||
          (isValidDate(subTrialEnd) ? true : false);

        trialEligible = !trialUsed;
      } catch (e) {
        // If we can't confirm, default to safest: do NOT grant a trial
        console.warn("[checkout] trial eligibility check failed; defaulting trialEligible=false:", e?.message || e);
        trialUsed = true;
        trialEligible = false;
      }
    } else {
      // No supabase admin available -> safest: no trial
      trialUsed = true;
      trialEligible = false;
    }

    // Compute trial days we will ACTUALLY apply (server enforced)
    const envTrialDays = Number.isFinite(Number(STRIPE_TRIAL_DAYS)) ? Number(STRIPE_TRIAL_DAYS) : 0;
    const effectiveTrialDays = trialEligible ? envTrialDays : 0;

    // If client hinted trial_eligible but server disagrees, we ignore client
    if (typeof trialEligibleHint === "boolean" && trialEligibleHint !== trialEligible) {
      console.log(
        `[checkout] trialEligible hint mismatch; client=${trialEligibleHint} server=${trialEligible} user_id=${user_id}`
      );
    }

    // -------------------------------
    // Existing Stripe customer lookup
    // -------------------------------
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
      stripeCustomerId = rows?.[0]?.customer_id || null;
    }

    // If we think we have a customer, verify it exists; otherwise, ignore it.
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

    // Base session payload (shared)
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
        trial_used: String(trialUsed),
        trial_eligible: String(trialEligible),
        effective_trial_days: String(effectiveTrialDays),
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    };

    // IMPORTANT: Only apply trial if eligible AND env trial days > 0
    if (effectiveTrialDays > 0) {
      sessionPayload.subscription_data = {
        trial_period_days: effectiveTrialDays,
        metadata: {
          user_id,
          email: email || null,
          env: envLabel,
          trial_used: String(trialUsed),
          trial_eligible: String(trialEligible),
        },
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

    // If this session already has a customer (happens when we passed 'customer'),
    // we can ensure our mapping is up to date. For the customer_email path,
    // we'll persist the created customer in the Stripe webhook after completion.
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
      } -> ${session.url} (trialEligible=${trialEligible}, trialDays=${effectiveTrialDays})`
    );

    // Return server truth (useful for UI debugging)
    return res.status(200).json({
      id: session.id,
      url: session.url,
      trialEligible,
      trialUsed,
      effectiveTrialDays,
    });
  } catch (err) {
    console.error(`[checkout:${envLabel}] error`, err);
    return res.status(400).json({ error: err?.message || "Failed to create checkout session" });
  }
}
