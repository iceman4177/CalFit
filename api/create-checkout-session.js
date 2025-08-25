// pages/api/create-checkout-session.js
import Stripe from "stripe";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  // Check env vars
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) {
    console.error("❌ Missing Stripe environment variables");
    return res.status(500).json({ error: "Payment configuration is missing. Please contact support." });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    // Verify price
    const price = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID);
    if (!price || !price.active) {
      console.error("❌ Price not found or inactive:", process.env.STRIPE_PRICE_ID);
      return res.status(500).json({ error: "Subscription price is not configured correctly." });
    }

    // Create a subscription checkout session
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
      success_url: `${req.headers.origin}/?checkout=success`,
      cancel_url: `${req.headers.origin}/?checkout=cancel`,
    });

    console.log("✅ Created Stripe checkout session:", session.id);
    return res.status(200).json({ sessionId: session.id });
  } catch (err) {
    console.error("⚠️ Stripe error:", err);

    // Detect common errors
    let message = "Checkout session failed.";
    if (err.code === "authentication_error" || err.message.includes("Expired API Key")) {
      message = "Payment configuration error: Expired or invalid Stripe API key.";
    } else if (err.code === "resource_missing") {
      message = "Stripe resource (like Price ID) not found.";
    } else if (err.raw?.message) {
      message = err.raw.message;
    } else if (err.message) {
      message = err.message;
    }

    return res.status(500).json({ error: message });
  }
}
