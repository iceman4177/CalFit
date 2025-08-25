// src/api/create-checkout-session.js
import Stripe from "stripe";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  try {
    // Decide mode: explicit STRIPE_MODE first, else default by NODE_ENV
    const mode =
      process.env.STRIPE_MODE ||
      (process.env.NODE_ENV === "production" ? "live" : "test");

    const secretKey =
      mode === "live"
        ? process.env.STRIPE_SECRET_KEY_LIVE
        : process.env.STRIPE_SECRET_KEY_TEST;

    const priceId =
      mode === "live"
        ? process.env.STRIPE_PRICE_ID_MONTHLY_LIVE
        : process.env.STRIPE_PRICE_ID_MONTHLY_TEST;

    if (!secretKey) throw new Error("Stripe secret key not configured");
    if (!priceId) throw new Error("Stripe price ID not configured");

    const stripe = new Stripe(secretKey);

    // Validate price exists
    const price = await stripe.prices.retrieve(priceId);
    if (!price || !price.active) {
      throw new Error("Price not found or inactive");
    }

    const trialDays = parseInt(process.env.STRIPE_TRIAL_DAYS || "7", 10);

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      subscription_data: {
        trial_period_days: trialDays,
      },
      success_url: `${req.headers.origin}/pro-success`,
      cancel_url: `${req.headers.origin}/?checkout=cancel`,
    });

    return res.status(200).json({ sessionId: session.id });
  } catch (err) {
    console.error("⚠️ Stripe error:", err);
    const message = err.raw?.message || err.message;
    return res.status(500).json({ error: message });
  }
}
