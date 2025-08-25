// /api/create-checkout-session.js
import Stripe from "stripe";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  try {
    // Use live vs test based on environment
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

    console.log("🔑 Stripe mode:", mode);
    console.log("🔑 Using secret key prefix:", secretKey?.slice(0, 7));
    console.log("💲 Price ID:", priceId);

    if (!secretKey) throw new Error("❌ STRIPE_SECRET_KEY not set");
    if (!priceId) throw new Error("❌ STRIPE_PRICE_ID not set");

    const stripe = new Stripe(secretKey);

    // validate price exists
    const price = await stripe.prices.retrieve(priceId);
    if (!price?.active) {
      throw new Error("❌ Price not found or inactive");
    }

    const trialDays = parseInt(process.env.STRIPE_TRIAL_DAYS || "7", 10);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      subscription_data: {
        trial_period_days: trialDays
      },
      success_url: `${req.headers.origin}/pro-success`,
      cancel_url: `${req.headers.origin}/?checkout=cancel`
    });

    console.log("✅ Created session:", session.id);
    return res.status(200).json({ sessionId: session.id });
  } catch (err) {
    console.error("⚠️ Stripe error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}
