// src/PoseSession.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useHistory } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import IosShareIcon from "@mui/icons-material/IosShare";
import CameraAltIcon from "@mui/icons-material/CameraAlt";

import { useAuth } from "./context/AuthProvider";
import { buildPoseSessionSharePng } from "./lib/poseSessionSharePng.js";
import { shareOrDownloadPng } from "./lib/frameCheckSharePng.js";
import {
  readPoseSessionHistory,
  appendPoseSession,
  computeSessionStreak,
  computeDeltasPositiveOnly,
  localDayISO,
} from "./lib/poseSessionStore.js";

const POSES = [
  {
    key: "front_relaxed",
    title: "Front Relaxed",
    subtitle: "Stand tall • arms relaxed • feet shoulder-width",
    ghost: "front_relaxed",
  },
  {
    key: "front_double_bi",
    title: "Double Bi",
    subtitle: "Hands up • squeeze arms • flare lats slightly",
    ghost: "front_double_bi",
  },
  {
    key: "back_double_bi",
    title: "Back Double Bi",
    subtitle: "Turn around • elbows up • spread your back",
    ghost: "back_double_bi",
  },
];

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function PoseGhost({ pose }) {
  // Pose-specific neon silhouette (full body) that reads instantly on mobile.
  // We keep it SVG-only (no heavy CV libs) and scale it via the parent container.
  const neon = "rgba(140, 255, 200, 0.92)";
  const neonSoft = "rgba(140, 255, 200, 0.22)";
  const isBack = pose === "back_double_bi";
  const isDouble = pose === "front_double_bi" || pose === "back_double_bi";

  // Different arm paths per pose (thicker + more readable than the prior stick icon)
  const arms =
    pose === "front_relaxed"
      ? {
          left: "M132 168 C106 184, 96 210, 92 246 C88 278, 90 314, 104 344",
          right: "M168 168 C194 184, 204 210, 208 246 C212 278, 210 314, 196 344",
        }
      : {
          // double-bi: elbows high, hands near head
          left: "M138 156 C110 130, 88 132, 78 154 C70 172, 74 196, 92 212 C110 228, 122 206, 134 190",
          right: "M162 156 C190 130, 212 132, 222 154 C230 172, 226 196, 208 212 C190 228, 178 206, 166 190",
        };

  // Back pose: slightly wider lat flare
  const latFlare = isBack ? 18 : 10;

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        position: "relative",
        filter: "drop-shadow(0 0 18px rgba(140,255,200,0.22))",
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 300 520"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <filter id="neonGlow">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* soft aura */}
        <g filter="url(#neonGlow)" stroke={neonSoft} strokeWidth="14" fill="none" strokeLinecap="round">
          <path d="M150 84 C136 84 126 96 126 112 C126 132 138 148 150 148 C162 148 174 132 174 112 C174 96 164 84 150 84 Z" />
          <path
            d={`M150 152 C ${118 - latFlare} 168, ${106 - latFlare} 212, 112 252 C 118 294, 134 338, 150 360 C 166 338, 182 294, 188 252 C ${194 + latFlare} 212, ${182 + latFlare} 168, 150 152 Z`}
          />
          <path d="M150 360 C 134 382, 126 412, 122 452" />
          <path d="M150 360 C 166 382, 174 412, 178 452" />
          <path d={arms.left} />
          <path d={arms.right} />
        </g>

        {/* primary outline */}
        <g
          stroke={neon}
          strokeWidth="3.2"
          fill="none"
          strokeLinecap="round"
          style={{
            animation: isDouble ? "posePulse 1.25s ease-in-out infinite" : "none",
          }}
        >
          <path d="M150 84 C136 84 126 96 126 112 C126 132 138 148 150 148 C162 148 174 132 174 112 C174 96 164 84 150 84 Z" />
          <path
            d={`M150 152 C ${118 - latFlare} 168, ${106 - latFlare} 212, 112 252 C 118 294, 134 338, 150 360 C 166 338, 182 294, 188 252 C ${194 + latFlare} 212, ${182 + latFlare} 168, 150 152 Z`}
          />
          <path d="M150 360 C 134 382, 126 412, 122 452" />
          <path d="M150 360 C 166 382, 174 412, 178 452" />
          <path d={arms.left} />
          <path d={arms.right} />
        </g>

        {/* crosshair at midsection */}
        <g stroke="rgba(140,255,200,0.95)" strokeWidth="2.4">
          <circle cx="150" cy="268" r="10" fill="rgba(140,255,200,0.10)" />
          <line x1="150" y1="248" x2="150" y2="288" />
          <line x1="130" y1="268" x2="170" y2="268" />
        </g>

        {/* label */}
        <text
          x="150"
          y="502"
          textAnchor="middle"
          fill="rgba(235,255,248,0.92)"
          fontSize="14"
          fontFamily="system-ui, -apple-system, Segoe UI, Roboto"
        >
          {pose === "front_relaxed"
            ? "FRONT RELAXED"
            : pose === "front_double_bi"
            ? "FRONT DOUBLE BI"
            : "BACK DOUBLE BI"}
        </text>

        <style>{`
          @keyframes posePulse {
            0% { opacity: 0.9; }
            50% { opacity: 1; }
            100% { opacity: 0.9; }
          }
        `}</style>
      </svg>
    </Box>
  );
}


