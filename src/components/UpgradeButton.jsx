// src/components/UpgradeButton.jsx
import React, { useState } from "react";
import { Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Typography } from "@mui/material";
import { useEntitlements } from "../context/EntitlementsContext.jsx";

export default function UpgradeButton({ priceIdMonthly = import.meta.env.VITE_PRICE_ID_MONTHLY, priceIdAnnual = null, label = "Start 7-day Free Trial" }) {
  const { email, setEmail } = useEntitlements();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(email);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState("monthly"); // could add a toggle later

  const ensureEmailThenCheckout = async () => {
    const e = (val || "").trim().toLowerCase();
    if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return;
    setEmail(e);

    try {
      setBusy(true);
      const priceId = plan === "annual" ? priceIdAnnual : priceIdMonthly;
      if (!priceId) {
        alert("Missing priceId for selected plan.");
        return;
      }
      const r = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId, email: e }),
      });
      if (!r.ok) {
        const t = await r.text();
        console.error("[Upgrade] non-OK:", t);
        alert("Unable to start checkout. Please try again.");
        return;
      }
      const data = await r.json();
      if (data?.url) {
        window.location.href = data.url; // redirect to Stripe Checkout
      } else {
        alert("Checkout not initialized. Please try again.");
      }
    } catch (err) {
      console.error("[Upgrade] error:", err);
      alert("Something went wrong launching checkout.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="contained" size="large" onClick={() => setOpen(true)} disabled={busy}>
        {busy ? "Preparing..." : label}
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
          />
          {/* Optional: simple plan selector */}
          {/* <FormControlLabel control={<Switch checked={plan==='annual'} onChange={(e)=>setPlan(e.target.checked?'annual':'monthly')} />} label="Bill annually" /> */}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={ensureEmailThenCheckout} disabled={busy}>
            {busy ? "Launching..." : "Continue"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
