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
  CircularProgress,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import IosShareIcon from "@mui/icons-material/IosShare";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import FlipCameraAndroidIcon from "@mui/icons-material/FlipCameraAndroid";

import { useAuth } from "./context/AuthProvider";
import { buildPoseSessionSharePng } from "./lib/poseSessionSharePng.js";
import { shareOrDownloadPng } from "./lib/frameCheckSharePng.js";
import {
  readPoseSessionHistory,
  appendPoseSession,
  computeDeltasPositiveOnly,
  localDayISO,
} from "./lib/poseSessionStore.js";

const POSES = [
  { key: "front_double_bi", title: "Double Bi", subtitle: "Elbows up · flex biceps · chin neutral" },
  { key: "lat_spread", title: "Lat Spread", subtitle: "Chest up · spread lats · stay tall" },
  { key: "back_double_bi", title: "Back Double Bi", subtitle: "Turn around · elbows up · spread back" },
];

const CAPTURE_DELAY_MS = 3000; // selfie timer (simple + reliable)

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}

function dataUrlToBlob(dataUrl) {
  const [hdr, b64] = String(dataUrl || "").split(",");
  const m = /data:([^;]+);base64/.exec(hdr || "");
  const mime = m?.[1] || "image/jpeg";
  const bin = atob(b64 || "");
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function makeThumbDataUrl(dataUrl, maxW = 720, quality = 0.72) {
  // Keep it simple: draw into canvas and export JPEG.
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}


function titleCaseKey(k) {
  const s = String(k || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return s.trim();
}

function normalizeMuscleBreakdown(mb) {
  if (!mb) return [];
  if (Array.isArray(mb)) {
    return mb
      .map((r) => ({
        group: r?.group || r?.name || r?.title || "",
        note: r?.note || r?.text || r?.desc || "",
      }))
      .filter((r) => r.group && r.note);
  }
  if (typeof mb === "object") {
    return Object.entries(mb)
      .map(([k, v]) => ({ group: titleCaseKey(k), note: String(v || "").trim() }))
      .filter((r) => r.group && r.note);
  }
  return [];
}

function normalizeRankings(rankings) {
  const best = Array.isArray(rankings?.bestDeveloped) ? rankings.bestDeveloped : [];
  const improve = Array.isArray(rankings?.canImprove) ? rankings.canImprove : [];
  return { best, improve };
}

function renderReportLines(report) {
  if (!report) return [];

  // string
  if (typeof report === "string") {
    const lines = report.split(/\r?\n/).map((l) => l.trimEnd());
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) {
        if (out.length && out[out.length - 1] !== "") out.push("");
        continue;
      }
      out.push(l);
    }
    return out;
  }

  // array of strings/sections
  if (Array.isArray(report)) {
    return renderReportLines(report.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("\n"));
  }

  // object: flatten into readable sections
  if (typeof report === "object") {
    const prettyKey = (k) =>
      String(k || "")
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (m) => m.toUpperCase());

    const out = [];
    const entries = Object.entries(report);

    // try to keep a sensible order if common keys exist
    const order = [
      "summary",
      "bigPicture",
      "big_picture",
      "rankings",
      "muscleRankings",
      "poseByPose",
      "pose_by_pose",
      "recommendations",
      "plan",
      "notes",
    ];
    const keyRank = (k) => {
      const i = order.indexOf(k);
      return i === -1 ? 999 : i;
    };

    entries.sort((a, b) => keyRank(a[0]) - keyRank(b[0]));

    for (const [k, v] of entries) {
      out.push(`${prettyKey(k)}:`);

      if (typeof v === "string") {
        out.push(...renderReportLines(v));
      } else if (Array.isArray(v)) {
        for (const item of v) {
          if (typeof item === "string") out.push(`• ${item}`);
          else out.push(`• ${JSON.stringify(item)}`);
        }
      } else if (v && typeof v === "object") {
        // one level deep
        for (const [k2, v2] of Object.entries(v)) {
          if (typeof v2 === "string") out.push(`• ${prettyKey(k2)}: ${v2}`);
          else out.push(`• ${prettyKey(k2)}: ${JSON.stringify(v2)}`);
        }
      } else {
        out.push(String(v));
      }

      out.push("");
    }

    return out;
  }

  return renderReportLines(String(report));
}