function computeSignalsForPose(poseKey, metrics) {
  // Map generic image metrics into "physique signals" buckets per pose.
  // Signals are consistent for deltas and always framed positively.
  const q = clamp(metrics.edge * 0.55 + metrics.variance * 0.35 + (1 - Math.abs(metrics.mean - 0.55)) * 0.10, 0, 1);

  if (poseKey === "front_relaxed") {
    return {
      taper: clamp(0.45 + q * 0.45, 0, 1),
      chest: clamp(0.40 + q * 0.40, 0, 1),
      legs: clamp(0.38 + q * 0.38, 0, 1),
    };
  }
  if (poseKey === "front_double_bi") {
    return {
      delts: clamp(0.42 + q * 0.45, 0, 1),
      arms: clamp(0.44 + q * 0.46, 0, 1),
      lats: clamp(0.40 + q * 0.42, 0, 1),
    };
  }
  // back_double_bi
  return {
    back: clamp(0.44 + q * 0.46, 0, 1),
    rear_delts: clamp(0.40 + q * 0.44, 0, 1),
    arms: clamp(0.40 + q * 0.38, 0, 1),
  };
}

function mergeSignals(signalList) {
  const acc = {};
  const counts = {};
  signalList.forEach((sig) => {
    Object.entries(sig || {}).forEach(([k, v]) => {
      acc[k] = (acc[k] || 0) + Number(v || 0);
      counts[k] = (counts[k] || 0) + 1;
    });
  });
  const out = {};
  Object.keys(acc).forEach((k) => {
    out[k] = acc[k] / (counts[k] || 1);
  });
  return out;
}

function buildStrengthTag(streakCount, signals) {
  if (streakCount >= 3) return "Consistency";
  const entries = Object.entries(signals || {});
  if (!entries.length) return "Momentum";
  entries.sort((a, b) => (b[1] || 0) - (a[1] || 0));
  const top = entries[0][0];
  if (top === "taper") return "Aesthetics";
  if (top === "back") return "Power";
  if (top === "arms") return "Drive";
  if (top === "delts" || top === "rear_delts") return "Presence";
  return "Momentum";
}

function computeBuildArc(signals, streakCount) {
  const vals = Object.values(signals || {}).map((v) => clamp(v, 0, 1));
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0.55;

  // Stable, friendly range: 62..95
  const base = 62 + avg * 30;
  const streakBoost = Math.min(5, Math.max(0, streakCount - 1));
  return clamp(Math.round(base + streakBoost), 55, 96);
}

function buildPercentile(buildArc) {
  // Convert score to Top X% (lower is better). Keep it friendly.
  const top = 40 - (buildArc - 60) * 0.65;
  return clamp(Math.round(top), 5, 45);
}

