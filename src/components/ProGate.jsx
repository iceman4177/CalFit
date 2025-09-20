// src/components/ProGate.jsx
import React, { useState } from "react";
import { Alert, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Typography } from "@mui/material";
import { useEntitlements } from "../context/EntitlementsContext.jsx";

export default function ProGate({ children, ctaText = "Unlock with Pro" }) {
  const { isProActive, email, setEmail } = useEntitlements();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(email);

  if (isProActive) return children;

  const proceedUpgrade = () => {
    const e = (val || "").trim().toLowerCase();
    if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return;
    setEmail(e);
    setOpen(false);
    // you can navigate to a dedicated Upgrade page or render <UpgradeButton/> here
  };

  return (
    <>
      <Alert severity="info" action={<Button onClick={() => setOpen(true)}>{ctaText}</Button>}>
        This feature is for Pro members.
      </Alert>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Sign in to continue</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Enter your email to start your free trial and unlock Pro features.
          </Typography>
          <TextField
            autoFocus
            label="Email"
            type="email"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={proceedUpgrade}>Continue</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
