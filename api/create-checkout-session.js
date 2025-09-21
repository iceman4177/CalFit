// api/ai/create-checkout-session.js
import Stripe from "stripe";
import { supabaseAdmin } from "../_lib/supabaseAdmin.js";

// Use your current API version
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

export const config = { api: { bodyParser: false } };

// Read raw JSON body safely across runtimes
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

// Build absolute URL from a path and a base
function buildUrl(pathOrUrl, base) {
  try {
    // If already absolute, return as-is
    return new URL(pathOrUrl).toString();
  } catch {
    return new URL(pathOrUrl, base).toString();
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // ---- Server env (MUST be set on the server, not Vite) ----
  const {
    STRIPE_SECRET_KEY,
    STRIPE_PRICE_ID_MONTHLY,
    STRIPE_PRICE_ID_ANNUAL,
    STRIPE_TRIAL_DAYS,
    APP_BASE_URL = "https://slimcal.ai",
  } = process.env;

  if (!STRIPE_SECRET_KEY) return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY (server env)" });
  if (!STRIPE_PRICE_ID_MONTHLY && !STRIPE_PRICE_ID_ANNUAL) {
    return res.status(500).json({ error: "Missing STRIPE_PRICE_ID_MONTHLY/ANNUAL (server env)" });
  }

  let body;
  try {
    body = await readJson(req);
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  // REQUIRED from client/app:
  // - user_id: Supabase auth user id
  // - period : "monthly" | "annual"  (server chooses price from env)
  const userId  = body?.user_id || null;
  const period  = body?.period  || null; // <-- changed from price_id to period
  const email   = body?.email   || null;
  const clientReferenceId = body?.client_reference_id || undefined;

  // Optional UI paths (can be relative like "/pro-success")
  const successPath = body?.success_path || "/pro-success";
  const cancelPath  = body?.cancel_path  || "/";

  if (!userId)  return res.status(400).json({ error: "Missing user_id" });
  if (period !== "monthly" && period !== "annual") {
    return res.status(400).json({ error: "period must be 'monthly' or 'annual'" });
  }

  // Pick the server-side price id
  const priceId = period === "annual" ? STRIPE_PRICE_ID_ANNUAL : STRIPE_PRICE_ID_MONTHLY;
  if (!priceId) {
    return res.status(400).json({ error: `Server missing price for period='${period}'` });
  }

  try {
    // 1) Ensure Stripe customer for this user (persist in DB)
    let stripeCustomerId = null;

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from("app_stripe_customers")
      .select("customer_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (existingErr) throw existingErr;
    stripeCustomerId = existing?.customer_id || null;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: email || undefined,
        metadata: { app_user_id: userId },
      });
      stripeCustomerId = customer.id;

      const { error: mapErr } = await supabaseAdmin
        .from("app_stripe_customers")
        .upsert(
          {
            customer_id: stripeCustomerId,
            user_id: userId,
            email: email ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "customer_id" }
        );
      if (mapErr) throw mapErr;
    }

    // 2) Create the subscription checkout session
    const successUrl = buildUrl(
      successPath.includes("session_id") ? successPath : `${successPath}${successPath.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`,
      APP_BASE_URL
    );
    const cancelUrl  = buildUrl(cancelPath, APP_BASE_URL);

    const trialDays = Number.isFinite(Number(STRIPE_TRIAL_DAYS)) ? Number(STRIPE_TRIAL_DAYS) : 0;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      client_reference_id: clientReferenceId || userId,
      metadata: { user_id: userId, period },
      ...(trialDays > 0 ? { subscription_data: { trial_period_days: trialDays } } : {}),
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (e) {
    console.error("[checkout] error", e);
    // Return a descriptive error so the frontend can show it
    return res.status(400).json({ error: e.message || "Failed to create checkout session" });
  }
}
