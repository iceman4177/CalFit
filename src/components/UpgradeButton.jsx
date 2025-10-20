// src/components/UpgradeButton.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Typography,
} from "@mui/material";
import { useEntitlements } from "../context/EntitlementsContext.jsx";

export default function UpgradeButton({
  priceIdMonthly = import.meta.env.VITE_PRICE_ID_MONTHLY,
  priceIdAnnual = null,
  label = "Start 7-day Free Trial",
  autoContinueOnReturn = true, // auto-continue after returning from auth
}) {
  const { email, setEmail } = useEntitlements();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(email || "");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState("monthly"); // future toggle

  // ----- helpers -----
  const hasEmail = useMemo(
    () => !!(email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)),
    [email]
  );

  const normalize = (e) => (e || "").trim().toLowerCase();
  const setIntent = () => {
    // remember upgrade intent in both URL and sessionStorage
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("intent", "upgrade");
      window.history.replaceState({}, "", url.toString());
    } catch {}
    try {
      sessionStorage.setItem("intent", "upgrade");
    } catch {}
  };

  const clearIntent = () => {
    try {
      sessionStorage.removeItem("intent");
      const url = new URL(window.location.href);
      if (url.searchParams.get("intent") === "upgrade") {
        url.searchParams.delete("intent");
        window.history.replaceState({}, "", url.toString());
      }
    } catch {}
  };

  const startCheckout = async (emailForCheckout) => {
    const selected = plan === "annual" ? priceIdAnnual : priceIdMonthly;
    if (!selected) {
      alert("Missing priceId for selected plan.");
      return;
    }
    try {
      setBusy(true);
      const r = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId: selected, email: emailForCheckout }),
      });
      if (!r.ok) {
        const t = await r.text();
        console.error("[Upgrade] non-OK:", t);
        alert("Unable to start checkout. Please try again.");
        return;
      }
      const data = await r.json();
      if (data?.url) {
        window.location.href = data.url; // Stripe Checkout
      } else {
        alert("Checkout not initialized. Please try again.");
      }
    } catch (err) {
      console.error("[Upgrade] error:", err);
      alert("Something went wrong launching checkout.");
    } finally {
      setBusy(false);
      clearIntent();
    }
  };

  const ensureEmailThenCheckout = async () => {
    const e = normalize(val || email);
    if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
      alert("Please enter a valid email to continue.");
      return;
    }
    setEmail?.(e);
    await startCheckout(e);
  };

  // ----- primary click handler -----
  const handleClick = async () => {
    setIntent();

    // If we already have a valid email (user likely signed-in),
    // skip the dialog and go straight to Stripe.
    if (hasEmail) {
      setVal(email);
      await ensureEmailThenCheckout();
      return;
    }

    // Otherwise gather email in the dialog.
    setOpen(true);
  };

  // ----- auto-continue after auth return -----
  useEffect(() => {
    if (!autoContinueOnReturn) return;
    try {
      const url = new URL(window.location.href);
      const intentQp = url.searchParams.get("intent");
      const intentSs = sessionStorage.getItem("intent");
      const intent = intentQp || intentSs;

      // If user came back with intent=upgrade and we have an email now, auto-continue.
      if (!busy && intent === "upgrade" && hasEmail) {
        setVal(email);
        (async () => {
          await ensureEmailThenCheckout();
        })();
      }
    } catch {
      /* noop */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, hasEmail, busy, autoContinueOnReturn]);

  return (
    <>
      <Button variant="contained" size="large" onClick={handleClick} disabled={busy}>
        {busy ? "Preparing..." : hasEmail ? "Start Free Trial" : label}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Start your free trial</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Enter your email so we can create your subscription and unlock Pro on this account.
          </Typography>
          <TextField
            autoFocus
            label="Email"
            type="email"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            fullWidth
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) ensureEmailThenCheckout();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" onClick={ensureEmailThenCheckout} disabled={busy}>
            {busy ? "Launching..." : "Continue"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
