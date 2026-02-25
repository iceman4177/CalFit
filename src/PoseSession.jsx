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

async function scorePoseSessionWithAI({ poses, prevSession, todayISO }) {
  try {
    const clientKey = "slimcal_client_id";
    let clientId = "";
    if (typeof window !== "undefined") {
      clientId =
        window.localStorage.getItem(clientKey) ||
        window.localStorage.getItem("client_id") ||
        "";
      if (!clientId) {
        clientId = uid();
        window.localStorage.setItem(clientKey, clientId);
      }
    }

    const res = await fetch("/api/ai/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(clientId ? { "x-client-id": clientId } : {}),
      },
      body: JSON.stringify({
        feature: "pose_session",
        poses,
        prev_muscle_signals: prevSession?.muscleSignals || prevSession?.signals || null,
        local_day: todayISO,
      }),
    });

    if (!res.ok) return null;
    const json = await res.json();
    if (!json || typeof json !== "object") return null;
    return json.session || null;
  } catch {
    return null;
  }
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
          <path
            d={`M130 86 C ${112 - backFlare} 92, ${105 - backFlare} 115, 106 132 C 108 152, 118 176, 130 188 C 142 176, 152 152, 154 132 C ${155 + backFlare} 115, ${148 + backFlare} 92, 130 86 Z`}
          />
          <path d={`M130 188 C 118 198, 114 214, 112 236`} />
          <path d={`M130 188 C 142 198, 146 214, 148 236`} />
          <path d={`M130 102 L ${arms.l1[0]} ${arms.l1[1]} L ${arms.l2[0]} ${arms.l2[1]}`} />
          <path d={`M130 102 L ${arms.r1[0]} ${arms.r1[1]} L ${arms.r2[0]} ${arms.r2[1]}`} />
        </g>

        {/* outline */}
        <g stroke={stroke} strokeWidth="2.4" fill="none" strokeLinecap="round">
          <path d={`M130 48 C 122 48 118 54 118 62 C 118 72 124 80 130 80 C 136 80 142 72 142 62 C 142 54 138 48 130 48 Z`} />
          <path
            d={`M130 86 C ${112 - backFlare} 92, ${105 - backFlare} 115, 106 132 C 108 152, 118 176, 130 188 C 142 176, 152 152, 154 132 C ${155 + backFlare} 115, ${148 + backFlare} 92, 130 86 Z`}
          />
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

