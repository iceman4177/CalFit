// src/components/UpgradeModal.jsx
import React, { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Chip,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
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

async function fetchProStatus(userId, email) {
  try {
    const qs = new URLSearchParams();
    if (userId) qs.set("user_id", userId);
    if (email) qs.set("email", email);
    const res = await fetch(`/api/me/pro-status?${qs.toString()}`, { credentials: "same-origin" });
    const json = await res.json().catch(() => ({}));
    return json || {};
  } catch {
    return {};
  }
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

  // Server-truth status snapshot (drives UI)
  const [proStatus, setProStatus] = useState({
    loading: false,
    isProActive: false,
    status: null,
    trialEligible: null,
    trialUsed: null,
  });

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

    return () => {
      stopped = true;
    };
  }, [open]);

  // Fetch server-truth pro/trial eligibility whenever we have a user and modal is open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      if (!user?.id) {
        setProStatus({
          loading: false,
          isProActive: false,
          status: null,
          trialEligible: null,
          trialUsed: null,
        });
        return;
      }

      setProStatus((s) => ({ ...s, loading: true }));
      const ps = await fetchProStatus(user.id, user.email);
      if (cancelled) return;

      setProStatus({
        loading: false,
        isProActive: !!ps?.isProActive,
        status: ps?.status || null,
        trialEligible: typeof ps?.trialEligible === "boolean" ? ps.trialEligible : null,
        trialUsed: typeof ps?.trialUsed === "boolean" ? ps.trialUsed : null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [open, user?.id]);

  // Restore plan if we came back from auth redirect
  useEffect(() => {
    if (!open) return;
    const savedPlan = sessionStorage.getItem("upgradePlan");
    if (savedPlan && (savedPlan === "monthly" || savedPlan === "annual")) {
      setPlan(savedPlan);
    }
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
        (async () => {
          await handleCheckout(true);
        })();
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user, loading, plan]);

  const signInWithGoogle = async () => {
    setApiError("");
    try {
      rememberIntent(); // <- persist intent BEFORE redirect
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

      // Optional: pass trialEligible hint (backend must enforce)
      const resp = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: data.user.id,
          email: data.user.email || null,
          period: effectivePlan,
          client_reference_id: clientId,
          success_path: `/pro-success?cid=${encodeURIComponent(clientId)}`,
          cancel_path: `/`,
          // IMPORTANT: This is only a hint; backend must be the authority.
          trial_eligible: proStatus?.trialEligible === true,
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

  // --- Server-truth derived UI mode ---
  const isTrialing = String(proStatus.status || "").toLowerCase() === "trialing";
  const isProActive = !!proStatus.isProActive;

  // If trialEligible === false and trialUsed === true and not Pro -> PRO-only mode (no trial messaging)
  const proOnlyMode =
    user &&
    !isProActive &&
    proStatus.trialEligible === false &&
    proStatus.trialUsed === true;

  // Default trial mode if eligible; otherwise pro-only for used trials
  const showTrialMessaging =
    !user
      ? true // pre-auth: can show generic trial headline
      : (proStatus.trialEligible === true || isTrialing); // only if backend says eligible or currently trialing

  // Override copy dynamically (but respect passed props when appropriate)
  const computedTitle = user
    ? (proOnlyMode ? "Upgrade to Pro" : title)
    : title;

  const computedDescription = user
    ? (proOnlyMode
        ? "Unlock unlimited AI recaps, workouts, meals & premium insights."
        : description)
    : description;

  const actionLabel = user
    ? (proOnlyMode ? "Upgrade to Pro" : "Start Free Trial")
    : "Continue with Google";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{computedTitle}</DialogTitle>

      <DialogContent>
        <Typography sx={{ mb: 2 }}>{computedDescription}</Typography>

        {/* Server-truth messaging */}
        {user && proStatus.loading && (
          <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
            Checking your plan…
          </Typography>
        )}

        {/* Trial chip ONLY if eligible/trialing (not based on localStorage) */}
        {showTrialMessaging && !proOnlyMode && (
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
          billed {plan === "annual" ? "yearly" : "monthly"}
          {!proOnlyMode && showTrialMessaging ? " after trial." : "."}
        </Typography>

        <Typography variant="body2" color="textSecondary">
          Cancel anytime.
        </Typography>

        {proOnlyMode && (
          <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
            Trial already used on this account. No additional trials available.
          </Typography>
        )}

        {apiError && (
          <Typography sx={{ mt: 2 }} color="error" variant="body2">
            {apiError}
          </Typography>
        )}

        {/* Pre-auth: ONLY the Google sign-in button */}
        {!user && (
          <Stack direction="row" spacing={1} sx={{ mt: 2, mb: 1 }}>
            <Button variant="contained" onClick={signInWithGoogle} disabled={loading}>
              Continue with Google
            </Button>
          </Stack>
        )}
      </DialogContent>

      <DialogActions>
        {user ? (
          <>
            <Button onClick={onClose} disabled={loading}>
              Maybe later
            </Button>
            <Button onClick={() => handleCheckout(false)} variant="contained" disabled={loading}>
              {loading ? "Redirecting…" : actionLabel}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
