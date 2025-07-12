// pages/api/create-checkout-session.js

import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  // only allow POST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  // debug
  console.log("🔑 STRIPE_SECRET_KEY loaded?", !!process.env.STRIPE_SECRET_KEY);
  console.log("💲 PRICE_ID:", process.env.STRIPE_PRICE_ID);

  try {
    // verify that the price exists and is active
    const price = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID);
    if (!price || !price.active) {
      throw new Error("Price not found or inactive");
    }
    console.log("→ price OK:", price.id);

    // create a subscription session with a 7-day free trial
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1
        }
      ],
      subscription_data: {
        trial_period_days: 7
      },
      // optionally capture the user’s email if you collect it client-side:
      // customer_email: req.body.email,
      success_url: `${req.headers.origin}/?checkout=success`,
      cancel_url:  `${req.headers.origin}/?checkout=cancel`
    });

    console.log("→ created session:", session.id);
    return res.status(200).json({ sessionId: session.id });
  } catch (err) {
    console.error("⚠️ Stripe error:", err);
    const message = err.raw?.message || err.message;
    return res.status(500).json({ error: message });
  }
}
