// server/routes/stripeWebhook.js
// Stripe Webhook handler for Slimcal.ai
//
// Expects RAW BODY (set in server/index.js) and the following env vars:
//
//   STRIPE_SECRET_KEY=sk_test_...
//   STRIPE_WEBHOOK_SECRET=whsec_...        // from your Stripe Dashboard (Test mode)

'use strict';

const Stripe = require('stripe');

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('[Webhook] STRIPE_SECRET_KEY is not set.');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

/**
 * Webhook handler (exported as a single function).
 * server/index.js mounts:
 *   app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), stripeWebhook)
 */
module.exports = (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  // Verify signature if we have a webhook secret
  if (webhookSecret) {
    try {
      // req.body is a Buffer because we used express.raw()
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error('[Stripe Webhook] Signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    // Fallback (dev only): parse without verification
    try {
      const payload = Buffer.isBuffer(req.body)
        ? req.body.toString('utf8')
        : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
      event = JSON.parse(payload);
      console.warn('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not set. Parsing without verification (dev-only).');
    } catch (err) {
      console.error('[Stripe Webhook] Could not parse event without verification:', err.message);
      return res.status(400).send('Invalid payload');
    }
  }

  // --- Handle events ---
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log('[Webhook] checkout.session.completed:', {
          id: session.id,
          customer: session.customer,
          customer_email: session.customer_details?.email,
          subscription: session.subscription,
          mode: session.mode,
          status: session.status,
          livemode: session.livemode,
        });
        // TODO: When you have user auth + DB, mark the user as Pro here
        break;
      }

      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        console.log('[Webhook] checkout.session.async_payment_succeeded:', {
          id: session.id,
          customer: session.customer,
          subscription: session.subscription,
          status: session.status,
        });
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        console.log('[Webhook] invoice.paid:', {
          id: invoice.id,
          customer: invoice.customer,
          subscription: invoice.subscription,
          amount_paid: invoice.amount_paid,
          livemode: invoice.livemode,
        });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        console.log('[Webhook] invoice.payment_failed:', {
          id: invoice.id,
          customer: invoice.customer,
          subscription: invoice.subscription,
          amount_due: invoice.amount_due,
        });
        break;
      }

      case 'customer.subscription.created': {
        const sub = event.data.object;
        console.log('[Webhook] subscription.created:', {
          id: sub.id,
          customer: sub.customer,
          status: sub.status,
          current_period_end: sub.current_period_end,
          cancel_at_period_end: sub.cancel_at_period_end,
          items: sub.items?.data?.map(i => ({
            price: i.price?.id,
            interval: i.price?.recurring?.interval,
            product: i.price?.product
          })),
        });
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        console.log('[Webhook] subscription.updated:', {
          id: sub.id,
          customer: sub.customer,
          status: sub.status,
          cancel_at_period_end: sub.cancel_at_period_end,
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        console.log('[Webhook] subscription.deleted:', {
          id: sub.id,
          customer: sub.customer,
          status: sub.status,
        });
        // TODO: On real backend, downgrade user to free here.
        break;
      }

      case 'customer.subscription.trial_will_end': {
        const sub = event.data.object;
        console.log('[Webhook] trial_will_end:', {
          id: sub.id,
          customer: sub.customer,
          trial_end: sub.trial_end,
        });
        break;
      }

      default: {
        // Log all other event types for visibility during development
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
      }
    }
  } catch (err) {
    console.error('[Stripe Webhook] Handler error:', err);
    // Acknowledge to avoid retries; log so we can debug
  }

  // Respond 200 to acknowledge receipt
  return res.json({ received: true });
};
