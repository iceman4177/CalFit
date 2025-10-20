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

// ⬇️ Add this import (you created this earlier)
//    If you placed it somewhere else, update the import path accordingly.
import CancelProButton from "./components/CancelProButton.jsx";

// Read query params once (client-only)
function useQuery() {
  return useMemo(() => new URLSearchParams(typeof window !== "undefined" ? window.location.search : ""), []);
}

export default function ProSuccess() {
  const q = useQuery();
  const sessionId = q.get("session_id") || undefined; // Stripe injects this via success_url
  const cid = q.get("cid") || undefined;              // optional client ref
  const dev = q.get("dev") === "1";

  // "checking" | "active" | "waiting" | "error"
  const [phase, setPhase] = useState("checking");
  const [message, setMessage] = useState("");
  const [subscriptionId, setSubscriptionId] = useState(null);
  const [statusLine, setStatusLine] = useState("");

  // 1) Fire-and-forget session finalization on backend (no user impact if it fails;
  //    webhook + polling still confirm entitlement).
  useEffect(() => {
    if (!sessionId) return;
    let aborted = false;
    (async () => {
      try {
        await fetch(`/api/pro-from-session?session_id=${encodeURIComponent(sessionId)}`, {
          method: "GET",
          headers: { "Cache-Control": "no-cache" },
        });
      } catch {
        // ignore; webhook & polling will still recover
      }
      if (!aborted) {
        await new Promise((r) => setTimeout(r, 450));
      }
    })();
    return () => { aborted = true; };
  }, [sessionId]);

  // 2) Poll server truth (Supabase-backed) until isPro flips true, or timeout.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const user = auth?.user || null;
        if (!user) {
          setPhase("error");
          setMessage("You’re not signed in. Please sign in again to finish your Pro upgrade.");
          return;
        }

        const start = Date.now();
        const maxMs = 30000; // 30s overall
        const step = 1200;

        // brief wait to allow webhook → DB write path to run
        await new Promise((r) => setTimeout(r, 900));

        while (!cancelled && Date.now() - start < maxMs) {
          const res = await fetch(`/api/me/pro-status?user_id=${encodeURIComponent(user.id)}`, {
            headers: { "Cache-Control": "no-cache" },
          });

          let json = {};
          try { json = await res.json(); } catch {}

          // Older builds might not include subscription_id; try separate endpoint when needed.
          if (json?.subscription_id) setSubscriptionId(json.subscription_id);
          if (json?.status) setStatusLine(json.status);

          if (res.ok && (json?.isPro || json?.is_pro)) {
            setPhase("active");
            setMessage("Your Pro access is active. Enjoy!");
            // Try to get subscription details for the Cancel button
            if (!json?.subscription_id) {
              try {
                const r2 = await fetch("/api/me/subscription", { headers: { "Cache-Control": "no-cache" } });
                const j2 = await r2.json().catch(() => ({}));
                if (j2?.subscription_id) setSubscriptionId(j2.subscription_id);
                if (j2?.status) setStatusLine(j2.status);
              } catch {}
            }
            return;
          }

          setPhase("waiting");
          setMessage("Finalizing your Pro access… This can take a few seconds.");
          await new Promise((r) => setTimeout(r, step));
        }

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

    return () => { cancelled = true; };
  }, []);

  // 3) When active, flip local flags so the UI updates immediately (header CTA, etc.)
  useEffect(() => {
    if (phase !== "active") return;
    try {
      localStorage.setItem("isPro", "true");
      const ud = JSON.parse(localStorage.getItem("userData") || "{}");
      if (!ud.isPremium) {
        localStorage.setItem("userData", JSON.stringify({ ...ud, isPremium: true }));
      }
    } catch { /* ignore */ }
  }, [phase]);

  const go = (path) => () => { window.location.href = path; };

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

                {(cid || sessionId) && (
                  <Typography variant="caption" sx={{ mt: 1, opacity: 0.6 }}>
                    {cid ? `Ref: ${cid}${dev ? " (dev)" : ""}` : ""}
                    {cid && sessionId ? " • " : ""}
                    {sessionId ? `session ${sessionId}` : ""}
                  </Typography>
                )}

                {/* Status line & cancel control */}
                <Box sx={{ mt: 2 }}>
                  {statusLine ? (
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>
                      Subscription status: {statusLine}
                    </Typography>
                  ) : null}
                </Box>

                <Box sx={{ mt: 2 }}>
                  {subscriptionId ? (
                    <CancelProButton subscriptionId={subscriptionId} />
                  ) : (
                    <Typography variant="caption" sx={{ opacity: 0.6 }}>
                      (Subscription details syncing… refresh if you don’t see the cancel option.)
                    </Typography>
                  )}
                </Box>

                <Box sx={{ mt: 3 }}>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="center">
                    <Button variant="contained" onClick={go("/")}>
                      Go Home
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
