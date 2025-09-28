import Stripe from "stripe";
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

// ---------- helpers ----------
async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}
const iso = (ts) => (typeof ts === "number" ? new Date(ts * 1000).toISOString() : null);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const asUuidOrNull = (v) => (UUID_RE.test(String(v || "")) ? v : null);

function logDbError(where, error) {
  if (error) console.error(`[wh] DB error @ ${where}:`, error.message || error);
}

async function upsertCustomer({ customer_id, user_id, email }) {
  if (!customer_id) return;

  const payload = {
    customer_id,
    email: email ?? null,
    updated_at: new Date().toISOString(),
  };
  if (user_id) payload.user_id = user_id;

  const { error } = await supabaseAdmin
    .from("app_stripe_customers")
    .upsert(payload, { onConflict: "customer_id" });

  logDbError("app_stripe_customers.upsert", error);
  if (error) throw new Error(`upsert app_stripe_customers failed: ${error.message}`);
}

async function resolveUserIdFromCustomer(customer_id) {
  if (!customer_id) return null;
  const { data, error } = await supabaseAdmin
    .from("app_stripe_customers")
    .select("user_id")
    .eq("customer_id", customer_id)
    .maybeSingle();
  logDbError("app_stripe_customers.select", error);
  if (error) throw new Error(`lookup mapping failed: ${error.message}`);
  return data?.user_id || null;
}

async function upsertSubscription(sub, userHint = null) {
  const stripe_subscription_id = sub.id;
  const customer_id = sub.customer;
  let user_id =
    asUuidOrNull(userHint) ||
    asUuidOrNull(sub.metadata?.user_id) ||
    null;

  // Fallback: look up mapping if user not provided on event
  if (!user_id) user_id = await resolveUserIdFromCustomer(customer_id);

  // If still no user_id, ask Stripe to retry later (mapping may arrive shortly)
  if (!user_id) {
    console.warn("[wh] ⚠ no user_id for subscription", { subId: stripe_subscription_id, customer_id });
    throw new Error("user_id missing for subscription upsert");
  }

  const item = sub.items?.data?.[0];
  const price = item?.price;
  const price_id = price?.id ?? null;
  // In subscription events, price.product is typically a product ID string (not expanded)
  const product_id = typeof price?.product === "string" ? price.product : price?.product?.id ?? null;

  const payload = {
    stripe_subscription_id,
    user_id,
    status: sub.status,
    current_period_end: iso(sub.current_period_end),
    price_id,
    product_id,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    trial_end: iso(sub.trial_end),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from("app_subscriptions")
    .upsert(payload, { onConflict: "stripe_subscription_id" });

  logDbError("app_subscriptions.upsert", error);
  if (error) throw new Error(`upsert app_subscriptions failed: ${error.message}`);

  // Optional entitlement mirror (your schema already expects this)
  const is_pro = sub.status === "active" || sub.status === "trialing";
  const { error: entErr } = await supabaseAdmin
    .from("entitlements")
    .upsert(
      {
        user_id,
        is_pro,
        status: sub.status,
        current_period_end: iso(sub.current_period_end),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  logDbError("entitlements.upsert", entErr);
  if (entErr) throw new Error(`upsert entitlements failed: ${entErr.message}`);
}

// ---------- handler ----------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  if (!supabaseAdmin) {
    console.error("[wh] missing Supabase admin client (check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    return res.status(500).send("Server config error");
  }

  // Verify signature
  let event;
  try {
    const sig = req.headers["stripe-signature"];
    if (!sig) return res.status(400).send("Missing Stripe-Signature");
    const raw = await readRaw(req);
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("[wh] ❌ signature/parse error:", e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  try {
    console.log("[wh] recv", { id: event.id, type: event.type });

    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        // Guard: only accept a valid UUID; otherwise fall back to metadata
        const userId =
          asUuidOrNull(s.client_reference_id) ||
          asUuidOrNull(s.metadata?.user_id) ||
          null;

        const customerId = s.customer || null;
        const email = s.customer_details?.email ?? s.customer_email ?? null;

        console.log("[wh] checkout.session.completed", { userId, customerId });

        // 1) Always upsert customer mapping
        await upsertCustomer({ customer_id: customerId, user_id: userId, email });

        // 2) If subscription already exists on the session, fetch and upsert it now
        if (s.mode === "subscription" && s.subscription) {
          const sub = await stripe.subscriptions.retrieve(s.subscription, {
            expand: ["items.data.price"], // price.product remains ID string; we handle both
          });
          await upsertSubscription(sub, userId);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        console.log("[wh] subscription", {
          subId: sub.id,
          status: sub.status,
          customer: sub.customer,
          metaUser: sub.metadata?.user_id,
        });
        await upsertSubscription(sub);
        break;
      }

      // Optional: observe invoices for debugging (no DB writes)
      case "invoice.paid":
      case "invoice.payment_failed":
      case "customer.subscription.trial_will_end":
        console.log("[wh] info", { type: event.type });
        break;

      default:
        // ignore other events to keep logs clean
        break;
    }

    // Success
    return res.status(200).json({ received: true });
  } catch (e) {
    // Return 400 so Stripe retries if we failed transiently (e.g., mapping not yet present)
    console.error("[wh] ❌ handler error:", e.message);
    return res.status(400).send("Webhook handler failed");
  }
}
