// src/ProSuccess.jsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Stack,
  Typography,
  Chip,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { supabase } from "./lib/supabaseClient";


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

  const checkProStatus = useCallback(async ({ settleDelayMs = 900, maxMs = 30000 } = {}) => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user || null;
      if (!user) {
        setPhase("error");
        setMessage("You’re not signed in. Please sign in again to finish your Pro upgrade.");
        return;
      }

      setPhase("checking");
      setMessage("Checking your Pro access…");

      const start = Date.now();
      const step = 1200;

      if (settleDelayMs > 0) {
        await new Promise((r) => setTimeout(r, settleDelayMs));
      }

      while (Date.now() - start < maxMs) {
        const res = await fetch(`/api/me/pro-status?user_id=${encodeURIComponent(user.id)}`, {
          headers: { "Cache-Control": "no-cache" },
        });

        let json = {};
        try { json = await res.json(); } catch {}

        if (json?.subscription_id) setSubscriptionId(json.subscription_id);
        if (json?.status) setStatusLine(json.status);

        if (res.ok && (json?.isPro || json?.is_pro)) {
          setPhase("active");
          setMessage("Your Pro access is active. Enjoy!");
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

      setPhase("error");
      setMessage(
        "Still syncing your subscription. If this persists, try checking again or contact support."
      );
    } catch (e) {
      console.error("[ProSuccess] error:", e);
      setPhase("error");
      setMessage(e?.message || "Unexpected error while checking your Pro status.");
    }
  }, []);

  // 2) Poll server truth (Supabase-backed) until isPro flips true, or timeout.
  useEffect(() => {
    checkProStatus({ settleDelayMs: 900, maxMs: 30000 });
  }, [checkProStatus]);

  // 3) When active, flip local flags so the UI updates immediately (header CTA, etc.)
  useEffect(() => {
    if (phase !== "active") return;
    try {
      localStorage.setItem("isPro", "true");
      const ud = JSON.parse(localStorage.getItem("userData") || "{}");
      if (!ud.isPremium) {
        localStorage.setItem("userData", JSON.stringify({ ...ud, isPremium: true }));
      }
      window.dispatchEvent(new CustomEvent("slimcal:pro-changed"));
    } catch { /* ignore */ }
  }, [phase]);

  const go = (path) => () => { window.location.href = path; };
  const statusTone = String(statusLine || "").toLowerCase();
  const statusLabel = statusTone === "trialing" ? "Trial active" : "Pro active";

  return (
    <Box
      sx={{
        minHeight: 'calc(100vh - 72px)',
        background: 'linear-gradient(180deg, #f8fbff 0%, #eef4ff 100%)',
        py: { xs: 3, sm: 5 },
      }}
    >
      <Container maxWidth="sm">
        <Card
          elevation={0}
          sx={{
            borderRadius: { xs: 5, sm: 6 },
            border: '1px solid rgba(15,23,42,0.06)',
            boxShadow: '0 18px 50px rgba(37,99,235,0.08)',
            overflow: 'hidden',
          }}
        >
          <CardContent sx={{ p: { xs: 3, sm: 4.5 } }}>
            <Stack alignItems="center" spacing={2.25}>
              {phase === "active" ? (
                <>
                  <Box
                    sx={{
                      width: 96,
                      height: 96,
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      background: 'radial-gradient(circle at 30% 30%, rgba(34,197,94,0.18), rgba(34,197,94,0.06))',
                    }}
                  >
                    <CheckCircleOutlineIcon color="success" sx={{ fontSize: 68 }} />
                  </Box>

                  <Stack spacing={1} alignItems="center">
                    <Typography
                      variant="h3"
                      align="center"
                      sx={{
                        fontWeight: 900,
                        fontSize: { xs: '2rem', sm: '2.4rem' },
                        letterSpacing: '-0.02em',
                        color: '#0f172a',
                      }}
                    >
                      {dev ? "Pro Activated" : "You’re Pro! 🎉"}
                    </Typography>
                    <Typography
                      variant="body1"
                      align="center"
                      sx={{
                        maxWidth: 440,
                        color: 'rgba(15,23,42,0.72)',
                        fontSize: { xs: '1.02rem', sm: '1.08rem' },
                      }}
                    >
                      {message || "Your Pro access is active. You’re all set."}
                    </Typography>
                  </Stack>

                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.25}
                    alignItems="center"
                    justifyContent="center"
                    sx={{ width: '100%', pt: 0.5 }}
                  >
                    <Chip
                      label={statusLabel}
                      color="success"
                      sx={{
                        fontWeight: 800,
                        height: 38,
                        borderRadius: 999,
                        fontSize: '0.95rem',
                        '& .MuiChip-label': { px: 1.75 },
                      }}
                    />
                    {dev ? (
                      <Chip
                        label="Dev mode"
                        variant="outlined"
                        sx={{
                          fontWeight: 800,
                          height: 38,
                          borderRadius: 999,
                          fontSize: '0.95rem',
                          '& .MuiChip-label': { px: 1.75 },
                        }}
                      />
                    ) : null}
                  </Stack>

                  <Box
                    sx={{
                      width: '100%',
                      borderRadius: 4,
                      background: 'linear-gradient(180deg, rgba(37,99,235,0.05), rgba(37,99,235,0.025))',
                      border: '1px solid rgba(37,99,235,0.10)',
                      px: { xs: 2, sm: 2.5 },
                      py: { xs: 2, sm: 2.25 },
                    }}
                  >
                    <Stack spacing={0.75}>
                      <Typography sx={{ fontWeight: 900, color: '#0f172a', fontSize: '1rem' }}>
                        You’re unlocked
                      </Typography>
                      <Typography sx={{ color: 'rgba(15,23,42,0.72)' }}>
                        AI Workout, AI Meals, Coach, Daily Check-In, and Pose Session are ready to go.
                      </Typography>
                    </Stack>
                  </Box>

                  <Stack spacing={1.25} sx={{ width: '100%', pt: 0.5 }}>
                    <Button
                      variant="contained"
                      onClick={go("/")}
                      size="large"
                      sx={{
                        minHeight: 54,
                        borderRadius: 999,
                        fontWeight: 900,
                        fontSize: '1.05rem',
                        textTransform: 'none',
                      }}
                    >
                      Go Home
                    </Button>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                      <Button
                        variant="outlined"
                        onClick={go("/workout")}
                        size="large"
                        fullWidth
                        sx={{
                          minHeight: 52,
                          borderRadius: 999,
                          fontWeight: 800,
                          textTransform: 'none',
                        }}
                      >
                        Log a Workout
                      </Button>
                      <Button
                        variant="outlined"
                        onClick={go("/meals")}
                        size="large"
                        fullWidth
                        sx={{
                          minHeight: 52,
                          borderRadius: 999,
                          fontWeight: 800,
                          textTransform: 'none',
                        }}
                      >
                        Log a Meal
                      </Button>
                    </Stack>
                  </Stack>

                  {dev && (cid || sessionId) ? (
                    <Typography variant="caption" sx={{ opacity: 0.55, pt: 1 }}>
                      {cid ? `Ref: ${cid}` : ''}
                      {cid && sessionId ? ' • ' : ''}
                      {sessionId ? `session ${sessionId}` : ''}
                    </Typography>
                  ) : null}
                </>
              ) : phase === "waiting" || phase === "checking" ? (
                <>
                  <Box
                    sx={{
                      width: 88,
                      height: 88,
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      background: 'radial-gradient(circle at 30% 30%, rgba(37,99,235,0.10), rgba(37,99,235,0.03))',
                    }}
                  >
                    {phase === "checking" ? (
                      <HourglassEmptyIcon sx={{ fontSize: 56, color: '#2563eb' }} />
                    ) : (
                      <CircularProgress size={42} />
                    )}
                  </Box>
                  <Typography variant="h4" align="center" sx={{ fontWeight: 900, color: '#0f172a' }}>
                    {phase === "checking" ? "Confirming your Pro upgrade…" : "Finalizing your Pro access…"}
                  </Typography>
                  <Typography variant="body1" align="center" sx={{ maxWidth: 420, color: 'rgba(15,23,42,0.72)' }}>
                    {message || "Hang tight while we confirm your payment with Stripe."}
                  </Typography>
                </>
              ) : (
                <>
                  <Box
                    sx={{
                      width: 88,
                      height: 88,
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      background: 'radial-gradient(circle at 30% 30%, rgba(239,68,68,0.10), rgba(239,68,68,0.03))',
                    }}
                  >
                    <ErrorOutlineIcon color="error" sx={{ fontSize: 56 }} />
                  </Box>
                  <Typography variant="h4" align="center" sx={{ fontWeight: 900, color: '#0f172a' }}>
                    We’re still syncing your Pro access
                  </Typography>
                  <Typography variant="body1" align="center" sx={{ maxWidth: 440, color: 'rgba(15,23,42,0.72)' }}>
                    {message}
                  </Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ mt: 1, width: '100%' }}>
                    <Button
                      variant="contained"
                      onClick={() => checkProStatus({ settleDelayMs: 0, maxMs: 15000 })}
                      size="large"
                      fullWidth
                      sx={{ minHeight: 52, borderRadius: 999, fontWeight: 900, textTransform: 'none' }}
                    >
                      Check again
                    </Button>
                    <Button
                      variant="outlined"
                      onClick={go("/")}
                      size="large"
                      fullWidth
                      sx={{ minHeight: 52, borderRadius: 999, fontWeight: 800, textTransform: 'none' }}
                    >
                      Back Home
                    </Button>
                  </Stack>
                </>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
