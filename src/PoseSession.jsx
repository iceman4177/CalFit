// src/PoseSession.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useHistory } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import IosShareIcon from "@mui/icons-material/IosShare";
import CameraAltIcon from "@mui/icons-material/CameraAlt";

import { buildPoseSessionSharePng } from "./lib/poseSessionSharePng.js";
import { shareOrDownloadPng } from "./lib/frameCheckSharePng.js";

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

function PoseGhost({ pose, size = 260 }) {
  // Simple SVG “outline” that shifts arm positions per pose.
  const stroke = "rgba(120,255,180,0.55)";
  const glow = "rgba(120,255,180,0.18)";
  const isFront = pose !== "back_double_bi";

  const arms =
    pose === "front_relaxed"
      ? { l1: [95, 120], l2: [80, 170], r1: [165, 120], r2: [180, 170] }
      : { l1: [92, 88], l2: [70, 120], r1: [168, 88], r2: [190, 120] };

  const backFlare = pose === "back_double_bi" ? 26 : 16;

  return (
    <Box sx={{ width: size, height: size, position: "relative" }}>
      <svg width={size} height={size} viewBox="0 0 260 260">
        <defs>
          <filter id="g">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* glow */}
        <g filter="url(#g)" stroke={glow} strokeWidth="10" fill="none" strokeLinecap="round">
          <path d={`M130 48 C 122 48 118 54 118 62 C 118 72 124 80 130 80 C 136 80 142 72 142 62 C 142 54 138 48 130 48 Z`} />
          <path d={`M130 86 C ${112 - backFlare} 92, ${105 - backFlare} 115, 106 132 C 108 152, 118 176, 130 188 C 142 176, 152 152, 154 132 C ${155 + backFlare} 115, ${148 + backFlare} 92, 130 86 Z`} />
          <path d={`M130 188 C 118 198, 114 214, 112 236`} />
          <path d={`M130 188 C 142 198, 146 214, 148 236`} />
          <path d={`M130 102 L ${arms.l1[0]} ${arms.l1[1]} L ${arms.l2[0]} ${arms.l2[1]}`} />
          <path d={`M130 102 L ${arms.r1[0]} ${arms.r1[1]} L ${arms.r2[0]} ${arms.r2[1]}`} />
        </g>

        {/* outline */}
        <g stroke={stroke} strokeWidth="2.4" fill="none" strokeLinecap="round">
          <path d={`M130 48 C 122 48 118 54 118 62 C 118 72 124 80 130 80 C 136 80 142 72 142 62 C 142 54 138 48 130 48 Z`} />
          <path d={`M130 86 C ${112 - backFlare} 92, ${105 - backFlare} 115, 106 132 C 108 152, 118 176, 130 188 C 142 176, 152 152, 154 132 C ${155 + backFlare} 115, ${148 + backFlare} 92, 130 86 Z`} />
          <path d={`M130 188 C 118 198, 114 214, 112 236`} />
          <path d={`M130 188 C 142 198, 146 214, 148 236`} />
          <path d={`M130 102 L ${arms.l1[0]} ${arms.l1[1]} L ${arms.l2[0]} ${arms.l2[1]}`} />
          <path d={`M130 102 L ${arms.r1[0]} ${arms.r1[1]} L ${arms.r2[0]} ${arms.r2[1]}`} />
        </g>

        {/* center crosshair */}
        <g stroke="rgba(120,255,180,0.85)" strokeWidth="2">
          <circle cx="130" cy="146" r="8" fill="rgba(120,255,180,0.12)" />
          <line x1="130" y1="132" x2="130" y2="160" />
          <line x1="116" y1="146" x2="144" y2="146" />
        </g>

        {/* label */}
        <text
          x="130"
          y="252"
          textAnchor="middle"
          fill="rgba(255,255,255,0.55)"
          fontSize="12"
          fontFamily="system-ui, -apple-system, Segoe UI, Roboto"
        >
          {isFront ? "ALIGN OUTLINE" : "ALIGN (BACK VIEW)"}
        </text>
      </svg>
    </Box>
  );
}

function estimateResultsFromCaptures(captures) {
  // Placeholder “signals” until we wire AI. Always neutral/positive.
  // Use capture count and a tiny random jitter to make it feel alive.
  const seed = captures?.length ? captures.length : 1;
  const arc = clamp(72 + seed * 2 + Math.round(Math.random() * 6), 60, 92);
  const pct = clamp(30 - Math.round((arc - 60) * 0.5), 5, 45); // “Top X%”
  const strengths = ["Consistency", "Momentum", "Symmetry", "Discipline", "Drive"];
  const strength = strengths[Math.floor(Math.random() * strengths.length)];

  const muscleWins = [
    { k: "Delts", v: "+2% visual pop" },
    { k: "Arms", v: "+3% fullness" },
    { k: "Lats", v: "+2% width signal" },
    { k: "Chest", v: "+2% upper line" },
  ];

  return {
    build_arc: arc,
    percentile: pct,
    strength,
    horizon_days: 90,
    wins: muscleWins,
    levers: ["Add +25g protein today", "Strength train 2–3×/week", "Re-scan weekly in similar lighting"],
  };
}

