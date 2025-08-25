// server/index.js
'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');

// Load .env from project root (one level up from /server)
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Routes
const billingRoutes = require('./routes/billing');         // /api/create-checkout-session, etc.
const stripeWebhook  = require('./routes/stripeWebhook');  // /api/stripe-webhook (raw body)
const aiRoutes       = require('./routes/ai');             // /api/ai/meal-suggestion

const app = express();

/**
 * IMPORTANT: Stripe webhook must receive the raw body.
 * Mount this BEFORE express.json() so it doesn't get parsed.
 */
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), stripeWebhook);

// Normal middleware for every other route
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'development' });
});

// API routes (JSON body)
app.use('/api', billingRoutes);
app.use('/api', aiRoutes);

// Basic 404 for unknown /api routes
app.use('/api/*', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler (optional but useful during dev)
app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

// Start server
const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`Slimcal API listening on http://localhost:${port}`);
});