async function analyzeImageDataUrl(dataUrl, sampleSize = 96) {
  // Lightweight, zero-dependency "pose quality" signals from the image itself.
  // Not medical. Used only for consistent progress tracking + deltas.
  return await new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = sampleSize;
        canvas.height = sampleSize;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
        const { data } = ctx.getImageData(0, 0, sampleSize, sampleSize);

        // Luminance mean + variance
        let sum = 0;
        let sumSq = 0;
        const lum = new Float32Array(sampleSize * sampleSize);
        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          lum[p] = y;
          sum += y;
          sumSq += y * y;
        }
        const n = sampleSize * sampleSize;
        const mean = sum / n;
        const variance = Math.max(0, sumSq / n - mean * mean);

        // Very cheap edge signal (gradient magnitude)
        let edgeSum = 0;
        for (let y = 1; y < sampleSize - 1; y++) {
          for (let x = 1; x < sampleSize - 1; x++) {
            const idx = y * sampleSize + x;
            const gx = lum[idx + 1] - lum[idx - 1];
            const gy = lum[idx + sampleSize] - lum[idx - sampleSize];
            edgeSum += Math.abs(gx) + Math.abs(gy);
          }
        }
        const edge = edgeSum / ((sampleSize - 2) * (sampleSize - 2));

        // Normalize into 0..1-ish
        const meanN = clamp(mean / 255, 0, 1);
        const varN = clamp(variance / (255 * 255), 0, 1);
        const edgeN = clamp(edge / 40, 0, 1); // tuned for typical phone images

        resolve({ mean: meanN, variance: varN, edge: edgeN });
      } catch {
        resolve({ mean: 0.5, variance: 0.2, edge: 0.2 });
      }
    };
    img.onerror = () => resolve({ mean: 0.5, variance: 0.2, edge: 0.2 });
    img.src = dataUrl;
  });
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
  const autoCanvasRef = useRef(null);
  const autoPrevRef = useRef(null); // Float32Array luminance
  const autoStableCountRef = useRef(0);
  const autoLastTickRef = useRef(0);

  const [phase, setPhase] = useState("capture"); // capture | results
  const [poseIndex, setPoseIndex] = useState(0);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(true);
  const [countdown, setCountdown] = useState(0);
  const [scanning, setScanning] = useState(false);

  // Auto-capture signals (best-effort; never blocks manual capture)
  const [autoStatus, setAutoStatus] = useState({
    match: false,
    stable: false,
    motion: 999,
    center: 0,
    height: 0,
    hint: "Align to the outline",
  });

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

  function _sampleVideoLuma(videoEl, size = 72) {
  try {
    const v = videoEl;
    if (!v || !v.videoWidth || !v.videoHeight) return null;

    if (!autoCanvasRef.current) autoCanvasRef.current = document.createElement("canvas");
    const c = autoCanvasRef.current;
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    const lum = new Float32Array(size * size);
    let sum = 0;
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum[p] = y;
      sum += y;
    }
    const mean = sum / (size * size);

    const thr = mean + 18;

    let energy = 0;
    let cx = 0;
    let cy = 0;
    let top = 0;
    let mid = 0;
    let bot = 0;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const p = y * size + x;
        const val = lum[p];
        const m = val > thr ? (val - thr) : 0;
        if (m <= 0) continue;

        energy += m;
        cx += x * m;
        cy += y * m;

        if (y < size * 0.22) top += m;
        else if (y > size * 0.78) bot += m;
        else mid += m;
      }
    }

    const centroid = energy > 0 ? { x: cx / energy, y: cy / energy } : { x: size / 2, y: size / 2 };

    const prev = autoPrevRef.current;
    let motion = 999;
    if (prev && prev.length === lum.length) {
      let diff = 0;
      for (let i = 0; i < lum.length; i++) diff += Math.abs(lum[i] - prev[i]);
      motion = diff / lum.length;
    }
    autoPrevRef.current = lum;

    const dx = Math.abs(centroid.x - size / 2) / (size / 2);
    const dy = Math.abs(centroid.y - size / 2) / (size / 2);
    const center = clamp(1 - (dx * 0.9 + dy * 0.9), 0, 1);

    const height = energy > 0 ? clamp((top / energy) * 1.7 + (bot / energy) * 1.7 + (mid / energy) * 0.6, 0, 1) : 0;

    return { motion, center, height, energy, size };
  } catch {
    return null;
  }
}

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

// Auto-capture: best-effort "match outline → hold still → auto snap"
// - Uses lightweight frame sampling (no heavy CV).
// - Never blocks manual capture.
useEffect(() => {
  if (phase !== "capture") return;
  if (!ready || !autoEnabled) {
    setAutoStatus((st) => ({ ...st, match: false, stable: false, hint: "Align to the outline" }));
    autoStableCountRef.current = 0;
    return;
  }
  if (countdown > 0) return;

  const v = videoRef.current;
  if (!v) return;

  let alive = true;

  const tick = () => {
    if (!alive) return;

    // throttle ~6fps
    const now = Date.now();
    if (now - (autoLastTickRef.current || 0) < 160) {
      requestAnimationFrame(tick);
      return;
    }
    autoLastTickRef.current = now;

    const metrics = _sampleVideoLuma(v, 72);
    if (!metrics) {
      requestAnimationFrame(tick);
      return;
    }

    const motionOk = metrics.motion < 7.5; // lower = steadier
    const centerOk = metrics.center > 0.55;
    const heightOk = metrics.height > 0.55;
    const energyOk = metrics.energy > 1200;

    const match = centerOk && heightOk && energyOk;

    if (match && motionOk) autoStableCountRef.current += 1;
    else autoStableCountRef.current = 0;

    const stable = autoStableCountRef.current >= 5;

    let hint = "Align to the outline";
    if (!energyOk) hint = "Step into better lighting / fill the frame";
    else if (!centerOk) hint = "Center your body on the outline";
    else if (!heightOk) hint = "Show full body (head + feet)";
    else if (!motionOk) hint = "Hold still…";
    else if (stable) hint = "Locked — auto capture";

    setAutoStatus({
      match,
      stable,
      motion: metrics.motion,
      center: metrics.center,
      height: metrics.height,
      hint,
    });

    requestAnimationFrame(tick);
  };

  const raf = requestAnimationFrame(tick);

  return () => {
    alive = false;
    try { cancelAnimationFrame(raf); } catch {}
    autoStableCountRef.current = 0;
  };
}, [phase, ready, autoEnabled, countdown, poseIndex]);

