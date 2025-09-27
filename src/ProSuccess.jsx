// src/ProSuccess.jsx
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
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { supabase } from "./lib/supabaseClient";

// Read query params once
function useQuery() {
  return useMemo(() => new URLSearchParams(window.location.search), []);
}

export default function ProSuccess() {
  const q = useQuery();
  const sessionId = q.get("session_id") || undefined; // Stripe injects this via success_url
  const cid = q.get("cid") || undefined;              // your clientId (optional)
  const dev = q.get("dev") === "1";

  // JS version (no TS generics)
  const [phase, setPhase] = useState("checking"); // "checking" | "active" | "waiting" | "error"
  const [message, setMessage] = useState("");

  // Poll server truth (Supabase via secure API) instead of flipping local flags
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Ensure we have an authenticated user
        const { data: auth } = await supabase.auth.getUser();
        const user = auth?.user || null;
        if (!user) {
          setPhase("error");
          setMessage("You’re not signed in. Please sign in again to finish your Pro upgrade.");
          return;
        }

        // Give the webhook a moment to arrive; then poll the API for ~30s
        const start = Date.now();
        const maxMs = 30000;
        const step = 1200;

        // Small initial delay improves odds the first check succeeds
        await new Promise((r) => setTimeout(r, 1200));

        while (!cancelled && Date.now() - start < maxMs) {
          const res = await fetch(`/api/me/pro-status?user_id=${encodeURIComponent(user.id)}`);
          const json = await res.json().catch(() => ({}));

          if (res.ok && json?.isPro) {
            setPhase("active");
            setMessage("Your Pro access is active. Enjoy!");
            return;
          }

          // Not active yet → keep waiting
          setPhase("waiting");
          setMessage("Finalizing your Pro access… This can take a few seconds.");
          await new Promise((r) => setTimeout(r, step));
        }

        // Timed out
        if (!cancelled) {
          setPhase("error");
          setMessage(
            "Still syncing your subscription. If this persists, refresh this page or contact support."
          );
        }
      } catch (e) {
        console.error("[ProSuccess] error:", e);
        if (!cancelled) {
          setPhase("error");
          setMessage(e?.message || "Unexpected error while checking your Pro status.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const go = (path) => () => {
    window.location.href = path;
  };

  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Card elevation={3} sx={{ borderRadius: 3 }}>
        <CardContent>
          <Stack alignItems="center" spacing={2}>
            {phase === "active" ? (
              <>
                <CheckCircleOutlineIcon color="success" sx={{ fontSize: 64 }} />
                <Typography variant="h4" align="center" gutterBottom>
                  {dev ? "Pro Activated (Dev) 🎉" : "You’re Pro! 🎉"}
                </Typography>
                <Typography variant="body1" align="center" sx={{ opacity: 0.9 }}>
                  {message}
                </Typography>
                {cid && (
                  <Typography variant="caption" sx={{ mt: 1, opacity: 0.6 }}>
                    Ref: {cid}{dev ? " (dev)" : ""}{sessionId ? ` • session ${sessionId}` : ""}
                  </Typography>
                )}
                <Box sx={{ mt: 3 }}>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="center">
                    <Button variant="contained" onClick={go("/dashboard")}>
                      Go to Dashboard
                    </Button>
                    <Button variant="outlined" onClick={go("/workout")}>
                      Log a Workout
                    </Button>
                    <Button variant="outlined" onClick={go("/meals")}>
                      Log a Meal
                    </Button>
                  </Stack>
                </Box>
              </>
            ) : phase === "waiting" || phase === "checking" ? (
              <>
                {phase === "checking" ? (
                  <HourglassEmptyIcon sx={{ fontSize: 64 }} />
                ) : (
                  <CircularProgress />
                )}
                <Typography variant="h6" align="center">
                  {phase === "checking" ? "Confirming your Pro upgrade…" : "Finalizing your Pro access…"}
                </Typography>
                <Typography variant="body2" align="center" sx={{ opacity: 0.8 }}>
                  {message || "Hang tight while we confirm your payment with Stripe."}
                </Typography>
              </>
            ) : (
              <>
                <ErrorOutlineIcon color="error" sx={{ fontSize: 64 }} />
                <Typography variant="h6" align="center" gutterBottom>
                  We’re still syncing your Pro access
                </Typography>
                <Typography variant="body2" align="center" sx={{ opacity: 0.8 }}>
                  {message}
                </Typography>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 2 }}>
                  <Button variant="contained" onClick={() => window.location.reload()}>
                    Refresh
                  </Button>
                  <Button variant="outlined" onClick={go("/")}>
                    Back Home
                  </Button>
                </Stack>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}