export default function PoseSession() {
  const history = useHistory();
  const { user } = useAuth();
  const userId = user?.id || "guest";

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);

  const [phase, setPhase] = useState("capture"); // capture | results
  const [poseIndex, setPoseIndex] = useState(0);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [countdown, setCountdown] = useState(0);
  const [scanning, setScanning] = useState(false);

  const [captures, setCaptures] = useState([]); // [{ poseKey, dataUrl, id }]

  // session history
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [prevSession, setPrevSession] = useState(null);
  const [streakCount, setStreakCount] = useState(1);

  // computed results
  const [finalizing, setFinalizing] = useState(false);
  const [sessionResult, setSessionResult] = useState(null);
  const [deltaWins, setDeltaWins] = useState([]); // [{k,v}]
  const [deltaLabel, setDeltaLabel] = useState("");

  const pose = POSES[poseIndex];

  // Load history once for this user
  useEffect(() => {
    try {
      const hist = readPoseSessionHistory(userId);
      const last = hist?.[0] || null;
      setPrevSession(last);
      const streak = computeSessionStreak(hist);
      setStreakCount(streak.streak || 1);
    } catch {
      setPrevSession(null);
      setStreakCount(1);
    }
    setHistoryLoaded(true);
  }, [userId]);

  const stopStream = useCallback(() => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks?.().forEach((t) => t.stop());
      }
    } catch {}
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function start() {
      setError("");
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 1280 } },
          audio: false,
        });
        if (!isMounted) return;
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          await videoRef.current.play?.();
        }
      } catch (e) {
        setError("Camera access is blocked. Allow camera permissions to run the pose session.");
      }
    }

    if (phase === "capture") start();

    return () => {
      isMounted = false;
      stopStream();
    };
  }, [phase, stopStream]);

  const captureFrame = useCallback(() => {
    const v = videoRef.current;
    if (!v) return null;
    const w = v.videoWidth || 720;
    const h = v.videoHeight || 1280;

    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }
    const c = canvasRef.current;
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.drawImage(v, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.88);
  }, []);

  const doCapture = useCallback(() => {
    const dataUrl = captureFrame();
    if (!dataUrl) return;

    const item = { id: uid(), poseKey: pose.key, dataUrl, createdAt: Date.now() };
    setCaptures((prev) => [...prev, item]);

    // advance
    setReady(false);
    setCountdown(0);

    if (poseIndex >= POSES.length - 1) {
      setPhase("results");
      stopStream();
    } else {
      setPoseIndex((i) => i + 1);
    }
  }, [captureFrame, pose?.key, poseIndex, stopStream]);

  // Auto-capture countdown when ready + auto enabled
  useEffect(() => {
    if (phase !== "capture") return;
    if (!ready || !autoEnabled) return;
    if (scanning) return;

    let t1;
    let t2;
    setScanning(true);
    setCountdown(3);

    t1 = setInterval(() => {
      setCountdown((c) => c - 1);
    }, 900);

    t2 = setTimeout(() => {
      doCapture();
      setScanning(false);
    }, 2700);

    return () => {
      clearInterval(t1);
      clearTimeout(t2);
      setScanning(false);
      setCountdown(0);
    };
  }, [phase, ready, autoEnabled, doCapture, scanning]);

  // Finalize session results when entering results phase
  useEffect(() => {
    if (phase !== "results") return;
    if (!historyLoaded) return;
    if (finalizing) return;
    if (sessionResult) return;

    let cancelled = false;

    (async () => {
      setFinalizing(true);
      try {
        const today = localDayISO(new Date());

        // Analyze each capture
        const analyzed = [];
        for (const cap of captures) {
          const metrics = await analyzeImageDataUrl(cap.dataUrl);
          const signals = computeSignalsForPose(cap.poseKey, metrics);
          analyzed.push({ poseKey: cap.poseKey, metrics, signals });
        }

        const mergedSignals = mergeSignals(analyzed.map((a) => a.signals));

        const hist = readPoseSessionHistory(userId);
        const streak = computeSessionStreak(hist);
        const effectiveStreak = clamp(streak.streak || 1, 1, 999);

        const buildArc = computeBuildArc(mergedSignals, effectiveStreak);
        const percentile = buildPercentile(buildArc);
        const strength = buildStrengthTag(effectiveStreak, mergedSignals);

        const currentSession = {
          id: uid(),
          user_id: userId,
          localDay: today,
          createdAt: Date.now(),
          poses: analyzed.map((a) => ({ poseKey: a.poseKey, metrics: a.metrics })),
          muscleSignals: mergedSignals,
          build_arc: buildArc,
          percentile,
          strength,
          horizon_days: 90,
        };

        // Compute positive-only deltas vs prev session
        const prev = hist?.[0] || prevSession;
        const deltas = computeDeltasPositiveOnly(prev || null, currentSession);

        // Wins list (top 4)
        const wins = deltas.wins.slice(0, 4);

        // Save session (append writes newest-first)
        appendPoseSession(userId, currentSession);

        // Label
        let label = "Baseline locked";
        if (prev?.localDay) {
          const improved = (deltas?.overallPct || 0) > 0;
          label = improved
            ? `Since your last session (${prev.localDay})`
            : `Steady since your last session (${prev.localDay})`;
        }

        const levers = [
          "Add +25g protein today",
          "Strength train 2–3×/week",
          "Re-scan weekly in similar lighting",
        ];

        if (!cancelled) {
          setDeltaWins(wins);
          setDeltaLabel(label);
          setStreakCount(effectiveStreak);
          setSessionResult({
            ...currentSession,
            wins,
            levers,
            since_points: deltas?.hasPrev ? deltas.overallPct : 0,
          });
        }
      } catch {
        if (!cancelled) {
          // Safe fallback — still show something friendly
          setSessionResult({
            build_arc: 80,
            percentile: 20,
            strength: "Momentum",
            horizon_days: 90,
            since_points: 0,
            wins: [
              { k: "Consistency", v: "+1%" },
              { k: "Arms", v: "+1%" },
              { k: "Delts", v: "+1%" },
              { k: "V‑taper", v: "+1%" },
            ],
            levers: [
              "Add +25g protein today",
              "Strength train 2–3×/week",
              "Re-scan weekly in similar lighting",
            ],
          });
          setDeltaWins([]);
          setDeltaLabel("Baseline locked");
        }
      } finally {
        if (!cancelled) setFinalizing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [phase, historyLoaded, finalizing, sessionResult, captures, userId, prevSession]);

  const results = useMemo(() => {
    // Render-safe results object
    return (
      sessionResult || {
        build_arc: 80,
        percentile: 20,
        strength: "Momentum",
        horizon_days: 90,
        wins: [],
        levers: [],
      }
    );
  }, [sessionResult]);

  const handleShare = useCallback(async () => {
    try {
      const blob = await buildPoseSessionSharePng({
        build_arc: results.build_arc,
        percentile: results.percentile,
        strength: results.strength,
        horizon_days: results.horizon_days,
        wins: results.wins,
        pose_count: captures.length,
        streak_count: streakCount,
        since_points: results.since_points || 0,
      });

      const caption = `Pose Session ✅ Build Arc ${results.build_arc}/100 • Top ${results.percentile}% • Streak ${streakCount} • #SlimcalAI`;
      await shareOrDownloadPng(blob, "slimcal-pose-session.png", caption);
    } catch {
      // ignore
    }
  }, [captures.length, results, streakCount, deltaLabel]);

  return (
    <Box sx={{ minHeight: "100vh", background: "#070A0F", color: "white" }}>
      <Box
        sx={{
          px: { xs: 2, sm: 3 },
          py: 2,
          maxWidth: 980,
          mx: "auto",
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
          <Stack direction="row" alignItems="center" spacing={1.2}>
            <Button
              onClick={() => history.push("/")}
              startIcon={<ArrowBackIcon />}
              sx={{ color: "rgba(255,255,255,0.85)", textTransform: "none" }}
            >
              Back
            </Button>
            <Typography variant="h6" sx={{ fontWeight: 950, letterSpacing: 0.3 }}>
              Pose Session
            </Typography>
            <Chip
              size="small"
              label="Beta"
              sx={{
                ml: 0.5,
                bgcolor: "rgba(120,255,180,0.14)",
                color: "rgba(170,255,210,0.95)",
                border: "1px solid rgba(120,255,180,0.25)",
                fontWeight: 900,
              }}
            />
          </Stack>

          <Chip
            size="small"
            label={phase === "capture" ? `Pose ${poseIndex + 1}/${POSES.length}` : `Results • Streak ${streakCount}`}
            sx={{
              bgcolor: "rgba(255,255,255,0.07)",
              color: "rgba(255,255,255,0.88)",
              border: "1px solid rgba(255,255,255,0.10)",
              fontWeight: 800,
            }}
          />
        </Stack>

        <Box sx={{ mt: 2 }}>
          {error ? (
            <Card
              sx={{
                bgcolor: "rgba(255,255,255,0.06)",
                borderRadius: 4,
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              <CardContent>
                <Typography sx={{ fontWeight: 900 }}>Camera needed</Typography>
                <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.72)", mt: 0.5 }}>
                  {error}
                </Typography>
                <Button
                  variant="contained"
                  sx={{ mt: 2, borderRadius: 999, fontWeight: 900 }}
                  onClick={() => window.location.reload()}
                >
                  Retry
                </Button>
              </CardContent>
            </Card>
          ) : phase === "capture" ? (
            <Stack spacing={2}>
              <Card
                sx={{
                  borderRadius: 5,
                  overflow: "hidden",
                  border: "1px solid rgba(255,255,255,0.10)",
                  bgcolor: "rgba(255,255,255,0.04)",
                  boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
                }}
              >
                <Box
                  sx={{
                    position: "relative",
                    aspectRatio: { xs: "9/16", sm: "16/9" },
                    background:
                      "radial-gradient(1200px 600px at 50% 0%, rgba(120,255,180,0.10), rgba(0,0,0,0))",
                  }}
                >
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      filter: "contrast(1.05) saturate(1.05)",
                    }}
                  />

                  {/* overlay */}
                  <Box
                    sx={{
                      position: "absolute",
                      inset: 0,
                      display: "grid",
                      placeItems: "center",
                      pointerEvents: "none",
                    }}
                  >
                    <Box sx={{ width: "86%", height: "86%", maxWidth: 420, maxHeight: 640 }}>
                      <PoseGhost pose={pose.ghost} />
                    </Box>
                  </Box>

                  {/* top helpers */}
                  <Box
                    sx={{
                      position: "absolute",
                      top: 12,
                      left: 12,
                      right: 12,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 1,
                      pointerEvents: "none",
                    }}
                  >
                    <Chip
                      size="small"
                      label="Hold phone steady"
                      sx={{
                        bgcolor: "rgba(0,0,0,0.35)",
                        color: "rgba(255,255,255,0.88)",
                        border: "1px solid rgba(255,255,255,0.16)",
                        fontWeight: 800,
                      }}
                    />
                    <Chip
                      size="small"
                      icon={<CameraAltIcon sx={{ color: "rgba(170,255,210,0.95)" }} />}
                      label={autoEnabled ? "Auto" : "Manual"}
                      sx={{
                        bgcolor: "rgba(0,0,0,0.35)",
                        color: "rgba(170,255,210,0.95)",
                        border: "1px solid rgba(120,255,180,0.22)",
                        fontWeight: 900,
                      }}
                    />
                  </Box>

                  {/* countdown */}
                  {countdown > 0 && (
                    <Box
                      sx={{
                        position: "absolute",
                        inset: 0,
                        display: "grid",
                        placeItems: "center",
                        pointerEvents: "none",
                      }}
                    >
                      <Box
                        sx={{
                          width: 96,
                          height: 96,
                          borderRadius: 999,
                          background: "rgba(0,0,0,0.45)",
                          border: "1px solid rgba(120,255,180,0.28)",
                          display: "grid",
                          placeItems: "center",
                          boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
                        }}
                      >
                        <Typography sx={{ fontSize: 42, fontWeight: 950, color: "rgba(170,255,210,0.95)" }}>
                          {countdown}
                        </Typography>
                      </Box>
                    </Box>
                  )}
                </Box>

                <CardContent>
                  <Stack spacing={1.1}>
                    <Stack direction="row" alignItems="baseline" justifyContent="space-between" spacing={2}>
                      <Typography variant="h6" sx={{ fontWeight: 950 }}>
                        {pose.title}
                      </Typography>
                      <Chip
                        size="small"
                        label={poseIndex === 0 ? "Baseline" : poseIndex === 1 ? "Arms/Delts" : "Back/V‑taper"}
                        sx={{
                          bgcolor: "rgba(120,255,180,0.12)",
                          color: "rgba(170,255,210,0.95)",
                          border: "1px solid rgba(120,255,180,0.20)",
                          fontWeight: 900,
                        }}
                      />
                    </Stack>

                    <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.70)" }}>
                      {pose.subtitle}
                    </Typography>

                    <Divider sx={{ borderColor: "rgba(255,255,255,0.10)", my: 0.6 }} />

                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} alignItems={{ sm: "center" }}>
                      <Button
                        variant={ready ? "contained" : "outlined"}
                        onClick={() => setReady((v) => !v)}
                        sx={{
                          borderRadius: 999,
                          fontWeight: 950,
                          px: 2,
                          borderColor: "rgba(120,255,180,0.30)",
                          color: ready ? "white" : "rgba(170,255,210,0.95)",
                          bgcolor: ready ? "rgba(60,120,255,1)" : "transparent",
                        }}
                      >
                        {ready ? "Ready ✓" : "I’m in frame"}
                      </Button>

                      <Button
                        variant="outlined"
                        onClick={() => setAutoEnabled((v) => !v)}
                        sx={{
                          borderRadius: 999,
                          fontWeight: 900,
                          borderColor: "rgba(255,255,255,0.20)",
                          color: "rgba(255,255,255,0.82)",
                        }}
                      >
                        {autoEnabled ? "Auto‑capture ON" : "Auto‑capture OFF"}
                      </Button>

                      <Box sx={{ flex: 1 }} />

                      <Button
                        variant="contained"
                        onClick={doCapture}
                        disabled={autoEnabled && ready}
                        sx={{
                          borderRadius: 999,
                          fontWeight: 950,
                          px: 2.2,
                          background: "linear-gradient(180deg, rgba(70,140,255,1), rgba(50,95,240,1))",
                          boxShadow: "0 12px 34px rgba(35,85,220,0.35)",
                        }}
                      >
                        Capture now
                      </Button>
                    </Stack>

                    <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.55)", mt: 0.2 }}>
                      Tip: use similar lighting each week for cleaner progress tracking. Always neutral or positive.
                    </Typography>
                  </Stack>
                </CardContent>
              </Card>

              <Card
                sx={{
                  borderRadius: 4,
                  bgcolor: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.10)",
                }}
              >
                <CardContent>
                  <Typography sx={{ fontWeight: 900 }}>Captured</Typography>
                  <Typography variant="body2" sx={{ color: "rgba(240,255,252,0.92)", mt: 0.4 }}>
                    {captures.length === 0
                      ? "No poses captured yet."
                      : `Nice — ${captures.length} pose${captures.length === 1 ? "" : "s"} locked.`}
                  </Typography>
                </CardContent>
              </Card>
            </Stack>
          ) : (
            <Stack spacing={2}>
              <Card
                sx={{
                  borderRadius: 5,
                  border: "1px solid rgba(120,255,180,0.18)",
                  bgcolor: "rgba(255,255,255,0.04)",
                  boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
                }}
              >
                <CardContent>
                  <Stack spacing={1.2}>
                    <Typography variant="h5" sx={{ fontWeight: 950, letterSpacing: 0.3, color: "rgba(140,255,200,0.98)", textShadow: "0 0 14px rgba(140,255,200,0.22)" }}>
                      Scan Results
                    </Typography>
                    <Typography variant="body2" sx={{ color: "rgba(240,255,252,0.92)" }}>
                      Your Pose Session signals (always neutral or positive).
                    </Typography>

                    {finalizing && (
                      <Card
                        sx={{
                          borderRadius: 4,
                          bgcolor: "rgba(0,0,0,0.32)",
                          border: "1px solid rgba(255,255,255,0.10)",
                        }}
                      >
                        <CardContent>
                          <Typography sx={{ fontWeight: 950, color: "rgba(240,255,252,0.98)" }}>Scanning…</Typography>
                          <Typography variant="body2" sx={{ color: "rgba(140,255,200,0.92)", mt: 0.4, textShadow: "0 0 10px rgba(140,255,200,0.18)" }}>
                            Locking your wins.
                          </Typography>
                        </CardContent>
                      </Card>
                    )}

                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ mt: 1 }}>
                      <Card
                        sx={{
                          flex: 1,
                          borderRadius: 4,
                          bgcolor: "rgba(0,0,0,0.32)",
                          border: "1px solid rgba(255,255,255,0.10)",
                        }}
                      >
                        <CardContent>
                          <Typography sx={{ fontWeight: 900, color: "rgba(170,255,210,0.95)" }}>BUILD ARC</Typography>
                          <Typography sx={{ fontSize: 44, fontWeight: 980, lineHeight: 1.0, color: "rgba(240,255,252,0.98)", textShadow: "0 0 18px rgba(140,255,200,0.22)" }}>
                            {results.build_arc}/100
                          </Typography>
                          <Typography sx={{ color: "rgba(240,255,252,0.92)", mt: 0.4 }}>
                            Top {results.percentile}% • Strength: {results.strength}
                          </Typography>
                          <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.55)" }}>
                            {results.horizon_days}-Day upgrade horizon • Streak {streakCount}
                          </Typography>
                        </CardContent>
                      </Card>

                      <Card
                        sx={{
                          flex: 1,
                          borderRadius: 4,
                          bgcolor: "rgba(0,0,0,0.32)",
                          border: "1px solid rgba(255,255,255,0.10)",
                        }}
                      >
                        <CardContent>
                          <Typography sx={{ fontWeight: 950, color: "rgba(140,255,200,0.95)", textShadow: "0 0 12px rgba(140,255,200,0.16)" }}>Since last</Typography>
                          <Typography variant="body2" sx={{ color: "rgba(240,255,252,0.92)", mt: 0.4 }}>
                            {deltaLabel || "Baseline locked"}
                          </Typography>
                          <Stack spacing={0.6} sx={{ mt: 1.0 }}>
                            {(deltaWins?.length ? deltaWins : results.wins || []).slice(0, 4).map((w) => (
                              <Stack key={w.k} direction="row" justifyContent="space-between">
                                <Typography sx={{ color: "rgba(255,255,255,0.78)" }}>{w.k}</Typography>
                                <Typography sx={{ color: "rgba(170,255,210,0.95)", fontWeight: 900 }}>{w.v}</Typography>
                              </Stack>
                            ))}
                          </Stack>
                        </CardContent>
                      </Card>
                    </Stack>

                    <Card
                      sx={{
                        borderRadius: 4,
                        bgcolor: "rgba(0,0,0,0.32)",
                        border: "1px solid rgba(255,255,255,0.10)",
                      }}
                    >
                      <CardContent>
                        <Typography sx={{ fontWeight: 950, color: "rgba(140,255,200,0.95)", textShadow: "0 0 12px rgba(140,255,200,0.16)" }}>Next unlocks</Typography>
                        <Stack spacing={0.6} sx={{ mt: 0.8 }}>
                          {(results.levers || []).map((t) => (
                            <Typography key={t} variant="body2" sx={{ color: "rgba(255,255,255,0.78)" }}>
                              • {t}
                            </Typography>
                          ))}
                        </Stack>
                      </CardContent>
                    </Card>

                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ mt: 0.5 }}>
                      <Button
                        variant="contained"
                        startIcon={<IosShareIcon />}
                        onClick={handleShare}
                        sx={{
                          borderRadius: 999,
                          fontWeight: 950,
                          px: 2.2,
                          background: "linear-gradient(180deg, rgba(70,140,255,1), rgba(50,95,240,1))",
                          boxShadow: "0 12px 34px rgba(35,85,220,0.35)",
                        }}
                      >
                        Share
                      </Button>
                      <Button
                        variant="outlined"
                        onClick={() => {
                          setCaptures([]);
                          setPoseIndex(0);
                          setPhase("capture");
                          window.location.reload();
                        }}
                        sx={{
                          borderRadius: 999,
                          fontWeight: 900,
                          borderColor: "rgba(255,255,255,0.20)",
                          color: "rgba(255,255,255,0.82)",
                        }}
                      >
                        Re‑scan
                      </Button>
                      <Box sx={{ flex: 1 }} />
                      <Button
                        variant="text"
                        onClick={() => history.push("/")}
                        sx={{ color: "rgba(255,255,255,0.72)", textTransform: "none" }}
                      >
                        Back to Daily Eval
                      </Button>
                    </Stack>

                    <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.55)" }}>
                      Creator tip: share weekly to show your arc — “Week over week” wins compound.
                    </Typography>
                  </Stack>
                </CardContent>
              </Card>
            </Stack>
          )}
        </Box>
      </Box>
    </Box>
  );
}
