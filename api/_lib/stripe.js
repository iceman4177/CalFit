// api/_lib/stripe.js
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error("Missing STRIPE_SECRET_KEY");

// Pin API version
export const stripe = new Stripe(key, {
  apiVersion: "2024-06-20",
});
