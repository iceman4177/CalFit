// /api/portal.js
import Stripe from 'stripe';
import { supabaseAdmin } from './_lib/supabaseAdmin.js';

export const config = { api: { bodyParser: true } };

function allowCors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'https://slimcal.ai');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

export default async function handler(req, res) {
  allowCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    NODE_ENV,
    STRIPE_SECRET_KEY,
    STRIPE_SECRET_KEY_LIVE,
    STRIPE_PORTAL_RETURN_URL,
    APP_BASE_URL = 'https://slimcal.ai',
  } = process.env;

  const useLive = NODE_ENV === 'production' && !!STRIPE_SECRET_KEY_LIVE;
  const secretKey = useLive ? STRIPE_SECRET_KEY_LIVE : STRIPE_SECRET_KEY;
  const ENV = useLive ? 'LIVE' : 'TEST';

  if (!secretKey) {
    return res.status(500).json({ error: `[${ENV}] Missing Stripe secret key` });
  }

  const stripe = new Stripe(secretKey, { apiVersion: '2023-10-16' });

  try {
    const user_id = (req.body?.user_id || '').trim();
    const email   = (req.body?.email    || '').trim().toLowerCase();
    const return_url = req.body?.return_url || STRIPE_PORTAL_RETURN_URL || APP_BASE_URL;

    if (!user_id && !email) {
      return res.status(400).json({ error: 'Missing user_id or email' });
    }

    // ---------------- Resolve Stripe customer id robustly ----------------
    let customerId = null;

    // 1) Mapping table by user_id
    if (user_id) {
      const { data: mapRow } = await supabaseAdmin
        .from('app_stripe_customers')
        .select('customer_id')
        .eq('user_id', user_id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      customerId = mapRow?.customer_id || customerId;
    }

    // 2) Fallback: latest subscription row (stripe_customer_id)
    if (!customerId && user_id) {
      const { data: subRow } = await supabaseAdmin
        .from('app_subscriptions')
        .select('stripe_customer_id')
        .eq('user_id', user_id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      customerId = subRow?.stripe_customer_id || customerId;
    }

    // 3) Last-ditch: lookup mapping by email
    if (!customerId && email) {
      const { data: byEmail } = await supabaseAdmin
        .from('app_stripe_customers')
        .select('customer_id')
        .eq('email', email)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      customerId = byEmail?.customer_id || customerId;
    }

    if (!customerId) {
      return res.status(404).json({ error: 'no_customer' });
    }

    // Validate that this customer exists in THIS Stripe environment
    await stripe.customers.retrieve(customerId);

    // ---------------- Create Billing Portal session ---------------------
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url,
    });

    return res.status(200).json({ url: portal.url });
  } catch (err) {
    console.error('[portal] error:', err?.message || err);
    return res.status(402).json({ error: err?.message || 'portal_failed' });
  }
}
