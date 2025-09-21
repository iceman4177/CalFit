import React, { useEffect, useRef, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Chip, Stack, ToggleButton, ToggleButtonGroup
} from "@mui/material";
import { supabase } from "../lib/supabaseClient";

function getOrCreateClientId() {
  let cid = localStorage.getItem("clientId");
  if (!cid) {
    cid = crypto?.randomUUID?.() || String(Date.now());
    localStorage.setItem("clientId", cid);
  }
  return cid;
}

export default function UpgradeModal({
  open,
  onClose,
  title = "Start your 7-Day Free Pro Trial",
  description = "Unlimited AI workouts, meals & premium insights.",
  annual = false,
  defaultPlan,
}) {
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");
  const [user, setUser] = useState(null);
  const [plan, setPlan] = useState(defaultPlan || (annual ? "annual" : "monthly"));
  const pollingRef = useRef(false);

  // Sync default plan if props change
  useEffect(() => {
    setPlan(defaultPlan || (annual ? "annual" : "monthly"));
  }, [defaultPlan, annual]);

  // Keep Supabase auth state in sync while modal is open
  useEffect(() => {
    if (!open) return;
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getUser();
      if (mounted) setUser(data?.user ?? null);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      sub.subscription?.unsubscribe?.();
    };
  }, [open]);

  // Small poll after opening/return to catch late sessions
  useEffect(() => {
    if (!open || pollingRef.current) return;
    pollingRef.current = true;

    let stopped = false;
    const start = Date.now();

    (async function poll() {
      while (!stopped && Date.now() - start < 8000) {
        const { data } = await supabase.auth.getUser();
        if (data?.user) {
          setUser(data.user);
          break;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      pollingRef.current = false;
    })();

    return () => { stopped = true; };
  }, [open]);

  const signInWithGoogle = async () => {
    setApiError("");
    try {
      // Save intent so App.jsx can auto-continue post-auth
      localStorage.setItem("upgradeIntent", JSON.stringify({ plan, autopay: true }));
      const redirectUrl = `${window.location.origin}/auth/callback`; // dedicated handler
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectUrl },
      });
      if (error) throw error;
    } catch (e) {
      setApiError(e.message || "Sign-in failed. Please try again.");
    }
  };

  const handleCheckout = async () => {
    setLoading(true);
    setApiError("");
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw new Error(error.message);
      if (!data?.user) throw new Error("Please sign in to start your trial.");

      const clientId = getOrCreateClientId();
      const resp = await fetch("/api/ai/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: data.user.id,
          email: data.user.email || null,
          period: plan,                         // <-- server decides price_id
          client_reference_id: clientId,
          success_path: `/pro-success?cid=${encodeURIComponent(clientId)}`,
          cancel_path: `/`,
        }),
      });

      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json?.url) throw new Error(json?.error || "Checkout session failed");
      window.location.assign(json.url);
    } catch (err) {
      console.error("[UpgradeModal] checkout error:", err);
      setApiError(err.message || "Something went wrong.");
      setLoading(false);
    }
  };

  const isProUser = localStorage.getItem("isPro") === "true";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>{description}</Typography>

        {!isProUser && (
          <Chip label="7-day free trial" color="success" size="small" sx={{ mb: 2 }} />
        )}

        {/* After sign-in: plan toggle */}
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

        {/* Pre-auth: ONLY the Google sign-in button (as requested) */}
        {!user && (
          <Stack direction="row" spacing={1} sx={{ mt: 2, mb: 1 }}>
            <Button variant="contained" onClick={signInWithGoogle}>
              Continue with Google
            </Button>
          </Stack>
        )}
      </DialogContent>

      <DialogActions>
        {user ? (
          <>
            <Button onClick={onClose} disabled={loading}>Maybe later</Button>
            <Button
              onClick={handleCheckout}
              variant="contained"
              disabled={loading}                  /* no client env gating */
            >
              {loading ? "Redirecting…" : "Start Free Trial"}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
