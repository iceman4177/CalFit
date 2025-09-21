// src/components/UpgradeModal.jsx
import React, { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Chip,
} from "@mui/material";
import { createClient } from "@supabase/supabase-js";

// ---- ENV (client) ----
const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const PRICE_MONTHLY  = import.meta.env.VITE_STRIPE_PRICE_ID_MONTHLY;
const PRICE_ANNUAL   = import.meta.env.VITE_STRIPE_PRICE_ID_ANNUAL;

// Debug logs (safe in test)
console.log("🔑 Using Stripe publishable key:", publishableKey);
console.log("🧾 Using PRICE IDs:", { monthly: PRICE_MONTHLY, annual: PRICE_ANNUAL });

// ---- Supabase client (browser) ----
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export default function UpgradeModal({
  open,
  onClose,
  title = "Upgrade to Slimcal Pro",
  description = "Unlimited AI workouts, meals & premium insights.",
  annual = false, // pass true if you want annual selected by default
}) {
  const isProUser = localStorage.getItem("isPro") === "true";

  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");

  const handleCheckout = async () => {
    setLoading(true);
    setApiError("");

    try {
      // 1) Get logged-in user (must be signed in)
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();
      if (userErr) throw new Error(userErr.message);
      if (!user) throw new Error("Please sign in to start your trial.");

      // 2) Choose the right test price id
      const priceId = annual ? PRICE_ANNUAL : PRICE_MONTHLY;
      if (!priceId) throw new Error("Billing configuration missing (price_id).");

      // 3) Call our API to create a Checkout Session
      const resp = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: user.id,
          price_id: priceId,
          email: user.email || null,
        }),
      });

      let json;
      try {
        json = await resp.json();
      } catch {
        throw new Error("Stripe server did not return JSON");
      }

      if (!resp.ok) throw new Error(json?.error || "Checkout session failed");
      if (!json?.url) throw new Error("No checkout URL returned from server");

      // 4) Redirect straight to Stripe Checkout
      window.location.href = json.url;

      // (Optional) optimistic trial marker
      if (!localStorage.getItem("trialEndTs")) {
        const trialEnd = Date.now() + 7 * 24 * 60 * 60 * 1000;
        localStorage.setItem("trialEndTs", String(trialEnd));
      }
    } catch (err) {
      console.error("[UpgradeModal] checkout error:", err);
      setApiError(err.message || "Something went wrong starting checkout.");
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>{description}</Typography>

        {!isProUser && (
          <Chip label="7-day free trial" color="success" size="small" sx={{ mb: 2 }} />
        )}

        <Typography>
          <strong>{annual ? "$49.99/yr" : "$4.99/mo"}</strong>{" "}
          billed {annual ? "yearly" : "monthly"} after trial.
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
        <Button onClick={handleCheckout} variant="contained" disabled={loading}>
          {loading ? "Redirecting…" : "Start Free Trial"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
