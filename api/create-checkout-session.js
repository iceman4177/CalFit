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

/* ------------------------------- handler -------------------------------- */
export default async function handler(req, res) {
  const {
    NODE_ENV,
    STRIPE_SECRET_KEY,
    STRIPE_PRICE_ID_MONTHLY,
    STRIPE_PRICE_ID_ANNUAL,

    // LIVE keys
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

  try {
    // --- Stripe init (env-aware) ---
    const secretKey = useLive ? STRIPE_SECRET_KEY_LIVE : STRIPE_SECRET_KEY;
    const priceMonthly = useLive ? STRIPE_PRICE_ID_MONTHLY_LIVE : STRIPE_PRICE_ID_MONTHLY;
    const priceAnnual  = useLive ? STRIPE_PRICE_ID_ANNUAL_LIVE  : STRIPE_PRICE_ID_ANNUAL;

    if (!secretKey) throw new Error(`[${envLabel}] Missing Stripe secret key`);
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(secretKey, { apiVersion: "2023-10-16" });

    // --- parse body ---
    const body = await readJson(req);
    const {
      user_id,
      email,
      period, // "monthly" | "annual"
      success_path = "/pro-success",
      cancel_path  = "/",
    } = body || {};

    if (!user_id) throw new Error("Missing user_id");
    if (period !== "monthly" && period !== "annual") {
      throw new Error("period must be 'monthly' or 'annual'");
    }

    const priceId = period === "annual" ? priceAnnual : priceMonthly;
    if (!priceId) throw new Error(`[${envLabel}] Missing price for period='${period}'`);

    // --- optional Supabase admin ---
    let supabaseAdmin = null;
    try {
      const mod = await import("./_lib/supabaseAdmin.js");
      supabaseAdmin = mod.supabaseAdmin || null;
    } catch {
      /* no supabase available in this environment */
    }

    // -------------------- Find or create a Stripe Customer --------------------
    // We NEVER trust any client-sent customer ID. We read any mapping we have,
    // VALIDATE it against current Stripe env, and if invalid/missing we create fresh.
    let stripeCustomerId = null;

    // 1) Try to read the most recent mapping row by user_id
    if (supabaseAdmin) {
      const { data: rows, error: selectErr } = await supabaseAdmin
        .from("app_stripe_customers")
        .select("customer_id, updated_at, user_id, email")
        .eq("user_id", user_id)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (selectErr) {
        console.error("[checkout] supabase select error", selectErr);
      } else if (rows && rows.length) {
        stripeCustomerId = typeof rows[0].customer_id === "string" ? rows[0].customer_id.trim() : null;
      }
    }

    // 2) If we have a candidate, VALIDATE it belongs to this Stripe env
    if (stripeCustomerId) {
      try {
        await stripe.customers.retrieve(stripeCustomerId);
        // ok—customer exists in THIS env
      } catch (e) {
        const status = e?.statusCode || e?.status || 0;
        const type = e?.raw?.type;
        console.warn(`[checkout:${envLabel}] stale/missing customer ${stripeCustomerId} (${status}, ${type}). Will create a new one.`);
        stripeCustomerId = null;
      }
    }

    // 3) If still missing, create a fresh customer in the CURRENT env
    if (!stripeCustomerId) {
      const created = await stripe.customers.create({
        email: email || undefined,
        metadata: { app_user_id: user_id, env: envLabel },
      });
      stripeCustomerId = created.id;

      // Upsert mapping so the newest row (by updated_at) is the one we just created.
      if (supabaseAdmin) {
        try {
          await supabaseAdmin
            .from("app_stripe_customers")
            .insert({
              customer_id: stripeCustomerId,
              user_id,
              email: email ?? null,
              updated_at: nowIso(),
            });
        } catch (mapErr) {
          // If you have a unique constraint on customer_id, fallback to update
          try {
            await supabaseAdmin
              .from("app_stripe_customers")
              .update({ email: email ?? null, updated_at: nowIso() })
              .eq("customer_id", stripeCustomerId);
          } catch (mapErr2) {
            console.error("[checkout] supabase map upsert/update failed", mapErr, mapErr2);
          }
        }
      }
    }

    // -------------------- Create Checkout Session --------------------
    const successUrl = absUrl(
      success_path.includes("session_id")
        ? success_path
        : `${success_path}${success_path.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`,
      APP_BASE_URL
    );
    const cancelUrl  = absUrl(cancel_path, APP_BASE_URL);
    const trialDays  = Number.isFinite(Number(STRIPE_TRIAL_DAYS)) ? Number(STRIPE_TRIAL_DAYS) : 0;

    const sessionPayload = {
      mode: "subscription",
      customer: stripeCustomerId,                // authoritative env-correct customer id
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      client_reference_id: user_id,
      // ✅ ensure email comes through in both places Stripe exposes it
      customer_email: email || undefined,
      metadata: { user_id, email: email || null, period, env: envLabel },
      success_url: successUrl,
      cancel_url: cancelUrl,
    };
    if (trialDays > 0) {
      sessionPayload.subscription_data = {
        trial_period_days: trialDays,
        metadata: { user_id, email: email || null, env: envLabel },
      };
    }

    const session = await stripe.checkout.sessions.create(sessionPayload);

    console.log(`[checkout:${envLabel}] session ${session.id} created for ${email || user_id} -> ${session.url}`);
    return res.status(200).json({ id: session.id, url: session.url });
  } catch (err) {
    console.error(`[checkout:${envLabel}] error`, err);
    return res.status(400).json({ error: err?.message || "Failed to create checkout session" });
  }
}
