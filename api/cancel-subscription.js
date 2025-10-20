// api/cancel-subscription.js
import Stripe from "stripe";
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";

export const config = { api: { bodyParser: true } };

// -----------------------------------------------------------------------------
// Live/Test key detection
// -----------------------------------------------------------------------------
const useLive =
  process.env.NODE_ENV === "production" && process.env.STRIPE_SECRET_KEY_LIVE;

const stripe = new Stripe(
  useLive ? process.env.STRIPE_SECRET_KEY_LIVE : process.env.STRIPE_SECRET_KEY,
  { apiVersion: "2023-10-16" }
);

// -----------------------------------------------------------------------------
// Cancel a subscription at period end
// -----------------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const { subscription_id, user_id } = req.body || {};
    if (!subscription_id) throw new Error("Missing subscription_id");
    if (!user_id) throw new Error("Missing user_id");

    // Cancel at period end (so they keep access until trial/billing ends)
    const sub = await stripe.subscriptions.update(subscription_id, {
      cancel_at_period_end: true,
    });

    // Reflect the change in Supabase
    await supabaseAdmin
      .from("app_subscriptions")
      .update({
        cancel_at_period_end: true,
        status: sub.status,
        updated_at: new Date().toISOString(),
      })
      .eq("subscription_id", subscription_id);

    // Optional: proactively mark user as still pro until trial ends
    if (sub.status === "trialing" || sub.status === "active") {
      await supabaseAdmin
        .from("app_users")
        .update({
          is_pro: true,
          trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
        })
        .eq("user_id", user_id);
    }

    return res.status(200).json({ ok: true, subscription: sub });
  } catch (err) {
    console.error("[cancel-subscription] error:", err);
    return res.status(400).json({ error: err?.message || "Failed to cancel subscription" });
  }
}
