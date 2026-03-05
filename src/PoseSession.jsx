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
  const common = {
    fill: "none",
    stroke: "rgba(90, 255, 160, 0.95)",
    strokeWidth: 4,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    vectorEffect: "non-scaling-stroke",
  };

  const glow = {
    fill: "none",
    stroke: "rgba(90, 255, 160, 0.26)",
    strokeWidth: 12,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    vectorEffect: "non-scaling-stroke",
  };

  const outlines = {
    front_double_bi: (
      <>
        <path d="M170 78 C158 78,148 88,148 101 C148 114,158 124,170 124 C182 124,192 114,192 101 C192 88,182 78,170 78 Z" {...glow} />
        <path d="M170 78 C158 78,148 88,148 101 C148 114,158 124,170 124 C182 124,192 114,192 101 C192 88,182 78,170 78 Z" {...common} />

        <path d="M142 125
                 C124 132,110 144,98 160
                 C82 150,66 138,52 118
                 C40 102,42 86,58 82
                 C72 78,82 88,82 100
                 C82 112,76 120,70 126
                 C84 142,102 154,118 164
                 C126 150,136 138,142 125 Z" {...glow} />
        <path d="M142 125
                 C124 132,110 144,98 160
                 C82 150,66 138,52 118
                 C40 102,42 86,58 82
                 C72 78,82 88,82 100
                 C82 112,76 120,70 126
                 C84 142,102 154,118 164
                 C126 150,136 138,142 125 Z" {...common} />

        <path d="M198 125
                 C216 132,230 144,242 160
                 C258 150,274 138,288 118
                 C300 102,298 86,282 82
                 C268 78,258 88,258 100
                 C258 112,264 120,270 126
                 C256 142,238 154,222 164
                 C214 150,204 138,198 125 Z" {...glow} />
        <path d="M198 125
                 C216 132,230 144,242 160
                 C258 150,274 138,288 118
                 C300 102,298 86,282 82
                 C268 78,258 88,258 100
                 C258 112,264 120,270 126
                 C256 142,238 154,222 164
                 C214 150,204 138,198 125 Z" {...common} />

        <path d="M142 124
                 C150 132,158 138,170 140
                 C182 138,190 132,198 124
                 C216 126,228 140,234 164
                 C238 182,238 198,232 220
                 C226 246,214 272,204 304
                 C198 324,198 350,204 376
                 C208 392,204 404,190 406
                 C176 406,168 394,170 380
                 C172 350,170 324,166 302
                 C162 324,160 350,162 380
                 C164 394,156 406,142 406
                 C128 404,124 392,128 376
                 C134 350,134 324,128 304
                 C118 272,106 246,100 220
                 C94 198,94 182,98 164
                 C104 140,116 126,142 124 Z" {...glow} />
        <path d="M142 124
                 C150 132,158 138,170 140
                 C182 138,190 132,198 124
                 C216 126,228 140,234 164
                 C238 182,238 198,232 220
                 C226 246,214 272,204 304
                 C198 324,198 350,204 376
                 C208 392,204 404,190 406
                 C176 406,168 394,170 380
                 C172 350,170 324,166 302
                 C162 324,160 350,162 380
                 C164 394,156 406,142 406
                 C128 404,124 392,128 376
                 C134 350,134 324,128 304
                 C118 272,106 246,100 220
                 C94 198,94 182,98 164
                 C104 140,116 126,142 124 Z" {...common} />

        <path d="M120 184 C136 196,150 202,170 204 C190 202,204 196,220 184" {...glow} />
        <path d="M120 184 C136 196,150 202,170 204 C190 202,204 196,220 184" {...common} />
        <path d="M142 224 C154 232,162 236,170 236 C178 236,186 232,198 224" {...glow} />
        <path d="M142 224 C154 232,162 236,170 236 C178 236,186 232,198 224" {...common} />
      </>
    ),
    lat_spread: (
      <>
        <path d="M170 78 C158 78,148 88,148 101 C148 114,158 124,170 124 C182 124,192 114,192 101 C192 88,182 78,170 78 Z" {...glow} />
        <path d="M170 78 C158 78,148 88,148 101 C148 114,158 124,170 124 C182 124,192 114,192 101 C192 88,182 78,170 78 Z" {...common} />

        <path d="M146 126
                 C118 130,94 144,76 170
                 C62 190,58 212,64 232
                 C72 222,82 214,96 208
                 C104 174,120 146,146 126 Z" {...glow} />
        <path d="M146 126
                 C118 130,94 144,76 170
                 C62 190,58 212,64 232
                 C72 222,82 214,96 208
                 C104 174,120 146,146 126 Z" {...common} />

        <path d="M194 126
                 C222 130,246 144,264 170
                 C278 190,282 212,276 232
                 C268 222,258 214,244 208
                 C236 174,220 146,194 126 Z" {...glow} />
        <path d="M194 126
                 C222 130,246 144,264 170
                 C278 190,282 212,276 232
                 C268 222,258 214,244 208
                 C236 174,220 146,194 126 Z" {...common} />

        <path d="M146 124
                 C154 134,160 140,170 142
                 C180 140,186 134,194 124
                 C228 128,248 150,256 182
                 C262 208,258 236,246 264
                 C236 286,224 304,214 332
                 C206 354,204 374,208 396
                 C210 406,204 414,192 416
                 C180 418,172 410,172 398
                 C172 366,170 334,168 308
                 C166 334,164 366,164 398
                 C164 410,156 418,144 416
                 C132 414,126 406,128 396
                 C132 374,130 354,122 332
                 C112 304,100 286,90 264
                 C78 236,74 208,80 182
                 C88 150,108 128,146 124 Z" {...glow} />
        <path d="M146 124
                 C154 134,160 140,170 142
                 C180 140,186 134,194 124
                 C228 128,248 150,256 182
                 C262 208,258 236,246 264
                 C236 286,224 304,214 332
                 C206 354,204 374,208 396
                 C210 406,204 414,192 416
                 C180 418,172 410,172 398
                 C172 366,170 334,168 308
                 C166 334,164 366,164 398
                 C164 410,156 418,144 416
                 C132 414,126 406,128 396
                 C132 374,130 354,122 332
                 C112 304,100 286,90 264
                 C78 236,74 208,80 182
                 C88 150,108 128,146 124 Z" {...common} />

        <path d="M116 174 C132 190,150 198,170 200 C190 198,208 190,224 174" {...glow} />
        <path d="M116 174 C132 190,150 198,170 200 C190 198,208 190,224 174" {...common} />
        <path d="M142 230 C154 238,162 242,170 242 C178 242,186 238,198 230" {...glow} />
        <path d="M142 230 C154 238,162 242,170 242 C178 242,186 238,198 230" {...common} />
      </>
    ),
    back_double_bi: (
      <>
        <path d="M170 78 C158 78,148 88,148 101 C148 114,158 124,170 124 C182 124,192 114,192 101 C192 88,182 78,170 78 Z" {...glow} />
        <path d="M170 78 C158 78,148 88,148 101 C148 114,158 124,170 124 C182 124,192 114,192 101 C192 88,182 78,170 78 Z" {...common} />

        <path d="M140 124
                 C122 132,108 144,96 160
                 C80 150,64 138,50 118
                 C38 102,40 86,56 82
                 C70 78,80 88,80 100
                 C80 112,74 120,68 126
                 C82 142,100 154,116 164
                 C124 150,134 138,140 124 Z" {...glow} />
        <path d="M140 124
                 C122 132,108 144,96 160
                 C80 150,64 138,50 118
                 C38 102,40 86,56 82
                 C70 78,80 88,80 100
                 C80 112,74 120,68 126
                 C82 142,100 154,116 164
                 C124 150,134 138,140 124 Z" {...common} />

        <path d="M200 124
                 C218 132,232 144,244 160
                 C260 150,276 138,290 118
                 C302 102,300 86,284 82
                 C270 78,260 88,260 100
                 C260 112,266 120,272 126
                 C258 142,240 154,224 164
                 C216 150,206 138,200 124 Z" {...glow} />
        <path d="M200 124
                 C218 132,232 144,244 160
                 C260 150,276 138,290 118
                 C302 102,300 86,284 82
                 C270 78,260 88,260 100
                 C260 112,266 120,272 126
                 C258 142,240 154,224 164
                 C216 150,206 138,200 124 Z" {...common} />

        <path d="M140 124
                 C148 136,158 146,170 150
                 C182 146,192 136,200 124
                 C220 126,232 140,240 164
                 C248 190,248 220,240 248
                 C232 278,220 302,210 332
                 C202 356,202 378,206 398
                 C208 408,202 416,190 418
                 C178 420,170 412,170 400
                 C170 370,168 336,166 308
                 C164 336,162 370,162 400
                 C162 412,154 420,142 418
                 C130 416,124 408,126 398
                 C130 378,130 356,122 332
                 C112 302,100 278,92 248
                 C84 220,84 190,92 164
                 C100 140,112 126,140 124 Z" {...glow} />
        <path d="M140 124
                 C148 136,158 146,170 150
                 C182 146,192 136,200 124
                 C220 126,232 140,240 164
                 C248 190,248 220,240 248
                 C232 278,220 302,210 332
                 C202 356,202 378,206 398
                 C208 408,202 416,190 418
                 C178 420,170 412,170 400
                 C170 370,168 336,166 308
                 C164 336,162 370,162 400
                 C162 412,154 420,142 418
                 C130 416,124 408,126 398
                 C130 378,130 356,122 332
                 C112 302,100 278,92 248
                 C84 220,84 190,92 164
                 C100 140,112 126,140 124 Z" {...common} />

        <path d="M122 176 C134 188,148 198,170 204 C192 198,206 188,218 176" {...glow} />
        <path d="M122 176 C134 188,148 198,170 204 C192 198,206 188,218 176" {...common} />
        <path d="M142 228 C154 236,162 240,170 240 C178 240,186 236,198 228" {...glow} />
        <path d="M142 228 C154 236,162 240,170 240 C178 240,186 236,198 228" {...common} />
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
          width: "min(86%, 420px)",
          maxWidth: "86%",
          aspectRatio: "3 / 4",
          borderRadius: "32px",
          border: "1px solid rgba(90,255,160,0.22)",
          bgcolor: "rgba(5, 20, 12, 0.08)",
          boxShadow: active ? "0 0 40px rgba(90,255,160,0.16), inset 0 0 32px rgba(90,255,160,0.06)" : "none",
          transform: mirrored ? "scaleX(-1)" : "none",
          animation: active ? "matrixPulse 1.1s ease-in-out infinite" : "none",
        }}
      >
        <svg viewBox="0 0 340 480" width="100%" height="100%" aria-hidden="true">
          <defs>
            <filter id="poseGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="5" result="blur" />
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
