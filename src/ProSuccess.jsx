import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Stack,
  Typography,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import FitnessCenterIcon from "@mui/icons-material/FitnessCenter";
import RestaurantIcon from "@mui/icons-material/Restaurant";

function useQuery() {
  return useMemo(() => new URLSearchParams(window.location.search), []);
}

function ensureLegacyProFlags() {
  // Keep legacy flags in sync so any older gates unlock immediately.
  localStorage.setItem("isPro", "true");
  localStorage.setItem("isProActive", "true");

  if (!localStorage.getItem("trialStart")) {
    const now = Date.now();
    const end = now + 7 * 24 * 60 * 60 * 1000;
    localStorage.setItem("trialStart", String(now));
    localStorage.setItem("trialEndTs", String(end));
  }
}

/**
 * Optionally notify EntitlementsContext to re-check (if you wire a listener).
 * In EntitlementsContext.jsx, you can add:
 *   useEffect(() => {
 *     const fn = () => refetchEntitlements();
 *     window.addEventListener('entitlements:refresh', fn);
 *     return () => window.removeEventListener('entitlements:refresh', fn);
 *   }, []);
 */
function notifyEntitlementsRefresh() {
  try {
    window.dispatchEvent(new CustomEvent("entitlements:refresh"));
  } catch {}
}

export default function ProSuccess() {
  const q = useQuery();
  const cid = q.get("cid") || undefined;
  const dev = q.get("dev") === "1";

  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 1) Normalize local flags so UI unlocks immediately
    ensureLegacyProFlags();

    // 2) (Optional) You can show cid for debugging/CS purposes
    if (cid) {
      localStorage.setItem("lastProCid", cid);
    }

    // 3) Ask Entitlements to refresh (if your context listens)
    notifyEntitlementsRefresh();

    // 4) Make the UI ready (simulate a tiny load so it feels responsive)
    const t = setTimeout(() => setReady(true), 250);
    return () => clearTimeout(t);
  }, [cid]);

  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Card elevation={3} sx={{ borderRadius: 3 }}>
        <CardContent>
          <Stack alignItems="center" spacing={2}>
            {ready ? (
              <>
                <CheckCircleOutlineIcon color="success" sx={{ fontSize: 64 }} />
                <Typography variant="h4" align="center" gutterBottom>
                  {dev ? "Pro (Simulated) Activated 🎉" : "You’re Pro! 🎉"}
                </Typography>
                <Typography variant="body1" align="center" sx={{ opacity: 0.9 }}>
                  Your 7-day free trial has started. Premium features are now unlocked:
                </Typography>

                <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
                  <Stack alignItems="center" spacing={0.5}>
                    <EmojiEventsIcon />
                    <Typography variant="caption">AI Recaps</Typography>
                  </Stack>
                  <Stack alignItems="center" spacing={0.5}>
                    <RestaurantIcon />
                    <Typography variant="caption">AI Meal Tips</Typography>
                  </Stack>
                  <Stack alignItems="center" spacing={0.5}>
                    <FitnessCenterIcon />
                    <Typography variant="caption">Custom Goals</Typography>
                  </Stack>
                </Stack>

                {cid && (
                  <Typography variant="caption" sx={{ mt: 1, opacity: 0.6 }}>
                    Ref: {cid}{dev ? " (dev)" : ""}
                  </Typography>
                )}

                <Box sx={{ mt: 3 }}>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="center">
                    <Button
                      variant="contained"
                      color="primary"
                      onClick={() => (window.location.href = "/dashboard")}
                    >
                      Go to Dashboard
                    </Button>
                    <Button variant="outlined" onClick={() => (window.location.href = "/workout")}>
                      Log a Workout
                    </Button>
                    <Button variant="outlined" onClick={() => (window.location.href = "/meals")}>
                      Log a Meal
                    </Button>
                  </Stack>
                </Box>

                <Typography variant="body2" align="center" sx={{ mt: 2, opacity: 0.7 }}>
                  Tip: If this page sits here, refresh once. Your subscription may take a few seconds to sync.
                </Typography>
              </>
            ) : (
              <>
                <CircularProgress />
                <Typography variant="body2" sx={{ mt: 1, opacity: 0.8 }}>
                  Finalizing your Pro access…
                </Typography>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}
