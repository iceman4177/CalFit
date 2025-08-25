// src/components/UpgradeModal.jsx
import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Chip
} from "@mui/material";
import { loadStripe } from "@stripe/stripe-js";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

export default function UpgradeModal({
  open,
  onClose,
  title = "Upgrade to Slimcal Pro",
  description = "Unlimited AI workouts, meals & premium insights."
}) {
  const isProUser = localStorage.getItem("isPro") === "true";

  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");

  const handleCheckout = async () => {
    setLoading(true);
    setApiError("");
    try {
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: "monthly" // default checkout plan
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Checkout session failed");
      }

      const stripe = await stripePromise;
      await stripe.redirectToCheckout({ sessionId: data.sessionId });
    } catch (err) {
      console.error(err);
      setApiError(err.message);
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>{description}</Typography>

        {!isProUser && (
          <Chip
            label="7-day free trial"
            color="success"
            size="small"
            sx={{ mb: 2 }}
          />
        )}

        <Typography>
          <strong>$4.99/mo</strong> billed monthly after trial.
        </Typography>
        <Typography variant="body2" color="textSecondary">
          Cancel anytime.
        </Typography>

        {apiError && (
          <Typography sx={{ mt: 2 }} color="error" variant="body2">
            {apiError}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Maybe later
        </Button>
        <Button
          onClick={handleCheckout}
          variant="contained"
          disabled={loading}
        >
          {loading ? "Redirecting…" : "Start Free Trial"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
