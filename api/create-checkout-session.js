// src/api/create-checkout-session.js

import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  try {
    const price = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID);
    if (!price || !price.active) {
      throw new Error("Price not found or inactive");
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      subscription_data: {
        trial_period_days: 7,
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
