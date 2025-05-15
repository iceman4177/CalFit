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

// initialize Stripe.js
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

export default function UpgradeModal({ open, onClose }) {
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");

  const handleCheckout = async () => {
    setLoading(true);
    setApiError("");
    try {
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }

      if (!res.ok) {
        // if JSON with error, use that, else display raw text
        const msg = data?.error || text || "Checkout session failed";
        throw new Error(msg);
      }

      const sessionId = data.sessionId;
      const stripe = await stripePromise;
      await stripe.redirectToCheckout({ sessionId });
    } catch (err) {
      console.error("Checkout error:", err);
      setApiError(err.message);
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Upgrade to Slimcal.ai Pro</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>
          You’ve used up your 3 free Daily Recap calls for today. Upgrade for unlimited AI coaching,
          personalized plans, and more!
        </Typography>
        {apiError && (
          <Typography color="error" variant="body2">
            {apiError}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
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