// Countdown once we have a stable match
useEffect(() => {
  if (phase !== "capture") return;
  if (!autoEnabled || !ready) return;
  if (!autoStatus.match || !autoStatus.stable) return;
  if (countdown > 0) return;

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
}, [phase, autoEnabled, ready, autoStatus.match, autoStatus.stable, countdown, doCapture]);

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

        // Try AI scoring first (3 poses). If anything fails, fall back to local lightweight signals.
        const hist = readPoseSessionHistory(userId);
        const prev = hist?.[0] || prevSession || null;

        const aiSession = await scorePoseSessionWithAI({
          poses: captures.map((c) => ({
            poseKey: c.poseKey,
            title: c.title,
            image_data_url: c.dataUrl,
          })),
          prevSession: prev,
          todayISO: today,
        });

        let currentSession = null;

        if (aiSession && aiSession.muscleSignals) {
          const streak = computeSessionStreak(hist);
          const effectiveStreak = clamp(streak.streak || 1, 1, 999);

          currentSession = {
            id: uid(),
            user_id: userId,
            localDay: today,
            createdAt: Date.now(),
            poses: aiSession.poses || captures.map((c) => ({ poseKey: c.poseKey })),
            muscleSignals: aiSession.muscleSignals,
            build_arc: clamp(aiSession.build_arc ?? aiSession.buildArcScore ?? 80, 0, 100),
            percentile: clamp(aiSession.percentile ?? 20, 1, 99),
            strength: String(aiSession.strength || aiSession.strengthTag || "Consistency").slice(0, 40),
            horizon_days: clamp(aiSession.horizon_days ?? 90, 7, 365),
            highlights: Array.isArray(aiSession.highlights) ? aiSession.highlights.slice(0, 5) : [],
            levers: Array.isArray(aiSession.levers) ? aiSession.levers.slice(0, 4) : [],
            confidenceNote: String(aiSession.confidenceNote || "").slice(0, 160),
            poseQuality: aiSession.poseQuality || null,
            streak_count: effectiveStreak,
          };
        } else {
          // Analyze each capture locally (non-medical). Used for consistent progress tracking + deltas.
          const analyzed = [];
          for (const cap of captures) {
            const metrics = await analyzeImageDataUrl(cap.dataUrl);
            const signals = computeSignalsForPose(cap.poseKey, metrics);
            analyzed.push({ poseKey: cap.poseKey, metrics, signals });
          }

          const mergedSignals = mergeSignals(analyzed.map((a) => a.signals));

          const streak = computeSessionStreak(hist);
          const effectiveStreak = clamp(streak.streak || 1, 1, 999);

          const buildArc = computeBuildArc(mergedSignals, effectiveStreak);
          const percentile = buildPercentile(buildArc);
          const strength = buildStrengthTag(effectiveStreak, mergedSignals);

          currentSession = {
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
            streak_count: effectiveStreak,
          };
        }

        // Compute positive-only deltas vs previous session
        const deltas = computeDeltasPositiveOnly(prev, currentSession);

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

        const levers = (currentSession.levers && currentSession.levers.length)
          ? currentSession.levers
          : [
              "Add +25g protein today",
              "Strength train 2–3×/week",
              "Re-scan weekly in similar lighting",
            ];

        if (!cancelled) {
          setDeltaWins(wins);
          setDeltaLabel(label);
          setStreakCount(currentSession.streak_count || 1);
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
                      label={autoStatus.hint}
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
                        disabled={countdown > 0}
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
                  <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.70)", mt: 0.4 }}>
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
                    <Typography variant="h5" sx={{ fontWeight: 950, letterSpacing: 0.2 }}>
                      Scan Results
                    </Typography>
                    <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.72)" }}>
                      Here are your physique signals from this pose session. Always neutral or positive.
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
                          <Typography sx={{ fontWeight: 900 }}>Locking your session…</Typography>
                          <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.70)", mt: 0.4 }}>
                            Calibrating your baseline and calculating week‑over‑week wins.
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
                          <Typography sx={{ fontSize: 40, fontWeight: 950, lineHeight: 1.0 }}>
                            {results.build_arc}/100
                          </Typography>
                          <Typography sx={{ color: "rgba(255,255,255,0.75)", mt: 0.4 }}>
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
                          <Typography sx={{ fontWeight: 900 }}>Since last session</Typography>
                          <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.70)", mt: 0.4 }}>
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
                        <Typography sx={{ fontWeight: 900 }}>Upgrade levers</Typography>
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
