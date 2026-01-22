// src/components/UpgradeModal.jsx
import React, { useEffect, useRef, useState, useMemo } from "react";
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

function rememberIntent() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("intent", "upgrade");
    window.history.replaceState({}, "", url.toString());
    sessionStorage.setItem("intent", "upgrade");
  } catch {}
}
function clearIntent() {
  try {
    sessionStorage.removeItem("intent");
    const url = new URL(window.location.href);
    if (url.searchParams.get("intent") === "upgrade") {
      url.searchParams.delete("intent");
      window.history.replaceState({}, "", url.toString());
    }
  } catch {}
}

function readUpgradeMode() {
  try {
    const m = localStorage.getItem("slimcal:upgradeMode");
    return m === "upgrade" ? "upgrade" : "trial";
  } catch {
    return "trial";
  }
}
function clearUpgradeMode() {
  try { localStorage.removeItem("slimcal:upgradeMode"); } catch {}
}

export default function UpgradeModal({
  open,
  onClose,
  title,
  description,
  annual = false,
  defaultPlan,
}) {
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");
  const [user, setUser] = useState(null);
  const [plan, setPlan] = useState(defaultPlan || (annual ? "annual" : "monthly"));
  const pollingRef = useRef(false);

  // Determine mode (trial vs upgrade-only)
  const [mode, setMode] = useState("trial");
  useEffect(() => {
    if (!open) return;
    setMode(readUpgradeMode());
  }, [open]);

  const computedCopy = useMemo(() => {
    const isUpgradeOnly = mode === "upgrade";

    const computedTitle =
      title ||
      (isUpgradeOnly ? "Upgrade to Pro" : "Start your 7-Day Free Pro Trial");

    const computedDescription =
      description ||
      (isUpgradeOnly
        ? "Unlock unlimited AI recaps, meals & workouts."
        : "Unlimited AI workouts, meals & premium insights.");

    const primaryCta = isUpgradeOnly ? "Upgrade to Pro" : "Start Free Trial";

    return { isUpgradeOnly, computedTitle, computedDescription, primaryCta };
  }, [mode, title, description]);

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
        if (data?.user) { setUser(data.user); break; }
        await new Promise((r) => setTimeout(r, 300));
      }
      pollingRef.current = false;
    })();

    return () => { stopped = true; };
  }, [open]);

  // AUTO-CONTINUE: if user is present and intent=upgrade exists, jump straight to checkout
  useEffect(() => {
    if (!open || !user || loading) return;
    try {
      const url = new URL(window.location.href);
      const qp = url.searchParams.get("intent");
      const ss = sessionStorage.getItem("intent");
      const intent = qp || ss;
      if (intent === "upgrade") {
        (async () => { await handleCheckout(true); })();
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user, loading, plan, mode]);

  const signInWithGoogle = async () => {
    setApiError("");
    try {
      rememberIntent(); // persist intent BEFORE redirect
      // Also persist current plan so we don't lose it
      sessionStorage.setItem("upgradePlan", plan);

      const redirectUrl = `${window.location.origin}${window.location.pathname}?intent=upgrade`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectUrl, queryParams: { prompt: "select_account" } },
      });
      if (error) throw error;
    } catch (e) {
      setApiError(e.message || "Sign-in failed. Please try again.");
    }
  };

  const handleCheckout = async (fromAuto = false) => {
    setLoading(true);
    setApiError("");
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw new Error(error.message);
      if (!data?.user) throw new Error("Please sign in to continue.");

      // restore plan if we came back from auth
      const savedPlan = sessionStorage.getItem("upgradePlan");
      const effectivePlan = savedPlan || plan;
      if (savedPlan) setPlan(savedPlan);

      const clientId = getOrCreateClientId();
      const resp = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: data.user.id,
          email: data.user.email || null,
          period: effectivePlan, // server decides price_id
          client_reference_id: clientId,
          success_path: `/pro-success?cid=${encodeURIComponent(clientId)}`,
          cancel_path: `/`,
        }),
      });

      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json?.url) throw new Error(json?.error || "Checkout session failed");
      clearIntent();
      sessionStorage.removeItem("upgradePlan");
      window.location.assign(json.url);
    } catch (err) {
      console.error("[UpgradeModal] checkout error:", err);
      setApiError(err.message || "Something went wrong.");
      setLoading(false);
      if (fromAuto) {
        // keep modal open for manual retry
      }
    }
  };

  const isProUser = localStorage.getItem("isPro") === "true";

  const close = () => {
    clearUpgradeMode();
    onClose?.();
  };

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle>{computedCopy.computedTitle}</DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 2 }}>{computedCopy.computedDescription}</Typography>

        {/* Trial chip only when we are in trial mode and user is not already pro */}
        {!computedCopy.isUpgradeOnly && !isProUser && (
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
          {computedCopy.isUpgradeOnly
            ? `billed ${plan === "annual" ? "yearly" : "monthly"}.`
            : `billed ${plan === "annual" ? "yearly" : "monthly"} after trial.`}
        </Typography>
        <Typography variant="body2" color="textSecondary">
          Cancel anytime.
        </Typography>

        {apiError && (
          <Typography sx={{ mt: 2 }} color="error" variant="body2">
            {apiError}
          </Typography>
        )}

        {/* Pre-auth: ONLY the Google sign-in button */}
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
            <Button onClick={close} disabled={loading}>Maybe later</Button>
            <Button onClick={() => handleCheckout(false)} variant="contained" disabled={loading}>
              {loading ? "Redirecting…" : computedCopy.primaryCta}
            </Button>
          </>
        ) : (
          <Button onClick={close}>Close</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
