// src/components/UpgradeModal.jsx
import React, { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
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
        body: JSON.stringify({ plan: "monthly" })
      });

      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error("Stripe server did not return JSON");
      }

      if (!res.ok) {
        throw new Error(data?.error || "Checkout session failed");
      }

      if (!data.sessionId) {
        throw new Error("No session ID received from server");
      }

      const stripe = await stripePromise;
      if (!stripe) throw new Error("Stripe.js failed to load");

      const { error } = await stripe.redirectToCheckout({
        sessionId: data.sessionId
      });

      if (error) throw new Error(error.message);
    } catch (err) {
      console.error("[UpgradeModal] checkout error:", err);
      // Show user-friendly errors for common cases
      if (err.message.includes("Expired API Key")) {
        setApiError("Payment configuration error: Please contact support.");
      } else {
        setApiError(err.message || "Something went wrong starting checkout.");
      }
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
