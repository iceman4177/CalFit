// src/pages/ProSuccess.jsx
import React, { useEffect, useState } from "react";
import { Box, Button, CircularProgress, Typography } from "@mui/material";
import { useEntitlements } from "../context/EntitlementsContext.jsx";

export default function ProSuccess() {
  const { email, refreshEntitlements, isProActive, status } = useEntitlements();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // If the user cleared storage or used a different device,
        // you could parse email from ?email= in URL as a fallback.
        await refreshEntitlements();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [refreshEntitlements]);

  return (
    <Box sx={{ p: 3, maxWidth: 640, mx: "auto", textAlign: "center" }}>
      <Typography variant="h4" sx={{ mb: 1 }}>You're all set!</Typography>
      <Typography variant="body1" sx={{ mb: 3 }}>
        {email ? `Pro is being activated for ${email}.` : "Pro is being activated for your account."}
      </Typography>
      {loading ? (
        <CircularProgress />
      ) : isProActive ? (
        <>
          <Typography variant="h6" sx={{ mb: 1 }}>Pro status: {status}</Typography>
          <Typography variant="body2" sx={{ mb: 3 }}>
            You can now access all Pro features. Enjoy!
          </Typography>
          <Button variant="contained" href="/">Go to Dashboard</Button>
        </>
      ) : (
        <>
          <Typography variant="body2" color="warning.main" sx={{ mb: 2 }}>
            Pro is not active yet. This can take a few seconds after checkout completes.
          </Typography>
          <Button variant="outlined" onClick={refreshEntitlements}>Refresh</Button>
        </>
      )}
    </Box>
  );
}
