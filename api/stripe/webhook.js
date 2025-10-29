// /api/stripe/webhook.js
export const config = { api: { bodyParser: false } };

import Stripe from "stripe";
import { supabaseAdmin } from "../_lib/supabaseAdmin.js";

// ------------ setup ------------
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY_LIVE);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET_LIVE;

// ------------ helper to read raw body ------------
async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ------------ handler ------------
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  let event;
  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(rawBody, signature, endpointSecret);
  } catch (err) {
    console.error("[webhook LIVE] Signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    console.log(`[webhook LIVE] event received: ${event.type}`);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        console.log("checkout.session.completed", session.id);
        // Optional: record mapping or trigger onboarding email
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const user_id = sub.metadata?.user_id || sub.client_reference_id;

        if (supabaseAdmin && user_id) {
          await supabaseAdmin.from("subscriptions").upsert({
            user_id,
            stripe_subscription_id: sub.id,
            stripe_customer_id: sub.customer,
            status: sub.status,
            cancel_at_period_end: sub.cancel_at_period_end,
            current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
            current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const inv = event.data.object;
        console.log("invoice.payment_succeeded", inv.id);
        break;
      }

      case "invoice.payment_failed": {
        const inv = event.data.object;
        console.warn("invoice.payment_failed", inv.id);
        break;
      }

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("[webhook LIVE] handler error", err);
    return res.status(500).send("Internal webhook error");
  }
}
