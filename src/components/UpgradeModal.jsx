import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Chip, Stack, ToggleButton, ToggleButtonGroup
} from "@mui/material";
import { supabase } from "../lib/supabaseClient";

const PRICE_MONTHLY = import.meta.env.VITE_STRIPE_PRICE_ID_MONTHLY;
const PRICE_ANNUAL  = import.meta.env.VITE_STRIPE_PRICE_ID_ANNUAL;
const HAS_MONTHLY   = Boolean(PRICE_MONTHLY);
const HAS_ANNUAL    = Boolean(PRICE_ANNUAL);

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

  // pick a valid plan if one price id is missing
  useEffect(() => {
    let next = defaultPlan || (annual ? "annual" : "monthly");
    if (next === "annual" && !HAS_ANNUAL && HAS_MONTHLY) next = "monthly";
    if (next === "monthly" && !HAS_MONTHLY && HAS_ANNUAL) next = "annual";
    setPlan(next);
  }, [defaultPlan, annual]);

  const priceReady = useMemo(
    () => (plan === "annual" ? HAS_ANNUAL : HAS_MONTHLY),
    [plan]
  );

  // keep Supabase auth state in sync
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

  // 🚦 Poll briefly after the modal opens (and after OAuth return) to catch late sessions
  useEffect(() => {
    if (!open || pollingRef.current) return;
    pollingRef.current = true;

    let stopped = false;
    const start = Date.now();

    (async function poll() {
      while (!stopped && Date.now() - start < 8000) { // up to 8s
        const { data } = await supabase.auth.getUser();
        if (data?.user) {
          setUser(data.user);
          break;
        }
        await new Promise(r => setTimeout(r, 300));
      }

      // Auto-continue if intent was saved pre-auth (belt-and-suspenders with App.jsx)
      try {
        const raw = localStorage.getItem("upgradeIntent");
        if (raw) {
          const intent = JSON.parse(raw);
          if (intent?.autopay && priceReady) {
            // do nothing here; App.jsx will try auto-checkout too.
            // If you want modal-level auto-checkout as well, uncomment:
            // handleCheckout();
          }
        }
      } catch {}

      pollingRef.current = false;
    })();

    return () => { stopped = true; };
  }, [open, priceReady]);

  const signInWithGoogle = async () => {
    setApiError("");
    try {
      // save intent so App.jsx can resume the flow post-auth
      localStorage.setItem("upgradeIntent", JSON.stringify({ plan, autopay: true }));
      const redirectUrl = `${window.location.origin}/`; // root avoids 404
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
      if (!priceReady) {
        throw new Error(
          plan === "annual"
            ? "Annual price ID is not configured for this environment."
            : "Monthly price ID is not configured for this environment."
        );
      }

      const { data, error } = await supabase.auth.getUser();
      if (error) throw new Error(error.message);
      if (!data?.user) throw new Error("Please sign in to start your trial.");

      const price_id = plan === "annual" ? PRICE_ANNUAL : PRICE_MONTHLY;

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

        {/* After sign-in: allow plan toggle (disabled if a price id is missing) */}
        {user && (
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <ToggleButtonGroup
              exclusive
              value={plan}
              onChange={(_e, val) => {
                if (!val) return;
                if (val === "annual" && !HAS_ANNUAL && HAS_MONTHLY) return;
                if (val === "monthly" && !HAS_MONTHLY && HAS_ANNUAL) return;
                setPlan(val);
              }}
              size="small"
            >
              <ToggleButton value="monthly" disabled={!HAS_MONTHLY}>Monthly</ToggleButton>
              <ToggleButton value="annual"  disabled={!HAS_ANNUAL}>Annual</ToggleButton>
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

        {/* Pre-auth: show ONLY the Google sign-in button (per your request) */}
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
              disabled={loading || !priceReady}
              title={!priceReady ? "Stripe Price ID missing in this environment" : undefined}
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
