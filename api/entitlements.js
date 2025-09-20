// api/entitlements.js
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";

function allowCors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

const DEFAULT_PAYLOAD = {
  isPro: false,
  status: "none",
  trialEnd: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: null,
  customerId: null,
};

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const email = (req.query.email || "").trim().toLowerCase();
  const customerId = (req.query.customer || "").trim();

  if (!email && !customerId) {
    return res.status(400).json({ error: "Provide email or customer" });
  }

  try {
    // 1) Find customer row by customerId OR email
    let cust = null;
    if (customerId) {
      const { data, error } = await supabaseAdmin
        .from("app_stripe_customers")
        .select("*")
        .eq("customer_id", customerId)
        .limit(1);
      if (error) throw error;
      cust = (data && data[0]) || null;
    } else {
      const { data, error } = await supabaseAdmin
        .from("app_stripe_customers")
        .select("*")
        .eq("email", email)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      cust = (data && data[0]) || null;
    }

    if (!cust) return res.json(DEFAULT_PAYLOAD);

    // 2) Latest subscription by customer_id
    const { data: subs, error: subErr } = await supabaseAdmin
      .from("app_subscriptions")
      .select("*")
      .eq("customer_id", cust.customer_id)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (subErr) throw subErr;

    const sub = (subs && subs[0]) || null;
    if (!sub) {
      return res.json({ ...DEFAULT_PAYLOAD, customerId: cust.customer_id });
    }

    const status = sub.status;
    const isPro =
      status === "active" || status === "trialing" || status === "past_due";
    return res.json({
      isPro,
      status,
      trialEnd: sub.trial_end,
      currentPeriodEnd: sub.current_period_end,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      customerId: cust.customer_id,
      priceId: sub.price_id,
    });
  } catch (err) {
    console.error("/api/entitlements error", err);
    // Fail closed (free) so app stays usable even if API hiccups
    return res.status(200).json(DEFAULT_PAYLOAD);
  }
}
