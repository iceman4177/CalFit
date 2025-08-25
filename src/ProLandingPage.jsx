// src/ProLandingPage.jsx
import React, { useState } from 'react';
import {
  Container,
  Typography,
  Box,
  Button,
  Stack,
  Card,
  CardContent,
  Chip
} from '@mui/material';
import { loadStripe } from '@stripe/stripe-js';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

export default function ProLandingPage() {
  const [billing, setBilling] = useState('monthly'); // "monthly" or "annual"

  const handleCheckout = async () => {
    const stripe = await stripePromise;
    await stripe.redirectToCheckout({
      mode: 'subscription',
      lineItems: [
        {
          price: billing === 'monthly'
            ? import.meta.env.VITE_STRIPE_PRICE_ID_MONTHLY
            : import.meta.env.VITE_STRIPE_PRICE_ID_ANNUAL,
          quantity: 1
        }
      ],
      successUrl: `${window.location.origin}/pro-success`,
      cancelUrl: `${window.location.origin}/pro`
    });
  };

  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Typography variant="h3" align="center" gutterBottom>
        Upgrade to Slimcal Pro
      </Typography>
      <Typography variant="h6" align="center" color="textSecondary" gutterBottom>
        Unlock unlimited AI coaching & smarter progress insights.
      </Typography>

      <Stack spacing={4} sx={{ mt: 6 }}>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1"><strong>What you’ll unlock:</strong></Typography>
            <ul>
              <li>Unlimited AI Workout Suggestions</li>
              <li>Unlimited AI Meal Suggestions</li>
              <li>Daily GPT Recap Coach</li>
              <li>Advanced Progress Insights & Metrics</li>
            </ul>
          </CardContent>
        </Card>

        <Stack direction="row" spacing={2} justifyContent="center">
          <Button
            variant={billing === 'monthly' ? 'contained' : 'outlined'}
            onClick={() => setBilling('monthly')}
          >
            $4.99 / mo
          </Button>
          <Button
            variant={billing === 'annual' ? 'contained' : 'outlined'}
            onClick={() => setBilling('annual')}
          >
            $49.99 / yr
            <Chip
              label="Save 17%"
              size="small"
              color="primary"
              sx={{ ml: 1 }}
            />
          </Button>
        </Stack>

        <Button variant="contained" size="large" fullWidth onClick={handleCheckout}>
          Start Free 7-Day Trial
        </Button>
      </Stack>
    </Container>
  );
}
