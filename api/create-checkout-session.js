// api/create-checkout-session.js
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  // Quick sanity checks
  console.log("🔑 KEY:", !!process.env.STRIPE_SECRET_KEY);
  console.log("💲 PRICE:", process.env.STRIPE_PRICE_ID);

  try {
    // Try retrieving the price first to verify it exists
    const price = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID);
    console.log("→ Retrieved price object:", price.id, price.active);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        { price: process.env.STRIPE_PRICE_ID, quantity: 1 }
      ],
      success_url: `${req.headers.origin}/?checkout=success`,
      cancel_url: `${req.headers.origin}/?checkout=cancel`
    });

    return res.status(200).json({ sessionId: session.id });
  } catch (err) {
    // Dump the full error for debugging
    console.error("⚠️ Stripe error:", err);
    // If it's a StripeError, err.raw.message has the human‑readable text
    const stripeMsg = err.raw?.message || err.message;
    return res.status(500).json({ error: stripeMsg });
  }
}
