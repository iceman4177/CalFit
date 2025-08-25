// src/api/create-checkout-session.js
import Stripe from "stripe";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  try {
    // Expect single set of keys depending on environment
    const secretKey = process.env.STRIPE_SECRET_KEY;
    const priceId   = process.env.STRIPE_PRICE_ID_MONTHLY;

    if (!secretKey) throw new Error("❌ STRIPE_SECRET_KEY not set");
    if (!priceId)   throw new Error("❌ STRIPE_PRICE_ID_MONTHLY not set");

    const stripe = new Stripe(secretKey);

    // validate price
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
    return res.status(500).json({ error: err.message || "Server error" });
  }
}
