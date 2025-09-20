// api/portal.js
import { stripe } from "./_lib/stripe.js";
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";

function allowCors(res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Missing email" });

    const { data: cust, error } = await supabaseAdmin
      .from("app_stripe_customers")
      .select("*")
      .eq("email", email)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!cust) return res.status(404).json({ error: "No customer" });

    const session = await stripe.billingPortal.sessions.create({
      customer: cust.customer_id,
      return_url: process.env.APP_BASE_URL || "https://slimcal.ai",
    });
    return res.json({ url: session.url });
  } catch (err) {
    console.error("/api/portal error", err);
    return res.status(500).json({ error: "Server error" });
  }
}
