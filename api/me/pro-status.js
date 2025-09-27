// /api/me/pro-status.js
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";

/**
 * Robust Pro-status checker.
 * - Works whether your mapping table uses `customer_id` OR `stripe_customer_id`.
 * - Falls back to checking app_subscriptions by user_id directly.
 * - Never throws 500 without a helpful JSON body.
 *
 * Returns: { isPro: boolean, reason?: string, detail?: string }
 */
export default async function handler(req, res) {
  try {
    const user_id = (req.query.user_id || req.body?.user_id || "").trim();
    if (!user_id) {
      return res.status(400).json({ isPro: false, reason: "bad_request", detail: "Missing user_id" });
    }

    // ---- 1) Try to find a mapped customer for this user ----
    // Support both schemas: customer_id OR stripe_customer_id
    let customerId = null;

    // Attempt 1: field `customer_id`
    let { data: cust1, error: e1 } = await supabaseAdmin
      .from("app_stripe_customers")
      .select("customer_id")
      .eq("user_id", user_id)
      .maybeSingle();

    if (e1 && e1.code !== "PGRST116") { // ignore "not found"
      // Surface the error rather than 500
      return res.status(200).json({ isPro: false, reason: "db_error_customers", detail: e1.message });
    }
    customerId = cust1?.customer_id || null;

    // Attempt 2: field `stripe_customer_id`
    if (!customerId) {
      const { data: cust2, error: e2 } = await supabaseAdmin
        .from("app_stripe_customers")
        .select("stripe_customer_id")
        .eq("user_id", user_id)
        .maybeSingle();

      if (e2 && e2.code !== "PGRST116") {
        return res.status(200).json({ isPro: false, reason: "db_error_customers", detail: e2.message });
      }
      customerId = cust2?.stripe_customer_id || null;
    }

    // ---- 2) If we have a customer ID, try active subs by that mapping OR by user_id ----
    // (Some schemas write subscriptions with user_id; some with customer_id + user_id)
    const activeStatuses = ["trialing", "active", "past_due"];

    // Option A: by user_id directly
    const { data: subsByUser, error: eU } = await supabaseAdmin
      .from("app_subscriptions")
      .select("status")
      .eq("user_id", user_id)
      .in("status", activeStatuses)
      .limit(1);

    if (eU) {
      // Not fatal—continue to try by customerId
      console.warn("[pro-status] subscriptions by user_id error:", eU.message);
    }

    if (subsByUser && subsByUser.length > 0) {
      return res.status(200).json({ isPro: true });
    }

    // Option B: by customer_id (support both possible column names)
    if (customerId) {
      // Try a column named `stripe_customer_id`
      let { data: subsByCust, error: eC } = await supabaseAdmin
        .from("app_subscriptions")
        .select("status")
        .eq("stripe_customer_id", customerId)
        .in("status", activeStatuses)
        .limit(1);

      if (eC && eC.code !== "PGRST116") {
        // Try a column named just `customer_id` as a fallback
        const { data: subsByCust2, error: eC2 } = await supabaseAdmin
          .from("app_subscriptions")
          .select("status")
          .eq("customer_id", customerId)
          .in("status", activeStatuses)
          .limit(1);

        if (eC2 && eC2.code !== "PGRST116") {
          return res.status(200).json({ isPro: false, reason: "db_error_subscriptions", detail: eC2.message });
        }

        if (subsByCust2 && subsByCust2.length > 0) {
          return res.status(200).json({ isPro: true });
        }
      } else if (subsByCust && subsByCust.length > 0) {
        return res.status(200).json({ isPro: true });
      }
    }

    // ---- 3) No active subs found yet ----
    return res.status(200).json({
      isPro: false,
      reason: customerId ? "no_active_subscription" : "no_customer_mapping",
    });
  } catch (e) {
    // Never send a blank 500—return a debuggable JSON
    console.error("[/api/me/pro-status] fatal:", e);
    return res.status(200).json({
      isPro: false,
      reason: "server_error",
      detail: e?.message || String(e),
    });
  }
}
