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

const CAPTURE_DELAY_MS = 5000; // selfie timer (simple + reliable)


const OUTLINE_PULSE_MS = 3000;

function PoseGhostOverlay({ poseKey, mirrored = false, active = false }) {
  const line = {
    fill: "none",
    stroke: "rgba(90, 255, 160, 0.98)",
    strokeWidth: 4.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    vectorEffect: "non-scaling-stroke",
  };

  const glow = {
    fill: "none",
    stroke: "rgba(90, 255, 160, 0.22)",
    strokeWidth: 14,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    vectorEffect: "non-scaling-stroke",
  };

  const chestLine = {
    fill: "none",
    stroke: "rgba(90, 255, 160, 0.82)",
    strokeWidth: 3,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    vectorEffect: "non-scaling-stroke",
  };

  const outlines = {
    front_double_bi: (
      <>
        <path d="M180 52 C166 52,154 64,154 79 C154 95,166 107,180 107 C194 107,206 95,206 79 C206 64,194 52,180 52 Z" {...glow} />
        <path d="M180 52 C166 52,154 64,154 79 C154 95,166 107,180 107 C194 107,206 95,206 79 C206 64,194 52,180 52 Z" {...line} />

        <path d="M150 110 C136 114,124 122,114 132 C100 118,84 106,68 96 C54 88,46 92,44 104 C42 116,48 126,58 132 C72 140,86 146,102 150 C118 146,132 130,150 110 Z" {...glow} />
        <path d="M150 110 C136 114,124 122,114 132 C100 118,84 106,68 96 C54 88,46 92,44 104 C42 116,48 126,58 132 C72 140,86 146,102 150 C118 146,132 130,150 110 Z" {...line} />

        <path d="M210 110 C224 114,236 122,246 132 C260 118,276 106,292 96 C306 88,314 92,316 104 C318 116,312 126,302 132 C288 140,274 146,258 150 C242 146,228 130,210 110 Z" {...glow} />
        <path d="M210 110 C224 114,236 122,246 132 C260 118,276 106,292 96 C306 88,314 92,316 104 C318 116,312 126,302 132 C288 140,274 146,258 150 C242 146,228 130,210 110 Z" {...line} />

        <path d="M120 148 C134 126,154 114,180 112 C206 114,226 126,240 148 C250 164,256 186,256 212 C256 240,248 268,234 296" {...glow} />
        <path d="M120 148 C134 126,154 114,180 112 C206 114,226 126,240 148 C250 164,256 186,256 212 C256 240,248 268,234 296" {...line} />
        <path d="M240 148 C226 126,206 114,180 112 C154 114,134 126,120 148 C110 164,104 186,104 212 C104 240,112 268,126 296" {...glow} />
        <path d="M240 148 C226 126,206 114,180 112 C154 114,134 126,120 148 C110 164,104 186,104 212 C104 240,112 268,126 296" {...line} />

        <path d="M128 162 C142 176,158 184,180 186 C202 184,218 176,232 162" {...glow} />
        <path d="M128 162 C142 176,158 184,180 186 C202 184,218 176,232 162" {...chestLine} />
        <path d="M144 208 C156 216,166 220,180 220 C194 220,204 216,216 208" {...glow} />
        <path d="M144 208 C156 216,166 220,180 220 C194 220,204 216,216 208" {...chestLine} />

        <path d="M126 296 C138 320,150 340,160 372" {...glow} />
        <path d="M126 296 C138 320,150 340,160 372" {...line} />
        <path d="M234 296 C222 320,210 340,200 372" {...glow} />
        <path d="M234 296 C222 320,210 340,200 372" {...line} />
      </>
    ),
    lat_spread: (
      <>
        <path d="M180 50 C166 50,154 62,154 77 C154 93,166 105,180 105 C194 105,206 93,206 77 C206 62,194 50,180 50 Z" {...glow} />
        <path d="M180 50 C166 50,154 62,154 77 C154 93,166 105,180 105 C194 105,206 93,206 77 C206 62,194 50,180 50 Z" {...line} />

        <path d="M106 134 C82 148,66 168,60 194 C54 218,56 236,66 252 C84 228,100 212,122 202 C126 174,122 152,106 134 Z" {...glow} />
        <path d="M106 134 C82 148,66 168,60 194 C54 218,56 236,66 252 C84 228,100 212,122 202 C126 174,122 152,106 134 Z" {...line} />

        <path d="M254 134 C278 148,294 168,300 194 C306 218,304 236,294 252 C276 228,260 212,238 202 C234 174,238 152,254 134 Z" {...glow} />
        <path d="M254 134 C278 148,294 168,300 194 C306 218,304 236,294 252 C276 228,260 212,238 202 C234 174,238 152,254 134 Z" {...line} />

        <path d="M118 128 C134 114,154 108,180 108 C206 108,226 114,242 128 C258 142,268 162,272 190 C274 210,270 236,260 268 C248 304,232 336,218 372" {...glow} />
        <path d="M118 128 C134 114,154 108,180 108 C206 108,226 114,242 128 C258 142,268 162,272 190 C274 210,270 236,260 268 C248 304,232 336,218 372" {...line} />
        <path d="M242 128 C226 114,206 108,180 108 C154 108,134 114,118 128 C102 142,92 162,88 190 C86 210,90 236,100 268 C112 304,128 336,142 372" {...glow} />
        <path d="M242 128 C226 114,206 108,180 108 C154 108,134 114,118 128 C102 142,92 162,88 190 C86 210,90 236,100 268 C112 304,128 336,142 372" {...line} />

        <path d="M126 164 C146 182,164 188,180 188 C196 188,214 182,234 164" {...glow} />
        <path d="M126 164 C146 182,164 188,180 188 C196 188,214 182,234 164" {...chestLine} />
        <path d="M142 216 C154 224,166 228,180 228 C194 228,206 224,218 216" {...glow} />
        <path d="M142 216 C154 224,166 228,180 228 C194 228,206 224,218 216" {...chestLine} />
      </>
    ),
    back_double_bi: (
      <>
        <path d="M180 50 C166 50,154 62,154 77 C154 93,166 105,180 105 C194 105,206 93,206 77 C206 62,194 50,180 50 Z" {...glow} />
        <path d="M180 50 C166 50,154 62,154 77 C154 93,166 105,180 105 C194 105,206 93,206 77 C206 62,194 50,180 50 Z" {...line} />

        <path d="M148 108 C132 114,120 124,110 138 C94 126,78 114,62 102 C48 94,40 98,38 110 C36 122,42 132,52 138 C66 146,80 152,96 158 C110 152,126 136,148 108 Z" {...glow} />
        <path d="M148 108 C132 114,120 124,110 138 C94 126,78 114,62 102 C48 94,40 98,38 110 C36 122,42 132,52 138 C66 146,80 152,96 158 C110 152,126 136,148 108 Z" {...line} />

        <path d="M212 108 C228 114,240 124,250 138 C266 126,282 114,298 102 C312 94,320 98,322 110 C324 122,318 132,308 138 C294 146,280 152,264 158 C250 152,234 136,212 108 Z" {...glow} />
        <path d="M212 108 C228 114,240 124,250 138 C266 126,282 114,298 102 C312 94,320 98,322 110 C324 122,318 132,308 138 C294 146,280 152,264 158 C250 152,234 136,212 108 Z" {...line} />

        <path d="M126 132 C142 118,160 112,180 112 C200 112,218 118,234 132 C248 146,258 166,260 194 C262 220,256 250,244 286 C234 318,222 348,212 374" {...glow} />
        <path d="M126 132 C142 118,160 112,180 112 C200 112,218 118,234 132 C248 146,258 166,260 194 C262 220,256 250,244 286 C234 318,222 348,212 374" {...line} />
        <path d="M234 132 C218 118,200 112,180 112 C160 112,142 118,126 132 C112 146,102 166,100 194 C98 220,104 250,116 286 C126 318,138 348,148 374" {...glow} />
        <path d="M234 132 C218 118,200 112,180 112 C160 112,142 118,126 132 C112 146,102 166,100 194 C98 220,104 250,116 286 C126 318,138 348,148 374" {...line} />

        <path d="M128 170 C144 188,160 198,180 202 C200 198,216 188,232 170" {...glow} />
        <path d="M128 170 C144 188,160 198,180 202 C200 198,216 188,232 170" {...chestLine} />
        <path d="M146 222 C158 232,168 236,180 236 C192 236,202 232,214 222" {...glow} />
        <path d="M146 222 C158 232,168 236,180 236 C192 236,202 232,214 222" {...chestLine} />
      </>
    ),
  };

  return (
    <Box
      sx={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        opacity: active ? 1 : 0,
        transition: "opacity 220ms ease",
      }}
    >
      <Box
        sx={{
          width: "min(94%, 560px)",
          maxWidth: "94%",
          height: "88%",
          maxHeight: "88%",
          borderRadius: "28px",
          transform: mirrored ? "scaleX(-1)" : "none",
          animation: active ? "matrixPulse 1.1s ease-in-out infinite" : "none",
          filter: active ? "drop-shadow(0 0 16px rgba(90,255,160,0.26))" : "none",
        }}
      >
        <svg viewBox="0 0 360 420" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <defs>
            <filter id="poseGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g filter="url(#poseGlow)">{outlines[poseKey] || outlines.front_double_bi}</g>
        </svg>
      </Box>
    </Box>
  );
}

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
      const shareSummary = (() => {
        const r = typeof result?.report === "string" ? result.report.trim() : "";
        if (!r) return "";
        // take first paragraph, keep it punchy for social sharing
        const first = r.split(/\n\s*\n/)[0] || r;
        return first.replace(/\s+/g, " ").trim().slice(0, 220);
      })();

      const pngDataUrl = await buildPoseSessionSharePng({
        tier: result?.tier || result?.tierLabel || result?.strength || "Build Arc",
        score: result?.aesthetic_score ?? result?.aestheticScore ?? result?.build_arc ?? 7.8,
        wins: (result?.highlights || result?.levers || []).slice(0, 4),
        levers: (result?.biggestOpportunity || result?.poseNotes || []).slice(0, 3).map((t) => String(t)),
        summary: shareSummary,
        hashtag: "#SlimCalAI",
        thumbs: captures.map((c) => ({ title: c.title, dataUrl: c.fullDataUrl })), // full res for export
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
  const outlinePulseActive = stage === "capture" && countdownMs > CAPTURE_DELAY_MS - OUTLINE_PULSE_MS;

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

          <Box
            sx={{
              "@keyframes matrixPulse": {
                "0%": { opacity: 0.45, transform: "scale(0.985)" },
                "50%": { opacity: 1, transform: "scale(1)" },
                "100%": { opacity: 0.5, transform: "scale(0.99)" },
              },
            }}
          />

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
                {/* Temporary matrix pose silhouette (no tracking) */}
                <PoseGhostOverlay
                  poseKey={pose.key}
                  mirrored={facingMode === "user"}
                  active={outlinePulseActive}
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
                      {outlinePulseActive ? `Match this outline for a second, then lock in. ${pose.subtitle}` : pose.subtitle}
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

              
              {/* Long-form detailed report */}
              {typeof result?.report === "string" && result.report.trim() ? (
                <>
                  <Divider sx={{ borderColor: "rgba(255,255,255,0.08)" }} />
                  <Typography sx={{ color: titleColor, fontWeight: 900, letterSpacing: 0.4 }}>
                    DETAILED PHYSIQUE REPORT
                  </Typography>
                  <Stack spacing={1}>
                    {String(result.report)
                      .split(/\n\s*\n/)
                      .map((p) => p.trim())
                      .filter(Boolean)
                      .slice(0, 12)
                      .map((p, i) => (
                        <Typography key={i} sx={{ color: bodyColor, lineHeight: 1.5 }}>
                          {p}
                        </Typography>
                      ))}
                  </Stack>

                  {(Array.isArray(result?.bestDeveloped) && result.bestDeveloped.length) ||
                  (Array.isArray(result?.biggestOpportunity) && result.biggestOpportunity.length) ||
                  (Array.isArray(result?.poseNotes) && result.poseNotes.length) ? (
                    <Box sx={{ mt: 1 }}>
                      {Array.isArray(result?.bestDeveloped) && result.bestDeveloped.length ? (
                        <Box sx={{ mb: 1 }}>
                          <Typography sx={{ color: "rgba(120,255,220,0.92)", fontWeight: 900 }}>
                            Best Developed
                          </Typography>
                          <Stack spacing={0.6}>
                            {result.bestDeveloped.slice(0, 4).map((t, i) => (
                              <Typography key={i} sx={{ color: bodyColor, lineHeight: 1.35 }}>
                                • {String(t)}
                              </Typography>
                            ))}
                          </Stack>
                        </Box>
                      ) : null}

                      {Array.isArray(result?.biggestOpportunity) && result.biggestOpportunity.length ? (
                        <Box sx={{ mb: 1 }}>
                          <Typography sx={{ color: "rgba(255,210,120,0.92)", fontWeight: 900 }}>
                            Biggest Opportunity
                          </Typography>
                          <Stack spacing={0.6}>
                            {result.biggestOpportunity.slice(0, 4).map((t, i) => (
                              <Typography key={i} sx={{ color: bodyColor, lineHeight: 1.35 }}>
                                • {String(t)}
                              </Typography>
                            ))}
                          </Stack>
                        </Box>
                      ) : null}

                      {Array.isArray(result?.poseNotes) && result.poseNotes.length ? (
                        <Box>
                          <Typography sx={{ color: "rgba(160,180,255,0.92)", fontWeight: 900 }}>
                            Pose Notes
                          </Typography>
                          <Stack spacing={0.6}>
                            {result.poseNotes.slice(0, 4).map((t, i) => (
                              <Typography key={i} sx={{ color: bodyColor, lineHeight: 1.35 }}>
                                • {String(t)}
                              </Typography>
                            ))}
                          </Stack>
                        </Box>
                      ) : null}
                    </Box>
                  ) : null}
                </>
              ) : null}

{/* Detailed muscle-by-muscle breakdown */}
              {Array.isArray(result?.muscleBreakdown) && result.muscleBreakdown.length ? (
                <>
                  <Divider sx={{ borderColor: "rgba(255,255,255,0.08)" }} />
                  <Typography sx={{ color: titleColor, fontWeight: 900, letterSpacing: 0.4 }}>
                    MUSCLE BREAKDOWN
                  </Typography>
                  <Stack spacing={1}>
                    {result.muscleBreakdown.slice(0, 10).map((row, i) => (
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
