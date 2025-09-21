// api/create-checkout-session.js
import Stripe from "stripe";
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";

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

// Optionally centralize where the portal should send users after managing billing
const BILLING_RETURN_URL = process.env.BILLING_RETURN_URL || "https://slimcal.ai/pro";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  let body;
  try {
    body = await readJson(req);
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  // REQUIRED from client/app:
  // - user_id: your app's user (e.g., Supabase auth.uid())
  // - price_id: a *recurring* price_... id in Stripe
  const userId  = body?.user_id || null;
  const priceId = body?.price_id || null;
  const email   = body?.email   || null; // helpful for creating customer

  if (!userId)  return res.status(400).json({ error: "Missing user_id" });
  if (!priceId) return res.status(400).json({ error: "Missing price_id" });

  try {
    // 1) Ensure we have (or create) a Stripe customer and persist the mapping
    let stripeCustomerId = null;

    // See if we already mapped this user to a customer
    {
      const { data: existing, error: existingErr } = await supabaseAdmin
        .from("app_stripe_customers")
        .select("customer_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (existingErr) throw existingErr;
      stripeCustomerId = existing?.customer_id || null;
    }

    // Create a new customer in Stripe if we don't have one yet
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: email || undefined,
        metadata: { app_user_id: userId },
      });
      stripeCustomerId = customer.id;

      // Upsert the mapping
      const { error: mapErr } = await supabaseAdmin
        .from("app_stripe_customers")
        .upsert(
          {
            customer_id: stripeCustomerId, // your column name
            user_id: userId,
            email: email ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "customer_id" }
        );
      if (mapErr) throw mapErr;
    }

    // 2) Create the subscription checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: "https://slimcal.ai/pro-success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://slimcal.ai/pro",
      allow_promotion_codes: true,

      // >>> CRITICAL: include app user id so the webhook can map subscription -> user
      client_reference_id: userId,
      metadata: { user_id: userId },
    });

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (e) {
    console.error("[checkout] error", e);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
}
