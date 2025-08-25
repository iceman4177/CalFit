// server/routes/billing.js
const express = require('express');
const Stripe = require('stripe');

const router = express.Router();

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('[Billing] STRIPE_SECRET_KEY is not set. Set it in your .env');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

/**
 * POST /api/create-checkout-session
 * Body: { plan?: "monthly" | "annual" }
 * Behavior:
 *  - If STRIPE_PRICE_ID_MONTHLY/ANNUAL exist, use them
 *  - Else fall back to STRIPE_PRICE_ID for all plans (single-plan mode)
 */
router.post('/create-checkout-session', async (req, res) => {
  try {
    const { plan } = req.body || {};

    // Preferred: separate prices
    const monthlyPrice = process.env.STRIPE_PRICE_ID_MONTHLY || process.env.STRIPE_PRICE_ID;
    const annualPrice  = process.env.STRIPE_PRICE_ID_ANNUAL  || process.env.STRIPE_PRICE_ID;

    if (!monthlyPrice) {
      return res.status(500).json({ error: 'Stripe price ID not configured on server.' });
    }

    const useAnnual = plan === 'annual' && !!annualPrice;
    const priceId = useAnnual ? annualPrice : monthlyPrice;

    const baseUrl = process.env.APP_BASE_URL || 'http://localhost:5173';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: Number(process.env.STRIPE_TRIAL_DAYS || 7),
      },
      success_url: `${baseUrl}/pro-success`,
      cancel_url: `${baseUrl}/pro`,
      allow_promotion_codes: true,
    });

    return res.json({ sessionId: session.id });
  } catch (err) {
    console.error('Stripe checkout session error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
