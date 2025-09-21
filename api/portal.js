// api/portal.js
import Stripe from "stripe";
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });
export const config = { api: { bodyParser: false } };

async function readJson(req) {
  let raw;
  if (typeof req.text === "function") raw = await req.text();
  else {
    const chunks = [];
    for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
    raw = Buffer.concat(chunks).toString("utf8");
  }
  return raw ? JSON.parse(raw) : {};
}

const BILLING_RETURN_URL = process.env.BILLING_RETURN_URL || "https://slimcal.ai/pro";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  let body = {};
  try { body = await readJson(req); } catch {}

  const userId = body?.user_id;
  if (!userId) return res.status(400).json({ error: "Missing user_id" });

  // find their Stripe customer
  const { data: cust, error } = await supabaseAdmin
    .from("app_stripe_customers")
    .select("customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !cust?.customer_id) {
    return res.status(404).json({ error: "No Stripe customer found" });
  }

  const portal = await stripe.billingPortal.sessions.create({
    customer: cust.customer_id,
    return_url: BILLING_RETURN_URL,
  });

  return res.status(200).json({ url: portal.url });
}
