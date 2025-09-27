// /api/me/pro-status.js
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";

/**
 * Returns { isPro: boolean, reason?: string }
 * Truth from DB only — used by ProSuccess and anywhere else you want server-guaranteed status.
 *
 * Tables expected:
 * - app_stripe_customers(customer_id text PK, user_id uuid, email text, updated_at timestamptz)
 * - app_subscriptions(stripe_subscription_id text PK, user_id uuid, status text, current_period_end timestamptz, ...)
 *
 * Policy: This is a serverless function using the service role key; it can read through RLS.
 */
export default async function handler(req, res) {
  try {
    const user_id = (req.query.user_id || req.body?.user_id || "").trim();
    if (!user_id) return res.status(400).json({ error: "Missing user_id" });

    // Find mapped customer for this user
    const { data: cust, error: custErr } = await supabaseAdmin
      .from("app_stripe_customers")
      .select("customer_id")
      .eq("user_id", user_id)
      .maybeSingle();

    if (custErr) throw new Error(custErr.message);

    if (!cust?.customer_id) {
      return res.json({ isPro: false, reason: "no_customer" });
    }

    // Any active/trialing subscription for that customer (or user_id — both work with your webhook)
    const { data: subs, error: subErr } = await supabaseAdmin
      .from("app_subscriptions")
      .select("status")
      .eq("user_id", user_id)
      .in("status", ["trialing", "active", "past_due"])
      .limit(1);

    if (subErr) throw new Error(subErr.message);

    return res.json({ isPro: !!(subs && subs.length > 0) });
  } catch (e) {
    console.error("[pro-status] error:", e);
    res.status(500).json({ error: e.message || "Server error" });
  }
}
