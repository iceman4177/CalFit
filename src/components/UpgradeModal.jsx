// src/components/UpgradeModal.jsx
import React, { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography
} from "@mui/material";
import { loadStripe } from "@stripe/stripe-js";

// initialize Stripe.js with your publishable key (must be set in .env as VITE_STRIPE_PUBLISHABLE_KEY)
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

export default function UpgradeModal({ open, onClose }) {
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    setLoading(true);
    try {
      // call your serverless function to create a Checkout Session
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const { sessionId } = await res.json();

      const stripe = await stripePromise;
      await stripe.redirectToCheckout({ sessionId });
    } catch (err) {
      console.error("Checkout error:", err);
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Upgrade to Slimcal.ai Pro</DialogTitle>
      <DialogContent>
        <Typography>
          You’ve used up your 3 free Daily Recap calls for today. Upgrade for unlimited AI coaching,
          personalized plans, and more!
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleCheckout}
          disabled={loading}
        >
          {loading ? "Redirecting…" : "Upgrade Now"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