export default function PoseSession() {
  const history = useHistory();
  const { user } = useAuth();

  const userId = user?.id || "anon";

  const [stage, setStage] = useState("intro"); // intro | capture | scanning | results
  const [poseIdx, setPoseIdx] = useState(0);
  const [facingMode, setFacingMode] = useState("user");

  const [countdownMs, setCountdownMs] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [captures, setCaptures] = useState([]); // { poseKey, title, fullDataUrl, thumbDataUrl }
  const [result, setResult] = useState(null);
  const [shareBusy, setShareBusy] = useState(false);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const countdownRef = useRef(null);

  const pose = POSES[poseIdx] || POSES[0];

  const todayISO = useMemo(() => localDayISO(), []);
  const priorHistory = useMemo(() => readPoseSessionHistory(userId) || [], [userId]);
  const deltas = useMemo(() => computeDeltasPositiveOnly(priorHistory), [priorHistory]);

  const stopCamera = useCallback(() => {
    try {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      timerRef.current = null;
      countdownRef.current = null;
      setCountdownMs(0);
      setCameraReady(false);
    } catch {}
    try {
      const s = streamRef.current;
      streamRef.current = null;
      if (s) s.getTracks().forEach((t) => t.stop());
    } catch {}
  }, []);

  const startCamera = useCallback(async () => {
    setErrorMsg("");
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        await v.play();
      }
      setCameraReady(true);
    } catch (e) {
      console.error(e);
      setErrorMsg("Camera unavailable. Please allow camera permissions and retry.");
    }
  }, [facingMode, stopCamera]);

  useEffect(() => {
    if (stage === "capture") startCamera();
    else stopCamera();
    return () => stopCamera();
  }, [stage, startCamera, stopCamera]);

  const takeSnapshot = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return null;
    const w = v.videoWidth || 1280;
    const h = v.videoHeight || 720;

    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.drawImage(v, 0, 0, w, h);

    // Full-res stored locally for share PNG export.
    const fullDataUrl = c.toDataURL("image/jpeg", 0.92);
    const thumbDataUrl = await makeThumbDataUrl(fullDataUrl, 720, 0.72);
    return { fullDataUrl, thumbDataUrl };
  }, []);

  const beginTimedCapture = useCallback(() => {
    if (!cameraReady) return;
    setCountdownMs(CAPTURE_DELAY_MS);

    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setCountdownMs((ms) => Math.max(0, ms - 250));
    }, 250);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = null;
      setCountdownMs(0);

      const snap = await takeSnapshot();
      if (!snap) return;

      setCaptures((prev) => [
        ...prev,
        { poseKey: pose.key, title: pose.title, fullDataUrl: snap.fullDataUrl, thumbDataUrl: snap.thumbDataUrl },
      ]);

      // Advance pose
      if (poseIdx < POSES.length - 1) {
        setPoseIdx((i) => i + 1);
      } else {
        setStage("scanning");
      }
    }, CAPTURE_DELAY_MS);
  }, [cameraReady, pose.key, pose.title, poseIdx, takeSnapshot]);

  // Auto start the timer when camera is ready (no manual actions)
  useEffect(() => {
    if (stage !== "capture") return;
    if (!cameraReady) return;
    beginTimedCapture();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      timerRef.current = null;
      countdownRef.current = null;
    };
  }, [stage, cameraReady, beginTimedCapture, poseIdx]);

  const flipCamera = useCallback(() => {
    setFacingMode((m) => (m === "user" ? "environment" : "user"));
  }, []);

  const retakePose = useCallback(() => {
    // Remove last capture for current pose and re-open capture stage
    setCaptures((prev) => prev.filter((c) => c.poseKey !== pose.key));
    setStage("capture");
  }, [pose.key]);

  const startScan = useCallback(() => {
    setCaptures([]);
    setResult(null);
    setPoseIdx(0);
    setStage("capture");
  }, []);

  const callAI = useCallback(async () => {
    if (captures.length < 3) return;
    setErrorMsg("");

    try {
      const payload = {
        feature: "pose_session",
        style: "detailed_muscle_groups_v1",
        poses: captures.map((c) => ({
          poseKey: c.poseKey,
          title: c.title,
          imageDataUrl: c.thumbDataUrl, // keep payload small
        })),
        deltas, // optional; app uses positive-only deltas
      };

      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      const session = json?.session || null;

      // Persist a small record for deltas
      try {
        appendPoseSession(userId, {
          local_day: todayISO,
          created_at: Date.now(),
          build_arc: clamp(session?.build_arc ?? session?.buildArcScore ?? 78, 0, 100),
          muscleSignals: session?.muscleSignals || {},
          poseQuality: session?.poseQuality || {},
        });
      } catch {}

      setResult(session);
      setStage("results");
    } catch (e) {
      console.error(e);
      setErrorMsg("AI analysis failed. Please try again.");
      setStage("results");
      setResult(null);
    }
  }, [captures, deltas, todayISO, userId]);

  useEffect(() => {
    if (stage !== "scanning") return;
    callAI();
  }, [stage, callAI]);

  const onShare = useCallback(async () => {
    if (!captures.length) return;
    setShareBusy(true);
    try {
      const pngDataUrl = await buildPoseSessionSharePng({
        tier: result?.tier || result?.tierLabel || result?.strength || "Build Arc",
        score: result?.aesthetic_score ?? result?.aestheticScore ?? result?.build_arc ?? 78,
        highlights: result?.highlights || result?.levers || [],
        thumbs: captures.map((c) => ({ title: c.title, dataUrl: c.fullDataUrl })), // full res
      });
      await shareOrDownloadPng(pngDataUrl, "slimcal-build-arc.png");
    } catch (e) {
      console.error(e);
      setErrorMsg("Could not generate share card.");
    } finally {
      setShareBusy(false);
    }
  }, [captures, result]);

  const titleColor = "rgba(245,250,255,0.92)";
  const bodyColor = "rgba(220,235,245,0.86)";

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#0b0f14", display: "flex", justifyContent: "center", p: { xs: 2, md: 4 } }}>
      <Card
        sx={{
          width: "min(980px, 100%)",
          bgcolor: "#0c1218",
          borderRadius: "28px",
          border: "1px solid rgba(120,255,220,0.18)",
          boxShadow: "0 0 24px rgba(0,0,0,0.45)",
          overflow: "hidden",
        }}
      >
        <CardContent sx={{ p: { xs: 2.2, md: 3 } }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
            <Button
              startIcon={<ArrowBackIcon />}
              onClick={() => history.goBack()}
              sx={{ color: bodyColor, textTransform: "none" }}
            >
              Back
            </Button>

            <Stack direction="row" spacing={1} alignItems="center">
              {stage === "capture" && (
                <Button
                  startIcon={<FlipCameraAndroidIcon />}
                  onClick={flipCamera}
                  sx={{
                    color: bodyColor,
                    textTransform: "none",
                    border: "1px solid rgba(255,255,255,0.14)",
                    borderRadius: 999,
                    px: 1.6,
                  }}
                >
                  Flip
                </Button>
              )}
              {stage === "results" && (
                <Button
                  variant="outlined"
                  onClick={startScan}
                  sx={{
                    color: bodyColor,
                    textTransform: "none",
                    borderColor: "rgba(120,255,220,0.35)",
                    borderRadius: 999,
                  }}
                >
                  New Scan
                </Button>
              )}
            </Stack>
          </Stack>

          {errorMsg ? (
            <Box sx={{ mb: 2, p: 1.5, borderRadius: 2, bgcolor: "rgba(255,80,80,0.08)", border: "1px solid rgba(255,80,80,0.18)" }}>
              <Typography sx={{ color: "rgba(255,200,200,0.95)", fontSize: 14 }}>{errorMsg}</Typography>
            </Box>
          ) : null}

          {stage === "intro" && (
            <Stack spacing={2.2}>
              <Typography variant="h4" sx={{ color: titleColor, fontWeight: 800, letterSpacing: 0.2 }}>
                AI Physique Tracker
              </Typography>
              <Typography sx={{ color: bodyColor }}>
                3 poses · 15 seconds · shareable results
              </Typography>

              <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                {POSES.map((p) => (
                  <Box
                    key={p.key}
                    sx={{
                      flex: 1,
                      borderRadius: 3,
                      border: "1px solid rgba(120,255,220,0.18)",
                      bgcolor: "rgba(0,0,0,0.22)",
                      p: 2,
                      textAlign: "center",
                    }}
                  >
                    <Box
                      sx={{
                        height: 120,
                        borderRadius: 3,
                        bgcolor: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        mb: 1.2,
                      }}
                    >
                      <Typography sx={{ color: "rgba(120,255,220,0.7)", fontWeight: 800 }}>
                        {p.title}
                      </Typography>
                    </Box>
                    <Typography sx={{ color: bodyColor, fontSize: 13 }}>{p.subtitle}</Typography>
                  </Box>
                ))}
              </Stack>

              <Stack spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip label="Auto-captures after a short timer" size="small" sx={{ bgcolor: "rgba(120,255,220,0.12)", color: bodyColor, border: "1px solid rgba(120,255,220,0.18)" }} />
                  <Chip label="Private — you control sharing" size="small" sx={{ bgcolor: "rgba(255,255,255,0.06)", color: bodyColor, border: "1px solid rgba(255,255,255,0.10)" }} />
                </Stack>
              </Stack>

              <Button
                variant="contained"
                onClick={startScan}
                startIcon={<CameraAltIcon />}
                sx={{
                  mt: 1,
                  borderRadius: 999,
                  py: 1.4,
                  fontWeight: 800,
                  textTransform: "none",
                  bgcolor: "rgba(40, 220, 190, 0.95)",
                  color: "#061014",
                  boxShadow: "0 10px 28px rgba(40,220,190,0.22)",
                  "&:hover": { bgcolor: "rgba(40, 220, 190, 1)" },
                }}
              >
                Start Scan
              </Button>
              <Typography sx={{ color: "rgba(180,220,230,0.6)", textAlign: "center", fontSize: 12 }}>
                Tip: step back so your full upper body is in frame.
              </Typography>
            </Stack>
          )}

          {stage === "capture" && (
            <Stack spacing={2}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography sx={{ color: titleColor, fontWeight: 800 }}>
                  Pose {poseIdx + 1} of {POSES.length}
                </Typography>
                <Button
                  onClick={retakePose}
                  sx={{ color: bodyColor, textTransform: "none", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 999 }}
                >
                  Retake
                </Button>
              </Stack>

              <Box
                sx={{
                  position: "relative",
                  width: "100%",
                  aspectRatio: "3/4",
                  borderRadius: 4,
                  overflow: "hidden",
                  border: "1px solid rgba(120,255,220,0.16)",
                  bgcolor: "#000",
                }}
              >
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    transform: facingMode === "user" ? "scaleX(-1)" : "none",
                  }}
                />
                {/* Minimal “fancy” prompt overlay (no tracking) */}
                <Box sx={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                  <Box
                    sx={{
                      position: "absolute",
                      left: 14,
                      right: 14,
                      bottom: 14,
                      p: 2,
                      borderRadius: 3,
                      bgcolor: "rgba(0,0,0,0.55)",
                      border: "1px solid rgba(120,255,220,0.20)",
                      backdropFilter: "blur(6px)",
                    }}
                  >
                    <Typography sx={{ color: "rgba(120,255,220,0.95)", fontWeight: 900, letterSpacing: 0.5 }}>
                      {pose.title}
                    </Typography>
                    <Typography sx={{ color: bodyColor, fontSize: 13, mt: 0.5 }}>
                      {pose.subtitle}
                    </Typography>

                    <Divider sx={{ my: 1.2, borderColor: "rgba(255,255,255,0.08)" }} />

                    <Typography sx={{ color: "rgba(245,250,255,0.88)", fontSize: 12 }}>
                      Auto-capturing in{" "}
                      <b style={{ color: "rgba(120,255,220,0.95)" }}>
                        {Math.max(0, Math.ceil(countdownMs / 1000))}
                      </b>{" "}
                      …
                    </Typography>
                  </Box>
                </Box>
              </Box>

              <Box
                sx={{
                  px: 2,
                  py: 1.4,
                  borderRadius: 999,
                  border: "1px solid rgba(120,255,220,0.18)",
                  bgcolor: "rgba(0,0,0,0.22)",
                }}
              >
                <Typography sx={{ color: "rgba(120,255,220,0.9)", fontWeight: 900, textAlign: "center", letterSpacing: 2, fontSize: 12 }}>
                  LOCK-ON
                </Typography>
                <Box sx={{ mt: 1, height: 8, borderRadius: 999, bgcolor: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                  <Box
                    sx={{
                      height: "100%",
                      width: `${clamp(100 - (countdownMs / CAPTURE_DELAY_MS) * 100, 0, 100)}%`,
                      bgcolor: "rgba(120,255,220,0.85)",
                      boxShadow: "0 0 18px rgba(120,255,220,0.25)",
                    }}
                  />
                </Box>
                <Stack direction="row" spacing={1} justifyContent="center" sx={{ mt: 1 }}>
                  <Chip label="Centered" size="small" sx={{ color: bodyColor, bgcolor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }} />
                  <Chip label="Far enough" size="small" sx={{ color: bodyColor, bgcolor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }} />
                  <Chip label="Hold still" size="small" sx={{ color: bodyColor, bgcolor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)" }} />
                </Stack>
              </Box>
            </Stack>
          )}

          {stage === "scanning" && (
            <Stack spacing={2} alignItems="center" sx={{ py: 6 }}>
              <CircularProgress />
              <Typography sx={{ color: titleColor, fontWeight: 800 }}>Scanning poses…</Typography>
              <Typography sx={{ color: bodyColor, textAlign: "center", maxWidth: 520 }}>
                Generating your private physique breakdown.
              </Typography>
            </Stack>
          )}

          {stage === "results" && (
            <Stack spacing={2}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography sx={{ color: "rgba(120,255,220,0.95)", fontWeight: 900 }}>
                  {String(result?.tierLabel || result?.tier || "BASELINE LOCKED").toUpperCase()}
                </Typography>
                <Chip
                  label={`AESTHETIC: ${clamp(result?.aesthetic_score ?? result?.aestheticScore ?? (result?.build_arc ?? 70), 0, 10).toFixed?.(1) || 7}/10`}
                  sx={{ bgcolor: "rgba(120,255,220,0.14)", color: titleColor, border: "1px solid rgba(120,255,220,0.22)" }}
                />
              </Stack>

              <Divider sx={{ borderColor: "rgba(255,255,255,0.08)" }} />

              <Typography sx={{ color: titleColor, fontWeight: 900, letterSpacing: 0.4 }}>
                WHAT’S POPPING
              </Typography>

              <Stack spacing={0.8}>
                {(result?.highlights || result?.levers || []).slice(0, 6).map((t, i) => (
                  <Typography key={i} sx={{ color: bodyColor, lineHeight: 1.35 }}>
                    • {String(t)}
                  </Typography>
                ))}
              </Stack>

              {/* Detailed muscle-by-muscle breakdown */}
              {(() => {
                const rows = normalizeMuscleBreakdown(result?.muscleBreakdown);
                if (!rows.length) return null;
                return (
                  <>
                    <Divider sx={{ borderColor: "rgba(255,255,255,0.08)" }} />
                    <Typography sx={{ color: titleColor, fontWeight: 900, letterSpacing: 0.4 }}>
                      MUSCLE BREAKDOWN
                    </Typography>
                    <Stack spacing={1}>
                      {rows.slice(0, 12).map((row, i) => (
                        <Box
                          key={i}
                          sx={{
                            p: 1.4,
                            borderRadius: 2,
                            bgcolor: "rgba(255,255,255,0.04)",
                            border: "1px solid rgba(255,255,255,0.08)",
                          }}
                        >
                          <Typography sx={{ color: "rgba(120,255,220,0.92)", fontWeight: 900 }}>
                            {row.group}
                          </Typography>
                          <Typography sx={{ color: bodyColor, mt: 0.3 }}>
                            {row.note}
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                  </>
                );
              })()}

              {/* Rankings (best developed + next levers) */}
              {(() => {
                const { best, improve } = normalizeRankings(result?.rankings);
                if (!best.length && !improve.length) return null;
                return (
                  <>
                    <Divider sx={{ borderColor: "rgba(255,255,255,0.08)" }} />
                    <Typography sx={{ color: titleColor, fontWeight: 900, letterSpacing: 0.4 }}>
                      MUSCLE GROUP RANKINGS
                    </Typography>
                    <Stack spacing={1.1}>
                      {best.length ? (
                        <Box
                          sx={{
                            p: 1.4,
                            borderRadius: 2,
                            bgcolor: "rgba(255,255,255,0.04)",
                            border: "1px solid rgba(255,255,255,0.08)",
                          }}
                        >
                          <Typography sx={{ color: "rgba(120,255,220,0.92)", fontWeight: 900 }}>
                            Best Developed
                          </Typography>
                          <Typography sx={{ color: bodyColor, mt: 0.4, whiteSpace: "pre-line" }}>
                            {best.slice(0, 7).map((x, i) => `${i + 1}. ${x}`).join("\n")}
                          </Typography>
                        </Box>
                      ) : null}

                      {improve.length ? (
                        <Box
                          sx={{
                            p: 1.4,
                            borderRadius: 2,
                            bgcolor: "rgba(255,255,255,0.04)",
                            border: "1px solid rgba(255,255,255,0.08)",
                          }}
                        >
                          <Typography sx={{ color: "rgba(120,255,220,0.92)", fontWeight: 900 }}>
                            Next To Improve
                          </Typography>
                          <Typography sx={{ color: bodyColor, mt: 0.4, whiteSpace: "pre-line" }}>
                            {improve.slice(0, 8).map((x, i) => `${i + 1}. ${x}`).join("\n")}
                          </Typography>
                        </Box>
                      ) : null}
                    </Stack>
                  </>
                );
              })()}

              {/* Deep-dive report (ChatGPT-style) */}
              {result?.report ? (
                <>
                  <Divider sx={{ borderColor: "rgba(255,255,255,0.08)" }} />
                  <Typography sx={{ color: titleColor, fontWeight: 900, letterSpacing: 0.4 }}>
                    DEEP DIVE
                  </Typography>

                  <Stack spacing={0.9}>
                    {renderReportLines(result.report).slice(0, 180).map((line, i) => {
                      if (!line) return <Box key={i} sx={{ height: 6 }} />;
                      const isHeader =
                        /^[#*•-]?[\s]*[A-Z0-9].{0,40}:$/.test(line) ||
                        /^[🔥💪📊🎯🚀✅⭐️✨]/.test(line) ||
                        /^\*\*.+\*\*$/.test(line);

                      return (
                        <Typography
                          key={i}
                          sx={{
                            color: isHeader ? titleColor : bodyColor,
                            fontWeight: isHeader ? 900 : 500,
                            letterSpacing: isHeader ? 0.3 : 0,
                            lineHeight: 1.35,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {line.replace(/^[-•*]\s+/, "• ")}
                        </Typography>
                      );
                    })}
                  </Stack>
                </>
              ) : null}

              <Divider sx={{ borderColor: "rgba(255,255,255,0.08)" }} />

              <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="center" justifyContent="space-between">
                <Stack direction="row" spacing={1.2} sx={{ overflowX: "auto", pb: 0.5 }}>
                  {captures.map((c) => (
                    <Box key={c.poseKey} sx={{ minWidth: 140 }}>
                      <Box
                        sx={{
                          width: 140,
                          height: 170,
                          borderRadius: 3,
                          overflow: "hidden",
                          border: "1px solid rgba(255,255,255,0.10)",
                          bgcolor: "rgba(255,255,255,0.04)",
                        }}
                      >
                        <img src={c.fullDataUrl} alt={c.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </Box>
                      <Typography sx={{ color: "rgba(190,220,230,0.75)", fontSize: 12, mt: 0.6, textAlign: "center" }}>
                        {c.title}
                      </Typography>
                    </Box>
                  ))}
                </Stack>

                <Stack direction="row" spacing={1.2}>
                  <Button
                    variant="outlined"
                    onClick={startScan}
                    sx={{
                      color: bodyColor,
                      textTransform: "none",
                      borderColor: "rgba(255,255,255,0.14)",
                      borderRadius: 2.5,
                      px: 2,
                    }}
                  >
                    Retake
                  </Button>
                  <Button
                    variant="contained"
                    onClick={onShare}
                    startIcon={<IosShareIcon />}
                    disabled={shareBusy}
                    sx={{
                      textTransform: "none",
                      borderRadius: 2.5,
                      px: 2.6,
                      bgcolor: "rgba(40, 220, 190, 0.95)",
                      color: "#061014",
                      fontWeight: 900,
                      "&:hover": { bgcolor: "rgba(40, 220, 190, 1)" },
                    }}
                  >
                    {shareBusy ? "Preparing…" : "Share Card"}
                  </Button>
                </Stack>
              </Stack>
            </Stack>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
