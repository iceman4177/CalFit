import React, { useEffect, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Chip, TextField, Stack, ToggleButton, ToggleButtonGroup, Divider
} from "@mui/material";
import { supabase } from "../lib/supabaseClient";

const PRICE_MONTHLY = import.meta.env.VITE_STRIPE_PRICE_ID_MONTHLY;
const PRICE_ANNUAL  = import.meta.env.VITE_STRIPE_PRICE_ID_ANNUAL;

function getOrCreateClientId() {
  let cid = localStorage.getItem("clientId");
  if (!cid) {
    cid = crypto?.randomUUID?.() || String(Date.now());
    localStorage.setItem("clientId", cid);
  }
  return cid;
}

async function waitForSupabaseUser(maxMs = 6000, stepMs = 250) {
  const start = Date.now();
  for (;;) {
    const { data, error } = await supabase.auth.getUser();
    if (data?.user && !error) return data.user;
    if (Date.now() - start > maxMs) return null;
    await new Promise(r => setTimeout(r, stepMs));
  }
}

export default function UpgradeModal({
  open,
  onClose,
  title = "Upgrade to Slimcal Pro",
  description = "Unlimited AI workouts, meals & premium insights.",
  annual = false,
  defaultPlan,
  autoCheckoutOnOpen = false,
}) {
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");
  const [user, setUser] = useState(null);
  const [emailForMagicLink, setEmailForMagicLink] = useState("");
  const [plan, setPlan] = useState(defaultPlan || (annual ? "annual" : "monthly"));

  useEffect(() => {
    setPlan(defaultPlan || (annual ? "annual" : "monthly"));
  }, [defaultPlan, annual]);

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
      const redirectUrl = `${window.location.origin}/?upgrade=1&plan=${plan}&autopay=1`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectUrl },
      });
      if (error) throw error;
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
      const redirectUrl = `${window.location.origin}/?upgrade=1&plan=${plan}&autopay=1`;
      const { error } = await supabase.auth.signInWithOtp({
        email: emailForMagicLink,
        options: { emailRedirectTo: redirectUrl },
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
      const { data, error } = await supabase.auth.getUser();
      if (error) throw new Error(error.message);
      if (!data?.user) throw new Error("Please sign in to start your trial.");

      const price_id = plan === "annual" ? PRICE_ANNUAL : PRICE_MONTHLY;
      if (!price_id) throw new Error("Billing configuration missing.");

      const clientId = getOrCreateClientId();

      const resp = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: data.user.id,
          email: data.user.email || null,
          price_id,
          client_reference_id: clientId,
          success_path: `/pro-success?cid=${encodeURIComponent(clientId)}`,
          cancel_path: `/`,
          period: plan,
        }),
      });

      const json = await resp.json();
      if (!resp.ok) throw new Error(json?.error || "Checkout session failed");
      if (!json?.url) throw new Error("No checkout URL returned");

      window.location.href = json.url;
    } catch (err) {
      console.error("[UpgradeModal] checkout error:", err);
      setApiError(err.message || "Something went wrong.");
      setLoading(false);
    }
  };

  const simulateUpgradeDev = () => {
    const clientId = getOrCreateClientId();
    localStorage.setItem("isPro", "true");
    localStorage.setItem("isProActive", "true");
    if (!localStorage.getItem("trialStart")) {
      const now = Date.now();
      const end = now + 7 * 24 * 60 * 60 * 1000;
      localStorage.setItem("trialStart", String(now));
      localStorage.setItem("trialEndTs", String(end));
    }
    window.location.assign(`/pro-success?cid=${encodeURIComponent(clientId)}&dev=1`);
  };

  // auto-resume after OAuth
  useEffect(() => {
    if (!open || !autoCheckoutOnOpen) return;
    (async () => {
      const u = await waitForSupabaseUser();
      if (u) {
        setUser(u);
        handleCheckout();
      }
    })();
  }, [open, autoCheckoutOnOpen]);

  const isProUser = localStorage.getItem("isPro") === "true";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>{description}</Typography>

        {!isProUser && (
          <Chip label="7-day free trial" color="success" size="small" sx={{ mb: 2 }} />
        )}

        {/* Plan toggle */}
        {user && (
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <ToggleButtonGroup
              exclusive
              value={plan}
              onChange={(_e, val) => val && setPlan(val)}
              size="small"
            >
              <ToggleButton value="monthly">Monthly</ToggleButton>
              <ToggleButton value="annual">Annual</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        )}

        <Typography>
          <strong>{plan === "annual" ? "$49.99/yr" : "$4.99/mo"}</strong>{" "}
          billed {plan === "annual" ? "yearly" : "monthly"} after trial.
        </Typography>
        <Typography variant="body2" color="textSecondary">Cancel anytime.</Typography>

        {apiError && (
          <Typography sx={{ mt: 2 }} color="error" variant="body2">
            {apiError}
          </Typography>
        )}

        {/* Before sign-in: ONLY sign-in UI */}
        {!user && (
          <>
            <Typography sx={{ mt: 2 }} variant="body2" color="textSecondary">
              Sign in to start your free trial:
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1, mb: 1 }}>
              <Button variant="contained" onClick={signInWithGoogle}>
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
        {user ? (
          <>
            <Button onClick={onClose} disabled={loading}>Maybe later</Button>
            <Button onClick={handleCheckout} variant="contained" disabled={loading}>
              {loading ? "Redirecting…" : "Start Free Trial"}
            </Button>
            <Button size="small" onClick={simulateUpgradeDev}>Simulate (DEV)</Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
