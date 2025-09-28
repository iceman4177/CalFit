// api/create-checkout-session.js
export const config = { api: { bodyParser: false } };

// ---- utils ----
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
function coerceCustomerId(val) {
  if (!val) return null;
  if (typeof val === "string") {
    const s = val.trim();
    if (s.startsWith("{")) {
      try {
        const o = JSON.parse(s);
        return typeof o?.id === "string" ? o.id : null;
      } catch { /* fallthrough */ }
    }
    return s;
  }
  if (typeof val === "object" && val && typeof val.id === "string") return val.id;
  return null;
}

export default async function handler(req, res) {
  const {
    STRIPE_SECRET_KEY,
    STRIPE_PRICE_ID_MONTHLY,
    STRIPE_PRICE_ID_ANNUAL,
    STRIPE_TRIAL_DAYS,
    APP_BASE_URL = "https://slimcal.ai",
    ALLOWED_ORIGIN = "https://slimcal.ai",
  } = process.env;

  setCors(res, ALLOWED_ORIGIN);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { default: Stripe } = await import("stripe");
    if (!STRIPE_SECRET_KEY) throw new Error("Missing STRIPE_SECRET_KEY (server env)");
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

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

    const priceId = period === "annual" ? STRIPE_PRICE_ID_ANNUAL : STRIPE_PRICE_ID_MONTHLY;
    if (!priceId) throw new Error(`Server missing price for period='${period}' (check STRIPE_PRICE_ID_*)`);

    // Try to import Supabase admin; continue if unavailable
    let supabaseAdmin = null;
    try {
      const mod = await import("./_lib/supabaseAdmin.js");
      supabaseAdmin = mod.supabaseAdmin || null;
    } catch {}

    // ---------- Ensure or create Stripe customer (and persist mapping) ----------
    let stripeCustomerId = null;

    if (supabaseAdmin) {
      // Read newest mapping (duplicates safe)
      const { data: rows, error: selectErr } = await supabaseAdmin
        .from("app_stripe_customers")
        .select("customer_id, updated_at, user_id")
        .eq("user_id", user_id)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (selectErr) throw selectErr;

      stripeCustomerId = coerceCustomerId(rows?.[0]?.customer_id);

      // Best-effort clean-up: if the newest row is JSON, rewrite it to just the ID
      if (rows?.[0]?.customer_id && rows[0].customer_id !== stripeCustomerId) {
        try {
          await supabaseAdmin
            .from("app_stripe_customers")
            .update({
              customer_id: stripeCustomerId,
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", user_id)
            .eq("customer_id", rows[0].customer_id);
        } catch {}
      }
    }

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: email || undefined,
        metadata: { app_user_id: user_id },
      });
      stripeCustomerId = customer.id;

      if (supabaseAdmin) {
        const { error: mapErr } = await supabaseAdmin
          .from("app_stripe_customers")
          .upsert(
            {
              customer_id: stripeCustomerId,
              user_id,
              email: email ?? null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "customer_id" }
          );
        if (mapErr) throw mapErr;
      }
    }

    const successUrl = absUrl(
      success_path.includes("session_id")
        ? success_path
        : `${success_path}${success_path.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`,
      APP_BASE_URL
    );
    const cancelUrl  = absUrl(cancel_path, APP_BASE_URL);
    const trialDays  = Number.isFinite(Number(STRIPE_TRIAL_DAYS)) ? Number(STRIPE_TRIAL_DAYS) : 0;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,               // always a plain "cus_..." here
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      client_reference_id: user_id,
      metadata: { user_id, period },
      ...(trialDays > 0 ? { subscription_data: { trial_period_days: trialDays } } : {}),
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (err) {
    console.error("[checkout] error", err);
    return res.status(400).json({ error: err?.message || "Failed to create checkout session" });
  }
}
