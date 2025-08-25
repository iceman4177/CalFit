import React, { useState, useEffect } from 'react';
import { Container, Typography, Box, Button, Stack, Card, CardContent, Chip } from '@mui/material';
import { loadStripe } from '@stripe/stripe-js';

const stripePromise = loadStripe('pk_test_51H9hUGLfWRetLrgUXGymItAEJt3cDZEq1jUVz57HmgvnjTItvhu9bj28ntU0BJzfJrwaKbIGLXJpVgha7kOrS0Fg00ZTEQp55N');

export default function ProPage() {
  const [billing, setBilling] = useState('monthly'); // monthly or annual

  const handleCheckout = async () => {
    const stripe = await stripePromise;
    await stripe.redirectToCheckout({
      lineItems: [
        {
          price: billing === 'monthly'
            ? 'price_monthly_placeholder'
            : 'price_annual_placeholder',
          quantity: 1
        }
      ],
      mode: 'subscription',
      successUrl: `${window.location.origin}/pro-success`,
      cancelUrl: `${window.location.origin}`
    });
  };

  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Typography variant="h3" align="center" gutterBottom>
        Upgrade to Slimcal Pro
      </Typography>
      <Typography variant="h6" align="center" color="textSecondary" gutterBottom>
        Unlock AI-powered personalization and smarter coaching.
      </Typography>

      <Stack spacing={3} sx={{ mt: 4 }}>
        {/* Benefits */}
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1"><strong>What you unlock:</strong></Typography>
            <ul>
              <li>Unlimited AI Workout Recommendations</li>
              <li>Unlimited AI Meal Suggestions</li>
              <li>Smart Daily Recap Coach</li>
              <li>Advanced Insights & Trends</li>
            </ul>
          </CardContent>
        </Card>

        {/* Plan Toggle */}
        <Stack direction="row" spacing={2} justifyContent="center">
          <Button
            variant={billing === 'monthly' ? 'contained' : 'outlined'}
            onClick={() => setBilling('monthly')}
          >
            $4.99/mo
          </Button>
          <Button
            variant={billing === 'annual' ? 'contained' : 'outlined'}
            onClick={() => setBilling('annual')}
          >
            $49.99/yr
            {billing !== 'annual' && (
              <Chip
                label="Save 17%"
                size="small"
                color="primary"
                sx={{ ml: 1 }}
              />
            )}
          </Button>
        </Stack>

        {/* Checkout */}
        <Button
          size="large"
          fullWidth
          variant="contained"
          onClick={handleCheckout}
        >
          Start Free 7-Day Trial
        </Button>
      </Stack>
    </Container>
  );
}
