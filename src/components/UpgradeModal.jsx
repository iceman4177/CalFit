// src/components/UpgradeModal.jsx
import React, { useEffect, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Chip, TextField, Stack
} from "@mui/material";
import { supabase } from "../lib/supabaseClient";

const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const PRICE_MONTHLY   = import.meta.env.VITE_STRIPE_PRICE_ID_MONTHLY;
const PRICE_ANNUAL    = import.meta.env.VITE_STRIPE_PRICE_ID_ANNUAL;

console.log("🔑 Using Stripe publishable key:", PUBLISHABLE_KEY);
console.log("🧾 PRICE IDs:", { monthly: PRICE_MONTHLY, annual: PRICE_ANNUAL });

export default function UpgradeModal({
  open,
  onClose,
  title = "Upgrade to Slimcal Pro",
  description = "Unlimited AI workouts, meals & premium insights.",
  annual = false, // set true to default to annual plan
}) {
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");
  const [user, setUser] = useState(null);
  const [emailForMagicLink, setEmailForMagicLink] = useState("");

  // Load auth state when modal opens and keep it in sync
  useEffect(() => {
    if (!open) return;
    let mounted = true;
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (mounted) setUser(error ? null : data.user);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription?.unsubscribe?.();
  }, [open]);

  const signInWithGoogle = async () => {
    setApiError("");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + "/pro" },
      });
      if (error) throw error;
      // User will be redirected; on return, session will exist.
    } catch (e) {
      setApiError(e.message || "Sign-in failed. Please try again.");
    }
  };

  const sendMagicLink = async () => {
    setApiError("");
    if (!emailForMagicLink) {
      setApiError("Please enter an email.");
      return;
    }
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: emailForMagicLink,
        options: { emailRedirectTo: window.location.origin + "/pro" },
      });
      if (error) throw error;
      setApiError("Magic link sent! Check your email.");
    } catch (e) {
      setApiError(e.message || "Could not send magic link.");
    }
  };

  const handleCheckout = async () => {
    setLoading(true);
    setApiError("");

    try {
      // Ensure signed in
      const { data, error } = await supabase.auth.getUser();
      if (error) throw new Error(error.message);
      if (!data?.user) throw new Error("Please sign in to start your trial.");

      const price_id = annual ? PRICE_ANNUAL : PRICE_MONTHLY;
      if (!price_id) throw new Error("Billing configuration missing (price_id).");

      const resp = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: data.user.id,
          price_id,
          email: data.user.email || null,
        }),
      });

      const json = await resp.json().catch(() => {
        throw new Error("Stripe server did not return JSON");
      });
      if (!resp.ok) throw new Error(json?.error || "Checkout session failed");
      if (!json?.url) throw new Error("No checkout URL returned from server");

      // Redirect to Stripe Checkout
      window.location.href = json.url;

      // Optional optimistic trial marker
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

  const isProUser = localStorage.getItem("isPro") === "true";

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
        <Typography variant="body2" color="textSecondary">Cancel anytime.</Typography>

        {apiError && (
          <Typography sx={{ mt: 2 }} color="error" variant="body2">
            {apiError}
          </Typography>
        )}

        {!user && (
          <>
            <Typography sx={{ mt: 2 }} variant="body2" color="textSecondary">
              Sign in to start your free trial:
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1, mb: 1 }}>
              <Button variant="outlined" onClick={signInWithGoogle}>
                Continue with Google
              </Button>
            </Stack>
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <TextField
                size="small"
                label="Email for magic link"
                type="email"
                value={emailForMagicLink}
                onChange={(e) => setEmailForMagicLink(e.target.value)}
              />
              <Button variant="text" onClick={sendMagicLink}>Send link</Button>
            </Stack>
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={loading}>Maybe later</Button>
        {user ? (
          <Button onClick={handleCheckout} variant="contained" disabled={loading}>
            {loading ? "Redirecting…" : "Start Free Trial"}
          </Button>
        ) : (
          <Button onClick={signInWithGoogle} variant="contained">
            Sign in to continue
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
