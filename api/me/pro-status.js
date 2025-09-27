// Always return JSON with 200; never 500.
export default async function handler(req, res) {
  try {
    // Basic input
    const user_id = (req.query.user_id || req.body?.user_id || "").trim();
    if (!user_id) {
      return res.status(200).json({ isPro: false, reason: "bad_request", detail: "Missing user_id" });
    }

    // Lazy import so module-scope errors don't crash this route
    let supabaseAdmin = null;
    try {
      const mod = await import("./_lib/supabaseAdmin.js");
      supabaseAdmin = mod.supabaseAdmin || null;
    } catch (e) {
      // ignore; handled below
    }
    if (!supabaseAdmin) {
      return res.status(200).json({
        isPro: false,
        reason: "server_config",
        detail: "Supabase admin not configured (check SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)",
      });
    }

    const active = ["trialing", "active", "past_due"];

    // 1) Fast path: subscriptions by user_id
    const { data: sUser, error: eUser } = await supabaseAdmin
      .from("app_subscriptions")
      .select("status")
      .eq("user_id", user_id)
      .in("status", active)
      .limit(1);

    if (!eUser && sUser?.length) {
      return res.status(200).json({ isPro: true, source: "user_id" });
    }
    if (eUser) console.warn("[pro-status] subs by user_id error:", eUser.message);

    // 2) Find mapped customer (support both column names)
    let customerId = null;

    const { data: c1, error: ce1 } = await supabaseAdmin
      .from("app_stripe_customers")
      .select("customer_id")
      .eq("user_id", user_id)
      .maybeSingle();

    if (ce1 && ce1.code !== "PGRST116") {
      return res.status(200).json({ isPro: false, reason: "db_error_customers", detail: ce1.message });
    }
    customerId = c1?.customer_id || null;

    if (!customerId) {
      const { data: c2, error: ce2 } = await supabaseAdmin
        .from("app_stripe_customers")
        .select("stripe_customer_id")
        .eq("user_id", user_id)
        .maybeSingle();

      if (ce2 && ce2.code !== "PGRST116") {
        return res.status(200).json({ isPro: false, reason: "db_error_customers", detail: ce2.message });
      }
      customerId = c2?.stripe_customer_id || null;
    }

    // 3) Check subs by customerId (support both column names)
    if (customerId) {
      const { data: sA, error: eA } = await supabaseAdmin
        .from("app_subscriptions")
        .select("status")
        .eq("stripe_customer_id", customerId)
        .in("status", active)
        .limit(1);

      if (!eA && sA?.length) {
        return res.status(200).json({ isPro: true, source: "stripe_customer_id" });
      }
      if (eA && eA.code !== "PGRST116") {
        const { data: sB, error: eB } = await supabaseAdmin
          .from("app_subscriptions")
          .select("status")
          .eq("customer_id", customerId)
          .in("status", active)
          .limit(1);

        if (!eB && sB?.length) {
          return res.status(200).json({ isPro: true, source: "customer_id" });
        }
        if (eB && eB.code !== "PGRST116") {
          return res.status(200).json({ isPro: false, reason: "db_error_subscriptions", detail: eB.message });
        }
      }
    }

    // Nothing active yet
    return res.status(200).json({
      isPro: false,
      reason: customerId ? "no_active_subscription" : "no_customer_mapping",
    });
  } catch (e) {
    console.error("[/api/me/pro-status] fatal:", e);
    return res.status(200).json({ isPro: false, reason: "server_error", detail: e?.message || String(e) });
  }
}