export default function PoseSession() {
  const history = useHistory();
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

  const pose = POSES[poseIndex];

  const results = useMemo(() => estimateResultsFromCaptures(captures), [captures]);

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

    start();

    return () => {
      isMounted = false;
      stopStream();
    };
  }, [stopStream]);

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

  // “Auto scan”: when ready + autoEnabled, run a quick “hold still” countdown.
  useEffect(() => {
    if (phase !== "capture") return;
    if (!ready || !autoEnabled) return;
    if (scanning) return;

    let t1;
    let t2;
    setScanning(true);
    setCountdown(3);

    t1 = setInterval(() => {
      setCountdown((c) => {
        const next = c - 1;
        return next;
      });
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

  const handleShare = useCallback(async () => {
    try {
      const blob = await buildPoseSessionSharePng({
        build_arc: results.build_arc,
        percentile: results.percentile,
        strength: results.strength,
        horizon_days: results.horizon_days,
        wins: results.wins,
        pose_count: captures.length,
      });

      const caption = `Pose Session ✅ Build Arc ${results.build_arc}/100 • Top ${results.percentile}% • #SlimcalAI`;
      await shareOrDownloadPng(blob, "slimcal-pose-session.png", caption);
    } catch (e) {
      // no-op
    }
  }, [captures.length, results]);

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
            label={phase === "capture" ? `Pose ${poseIndex + 1}/${POSES.length}` : "Results"}
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
            <Card sx={{ bgcolor: "rgba(255,255,255,0.06)", borderRadius: 4, border: "1px solid rgba(255,255,255,0.10)" }}>
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
                    background: "radial-gradient(1200px 600px at 50% 0%, rgba(120,255,180,0.10), rgba(0,0,0,0))",
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
                    <PoseGhost pose={pose.ghost} />
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

              <Card sx={{ borderRadius: 4, bgcolor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}>
                <CardContent>
                  <Typography sx={{ fontWeight: 900 }}>Captured</Typography>
                  <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.70)", mt: 0.4 }}>
                    {captures.length === 0 ? "No poses captured yet." : `Nice — ${captures.length} pose${captures.length === 1 ? "" : "s"} locked.`}
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
                    <Typography variant="h5" sx={{ fontWeight: 950, letterSpacing: 0.2 }}>
                      Scan Results
                    </Typography>
                    <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.72)" }}>
                      Here are your physique signals from this pose session. Always neutral or positive.
                    </Typography>

                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} sx={{ mt: 1 }}>
                      <Card sx={{ flex: 1, borderRadius: 4, bgcolor: "rgba(0,0,0,0.32)", border: "1px solid rgba(255,255,255,0.10)" }}>
                        <CardContent>
                          <Typography sx={{ fontWeight: 900, color: "rgba(170,255,210,0.95)" }}>BUILD ARC</Typography>
                          <Typography sx={{ fontSize: 40, fontWeight: 950, lineHeight: 1.0 }}>
                            {results.build_arc}/100
                          </Typography>
                          <Typography sx={{ color: "rgba(255,255,255,0.75)", mt: 0.4 }}>
                            Top {results.percentile}% • Strength: {results.strength}
                          </Typography>
                          <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.55)" }}>
                            {results.horizon_days}-Day upgrade horizon
                          </Typography>
                        </CardContent>
                      </Card>

                      <Card sx={{ flex: 1, borderRadius: 4, bgcolor: "rgba(0,0,0,0.32)", border: "1px solid rgba(255,255,255,0.10)" }}>
                        <CardContent>
                          <Typography sx={{ fontWeight: 900 }}>Highlights</Typography>
                          <Stack spacing={0.6} sx={{ mt: 0.8 }}>
                            {results.wins.map((w) => (
                              <Stack key={w.k} direction="row" justifyContent="space-between">
                                <Typography sx={{ color: "rgba(255,255,255,0.78)" }}>{w.k}</Typography>
                                <Typography sx={{ color: "rgba(170,255,210,0.95)", fontWeight: 900 }}>{w.v}</Typography>
                              </Stack>
                            ))}
                          </Stack>
                        </CardContent>
                      </Card>
                    </Stack>

                    <Card sx={{ borderRadius: 4, bgcolor: "rgba(0,0,0,0.32)", border: "1px solid rgba(255,255,255,0.10)" }}>
                      <CardContent>
                        <Typography sx={{ fontWeight: 900 }}>Upgrade levers</Typography>
                        <Stack spacing={0.6} sx={{ mt: 0.8 }}>
                          {results.levers.map((t) => (
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
                          // restart
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
