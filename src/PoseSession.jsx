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
import FlipCameraAndroidIcon from "@mui/icons-material/FlipCameraAndroid";

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
import { getPoseLandmarker, scorePoseMatch } from "./lib/poseLandmarker.js";

const POSES = [
  {
    key: "front_relaxed",
    title: "Front Relaxed",
    subtitle: "Stand tall - arms relaxed - full body in frame",
  },
  {
    key: "front_double_bi",
    title: "Double Bi",
    subtitle: "Hands up - elbows out - squeeze arms",
  },
  {
    key: "back_double_bi",
    title: "Back Double Bi",
    subtitle: "Turn around - elbows up - spread back",
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

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function getCoverVisibleRect(videoW, videoH, canvasW, canvasH) {
  // Returns visible rect in normalized video coords when rendering with objectFit: 'cover'.
  // { minX, minY, w, h } all in [0..1].
  if (!videoW || !videoH || !canvasW || !canvasH) return { minX: 0, minY: 0, w: 1, h: 1 };
  const scale = Math.max(canvasW / videoW, canvasH / videoH);
  const visW = canvasW / scale;
  const visH = canvasH / scale;
  const x0 = (videoW - visW) / 2;
  const y0 = (videoH - visH) / 2;
  return {
    minX: x0 / videoW,
    minY: y0 / videoH,
    w: visW / videoW,
    h: visH / videoH,
  };
}

function remapLandmarksToVisible(landmarks, vis) {
  if (!landmarks || !vis) return landmarks;
  const { minX, minY, w, h } = vis;
  const invW = w ? 1 / w : 1;
  const invH = h ? 1 / h : 1;
  return landmarks.map((p) => ({
    ...p,
    x: (p.x - minX) * invW,
    y: (p.y - minY) * invH,
  }));
}


async function makeAiThumbFromCanvas(srcCanvas, maxEdge = 384, quality = 0.72) {
  const sw = srcCanvas.width;
  const sh = srcCanvas.height;
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const tw = Math.max(1, Math.round(sw * scale));
  const th = Math.max(1, Math.round(sh * scale));

  const c = document.createElement("canvas");
  c.width = tw;
  c.height = th;
  const ctx = c.getContext("2d");
  ctx.drawImage(srcCanvas, 0, 0, sw, sh, 0, 0, tw, th);
  return c.toDataURL("image/jpeg", quality);
}

// ---- Pose template (desired ghost) built from anchors (shoulders/hips) ----
function buildPoseTemplate(poseKey, anchors) {
  if (!anchors) return null;
  const { midShoulder, midHip, shoulderWidth } = anchors;

  // Create an abstract "ghost" using a few key points.
  // Everything is in normalized video coords [0..1].
  const sw = shoulderWidth || 0.22;

  const head = { x: midShoulder.x, y: midShoulder.y - sw * 0.95 };
  const neck = { x: midShoulder.x, y: midShoulder.y - sw * 0.22 };
  const ls = { x: midShoulder.x - sw * 0.5, y: midShoulder.y };
  const rs = { x: midShoulder.x + sw * 0.5, y: midShoulder.y };
  const lh = { x: midHip.x - sw * 0.42, y: midHip.y };
  const rh = { x: midHip.x + sw * 0.42, y: midHip.y };

  let le, re, lw, rw;

  if (poseKey === "front_double_bi" || poseKey === "back_double_bi") {
    // elbows high + out, wrists near head
    le = { x: midShoulder.x - sw * 1.05, y: midShoulder.y - sw * 0.45 };
    re = { x: midShoulder.x + sw * 1.05, y: midShoulder.y - sw * 0.45 };
    lw = { x: midShoulder.x - sw * 0.55, y: midShoulder.y - sw * 0.95 };
    rw = { x: midShoulder.x + sw * 0.55, y: midShoulder.y - sw * 0.95 };
  } else {
    // relaxed: elbows down, wrists near hips
    le = { x: midShoulder.x - sw * 0.65, y: midShoulder.y + sw * 0.62 };
    re = { x: midShoulder.x + sw * 0.65, y: midShoulder.y + sw * 0.62 };
    lw = { x: midHip.x - sw * 0.55, y: midHip.y + sw * 0.75 };
    rw = { x: midHip.x + sw * 0.55, y: midHip.y + sw * 0.75 };
  }

  const kneeY = midHip.y + sw * 1.75;
  const ankleY = midHip.y + sw * 2.65;

  const lk = { x: midHip.x - sw * 0.28, y: kneeY };
  const rk = { x: midHip.x + sw * 0.28, y: kneeY };
  const la = { x: midHip.x - sw * 0.22, y: ankleY };
  const ra = { x: midHip.x + sw * 0.22, y: ankleY };

  return {
    head,
    neck,
    ls,
    rs,
    le,
    re,
    lw,
    rw,
    lh,
    rh,
    lk,
    rk,
    la,
    ra,
    midShoulder,
    midHip,
    shoulderWidth: sw,
  };
}

function drawNeonGhost(ctx, tpl, { w, h, glow = true }) {
  if (!ctx || !tpl) return;

  const P = (p) => ({ x: p.x * w, y: p.y * h });

  const segs = [
    ["head", "neck"],
    ["neck", "ls"],
    ["neck", "rs"],
    ["ls", "le"],
    ["le", "lw"],
    ["rs", "re"],
    ["re", "rw"],
    ["ls", "rs"],
    ["ls", "lh"],
    ["rs", "rh"],
    ["lh", "rh"],
    ["lh", "lk"],
    ["lk", "la"],
    ["rh", "rk"],
    ["rk", "ra"],
  ];

  ctx.save();
  ctx.clearRect(0, 0, w, h);

  // soft vignette to make ghost readable
  const grd = ctx.createRadialGradient(w * 0.5, h * 0.55, h * 0.1, w * 0.5, h * 0.55, h * 0.7);
  grd.addColorStop(0, "rgba(0,0,0,0)");
  grd.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);

  const baseWidth = Math.max(4, Math.min(10, tpl.shoulderWidth * w * 0.06));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // glow layer
  if (glow) {
    ctx.strokeStyle = "rgba(0, 255, 170, 0.25)";
    ctx.lineWidth = baseWidth * 3.0;
    ctx.shadowColor = "rgba(0, 255, 170, 0.45)";
    ctx.shadowBlur = 18;
    for (const [a, b] of segs) {
      const A = P(tpl[a]);
      const B = P(tpl[b]);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
    }
  }

  // core line
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(0, 255, 190, 0.92)";
  ctx.lineWidth = baseWidth * 1.15;
  for (const [a, b] of segs) {
    const A = P(tpl[a]);
    const B = P(tpl[b]);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
  }

  // hint zones for arms (makes matching obvious)
  const zoneAlpha = 0.14;
  ctx.fillStyle = `rgba(0,255,190,${zoneAlpha})`;
  const drawZone = (p, r) => {
    const c = P(p);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  drawZone(tpl.lw, baseWidth * 2.8);
  drawZone(tpl.rw, baseWidth * 2.8);
  drawZone(tpl.le, baseWidth * 2.8);
  drawZone(tpl.re, baseWidth * 2.8);

  ctx.restore();
}

// ----- AI scoring call (kept from prior patch) -----
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
        poses: poses.map((p) => ({
          poseKey: p.pose_key,
          image_data_url: p.ai_image_data_url || p.image_data_url,
        })),
        prev: prevSession || null,
        today_local_day: todayISO,
      }),
    });

    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error((j && j.error) || "AI failed");
    if (!j || !j.session) throw new Error("Bad AI response");
    return { ok: true, session: j.session };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export default function PoseSession() {
  const history = useHistory();
  const { user } = useAuth();

  const userId = user?.id || "guest";
  const todayISO = useMemo(() => localDayISO(), []);
  const prevHistory = useMemo(() => readPoseSessionHistory(userId), [userId]);
  const prevSession = prevHistory?.[0] || null;

  const [cameraFacing, setCameraFacing] = useState("user"); // default front
  const [captureLayout, setCaptureLayout] = useState("portrait"); // portrait default (mobile-first)

  // Patch B: defensive orientation derivation.
  // Some deployed bundles referenced `frameOrientation` without defining it.
  // Keeping this local, derived constant prevents runtime ReferenceErrors
  // without changing any existing logic.
  const frameOrientation = useMemo(() => {
    try {
      const t = String(globalThis?.screen?.orientation?.type || "").toLowerCase();
      if (t.includes("landscape")) return "landscape";
      if (t.includes("portrait")) return "portrait";
    } catch {}
    try {
      if (typeof window !== "undefined" && window.innerWidth && window.innerHeight) {
        return window.innerWidth > window.innerHeight ? "landscape" : "portrait";
      }
    } catch {}
    return "portrait";
  }, [captureLayout]);

  const [step, setStep] = useState(0); // 0..POSES-1 then results
  const [started, setStarted] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [autoSnapEnabled, setAutoSnapEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockHint, setLockHint] = useState("Move back - fit your body in frame");
  const [captures, setCaptures] = useState([]); // [{pose_key, dataUrl}]
  const [scanBusy, setScanBusy] = useState(false);
  const [aiSession, setAiSession] = useState(null);
  const [aiError, setAiError] = useState("");

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const overlayRef = useRef(null);
  const rafRef = useRef(0);
  const lastLmRef = useRef(null);
  const stableRef = useRef({ t0: 0, okFrames: 0 });

  const pose = POSES[Math.min(step, POSES.length - 1)];
  const isResults = step >= POSES.length;

  const stopStream = useCallback(() => {
    try {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    } catch {}
    rafRef.current = 0;

    const s = streamRef.current;
    streamRef.current = null;
    if (s) {
      try {
        s.getTracks().forEach((t) => t.stop());
      } catch {}
    }
  }, []);

  const startStream = useCallback(async () => {
    stopStream();
    const constraints = {
      audio: false,
      video: {
        facingMode: cameraFacing, // "user" or "environment"
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    };

    const s = await navigator.mediaDevices.getUserMedia(constraints);
    streamRef.current = s;

    const v = videoRef.current;
    if (v) {
      v.srcObject = s;
      await v.play().catch(() => {});
    }
  }, [cameraFacing, stopStream]);

  useEffect(() => {
    if (!started) return;
    startStream();
    return () => stopStream();
  }, [started, startStream, stopStream]);

  // Keypoint loop: detect pose and update lock state + draw ghost
  useEffect(() => {
    if (!started) return;
    if (isResults) return;

    let alive = true;
    let landmarker = null;

    const run = async () => {
      landmarker = await getPoseLandmarker();
      const v = videoRef.current;
      const canvas = overlayRef.current;
      if (!v || !canvas) return;

      const ctx = canvas.getContext("2d");
      const tick = async () => {
        if (!alive) return;

        const w = canvas.clientWidth || v.clientWidth || 360;
        const h = canvas.clientHeight || v.clientHeight || 640;
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;

        // Run pose detection (guarded): never call MediaPipe unless video has a real frame.
        const t = nowMs();
        let landmarks = null;

        const isVideoReady =
          !document.hidden &&
          v.readyState >= 2 &&
          (v.videoWidth || 0) > 0 &&
          (v.videoHeight || 0) > 0 &&
          Number.isFinite(v.currentTime);

        // Throttle to ~12fps to reduce CPU/GPU churn.
        if (!stableRef.current.lastDetectAt) stableRef.current.lastDetectAt = 0;
        const shouldDetect = isVideoReady && t - stableRef.current.lastDetectAt >= 85;

        if (shouldDetect) {
          stableRef.current.lastDetectAt = t;
          try {
            const r = landmarker.detectForVideo(v, t);
            landmarks = r?.landmarks?.[0] || null;
            stableRef.current.detectErrStreak = 0;
          } catch (e) {
            landmarks = null;
            stableRef.current.detectErrStreak = (stableRef.current.detectErrStreak || 0) + 1;

            const msg = String(e?.message || e || "");
            const looksLikeGraphPoison =
              msg.includes("roi->width") ||
              msg.includes("ROI width and height") ||
              msg.includes("Graph has errors") ||
              msg.includes("texImage2D") ||
              msg.includes("no video") ||
              msg.includes("Framebuffer is incomplete");

            // If the graph is poisoned (tab-switch/camera pause), hard-reset landmarker + restart stream.
            if (looksLikeGraphPoison && stableRef.current.detectErrStreak >= 2) {
              stableRef.current.detectErrStreak = 0;
              try { await resetPoseLandmarker(); } catch {}
              try { stopStream(); } catch {}
              await new Promise((r) => setTimeout(r, 180));
              try { await startStream(); } catch {}
            }
          }
        }

        let match = 0;
        let anchors = null;
        let bbox = null;

        if (landmarks && landmarks.length >= 33) {
          const vis = getCoverVisibleRect(v.videoWidth, v.videoHeight, w, h);
          const lmVis = remapLandmarksToVisible(landmarks, vis);
          const scored = scorePoseMatch(pose.key, lmVis);
          match = clamp(scored?.match || 0, 0, 1);
          anchors = scored?.anchors || null;
          bbox = scored?.bbox || null;
          landmarks = lmVis;
          lastLmRef.current = { landmarks: lmVis, anchors, bbox, match };
        } else {
          lastLmRef.current = null;
        }

        const tpl = buildPoseTemplate(pose.key, anchors);
        drawNeonGhost(ctx, tpl, { w, h, glow: true });

        // Match + stability gating (MOVE BACK → MATCH → HOLD)
        // NOTE: we render with objectFit:'cover' (no black bars), so bbox is already in visible coords.
        // We use hysteresis so "in frame" doesn't flicker on webcams.
        let inFrameRaw = false;
        if (bbox) {
          const height = bbox.maxY - bbox.minY;
          const width = bbox.maxX - bbox.minX;
          // Full body preferred (mobile). On desktop webcams, allow "upper body + hips" to still lock.
          const fullBody = height >= 0.72 && bbox.minY <= 0.12 && bbox.maxY >= 0.88;
          const upperBody = height >= 0.48 && bbox.minY <= 0.08 && bbox.maxY >= 0.62 && width >= 0.28;
          inFrameRaw = fullBody || upperBody;
        }

        // hysteresis
        const fr = stableRef.current;
        fr.inFrameFrames = fr.inFrameFrames || 0;
        fr.inFrameFrames = inFrameRaw ? Math.min(18, fr.inFrameFrames + 1) : Math.max(0, fr.inFrameFrames - 2);
        const inFrame = fr.inFrameFrames >= 6;

        const ok = inFrame && match >= 0.72;

        // stability from landmark movement (much more reliable than pixel diff)
        let stable = false;
        if (landmarks && lastLmRef.current?.landmarks) {
          const prevLm = stableRef.current.prevLm;
          if (prevLm && prevLm.length === landmarks.length) {
            let sum = 0;
            for (let i = 0; i < landmarks.length; i++) {
              const dx = landmarks[i].x - prevLm[i].x;
              const dy = landmarks[i].y - prevLm[i].y;
              sum += Math.sqrt(dx * dx + dy * dy);
            }
            const avg = sum / landmarks.length;
            stable = avg < 0.0045; // small movement
          }
          stableRef.current.prevLm = landmarks;
        }

        if (!inFrame) {
          setLocked(false);
          setLockHint("Move back - get full body inside the frame");
          stableRef.current.okFrames = 0;
        } else if (match < 0.72) {
          setLocked(false);
          setLockHint("Match the outline - then hold still");
          stableRef.current.okFrames = 0;
        } else if (!stable) {
          setLocked(false);
          setLockHint("Hold still… almost locked");
          stableRef.current.okFrames = 0;
        } else {
          // locked candidate
          stableRef.current.okFrames += 1;
          setLockHint("LOCKED ✅");
          setLocked(true);
        }

        // Auto-capture after a short stable period
        if (ok && stable && stableRef.current.okFrames >= 6 && !countdown) {
          // Start countdown
          setCountdown(3);
        }

        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    };

    run();

    return () => {
      alive = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [started, isResults, pose.key, countdown]);

  // countdown -> snap
  useEffect(() => {
    if (!countdown) return;
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => (c ? c - 1 : null)), 750);
    return () => clearTimeout(t);
  }, [countdown]);

  useEffect(() => {
    if (countdown === 0) {
      setCountdown(null);
      onCapture();
    }
  }, [countdown]); // eslint-disable-line react-hooks/exhaustive-deps

  const onCapture = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;

    const isVideoReady =
      !document.hidden &&
      v.readyState >= 2 &&
      (v.videoWidth || 0) > 0 &&
      (v.videoHeight || 0) > 0;

    if (!isVideoReady) {
      // Prevent WebGL/MediaPipe errors when the camera feed is paused or not ready (tab switch, permission prompt, etc.)
      setAiError("Camera is still warming up — try again in a second.");
      return;
    }


    // Capture exactly what the user sees (no black bars): center-crop to the visible rect (objectFit:'cover')
    const vw = v.videoWidth || 720;
    const vh = v.videoHeight || 1280;

    const outW = captureLayout === "landscape" ? 1920 : 1080;
    const outH = captureLayout === "landscape" ? 1080 : 1920;

    const tmp = document.createElement("canvas");
    tmp.width = outW;
    tmp.height = outH;
    const ctx = tmp.getContext("2d");

    const vis = getCoverVisibleRect(vw, vh, outW, outH);
    const sx = Math.max(0, Math.floor(vis.minX * vw));
    const sy = Math.max(0, Math.floor(vis.minY * vh));
    const sw = Math.max(1, Math.floor(vis.w * vw));
    const sh = Math.max(1, Math.floor(vis.h * vh));

    if (cameraFacing === "user") {
      ctx.translate(outW, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, outW, outH);

    const dataUrl = tmp.toDataURL("image/png", 0.92);
    const aiThumb = await makeAiThumbFromCanvas(tmp, 384, 0.72);

    setCaptures((cur) => [
      ...cur,
      { pose_key: pose.key, image_data_url: dataUrl, ai_image_data_url: aiThumb },
    ]);
    setLocked(false);
    setCountdown(null);
    stableRef.current.okFrames = 0;

    if (step + 1 >= POSES.length) {
      // go to results & score
      setStep(POSES.length);
    } else {
      setStep((s) => s + 1);
    }
  }, [pose.key, step, cameraFacing]);

  // Score session when finished capturing
  useEffect(() => {
    if (!started) return;
    if (!isResults) return;
    if (captures.length < POSES.length) return;
    if (scanBusy || aiSession) return;

    let canceled = false;

    const run = async () => {
      setScanBusy(true);
      setAiError("");

      const r = await scorePoseSessionWithAI({
        poses: captures,
        prevSession,
        todayISO,
      });

      if (canceled) return;

      if (r.ok) {
        setAiSession(r.session);
        // Save minimal session (no images) for deltas/streak
        try {
          const hist = readPoseSessionHistory(userId);
          const streak = computeSessionStreak(hist, todayISO);

          const record = {
            local_day: todayISO,
            created_at: Date.now(),
            build_arc: clamp(r.session?.build_arc ?? r.session?.buildArcScore ?? 75, 0, 100),
            muscleSignals: r.session?.muscleSignals || {},
            poseQuality: r.session?.poseQuality || {},
          };

          appendPoseSession(userId, record);
        } catch {}
      } else {
        setAiError(r.error || "Scan failed");
        // Still save baseline record (positive-only) so next session has context
        try {
          const hist = readPoseSessionHistory(userId);
          const record = {
            local_day: todayISO,
            created_at: Date.now(),
            build_arc: 78,
            muscleSignals: {},
            poseQuality: {},
          };
          appendPoseSession(userId, record);
        } catch {}
      }

      setScanBusy(false);
    };

    run();
    return () => {
      canceled = true;
    };
  }, [started, isResults, captures, scanBusy, aiSession, prevSession, todayISO, userId]);

  const latestRecord = useMemo(() => {
    try {
      const hist = readPoseSessionHistory(userId);
      return hist?.[0] || null;
    } catch {
      return null;
    }
  }, [userId, aiSession, aiError]); // recompute after scoring

  const deltas = useMemo(() => {
    if (!latestRecord) return null;
    const hist = readPoseSessionHistory(userId);
    const prev = hist?.[1] || null;
    return computeDeltasPositiveOnly(prev, latestRecord);
  }, [latestRecord, userId]);

  const streakCount = useMemo(() => {
    try {
      const hist = readPoseSessionHistory(userId);
      return computeSessionStreak(hist, todayISO);
    } catch {
      return 1;
    }
  }, [userId, todayISO, aiSession, aiError]);

  const share = useCallback(async () => {
    const session = aiSession || {};
    const buildArc =
      clamp(session?.build_arc ?? session?.buildArcScore ?? latestRecord?.build_arc ?? 78, 0, 100);

    const percentile = clamp(session?.percentile ?? 22, 1, 99);
    const strength = session?.strength || "Momentum";

    const hype =
      session?.hype ||
      (prevSession
        ? "WHOA - your consistency is showing. Keep the streak alive."
        : "Baseline locked ✅ You’re already off to a strong start.");

    const wins =
      session?.highlights ||
      (prevSession ? ["Chest signal up", "Arms looking fuller"] : ["Strong starting frame", "Great pose control"]);

    const levers =
      session?.levers ||
      (session?.nextPlan ? session.nextPlan : ["Protein +25g today", "Train 2-3× this week"]);

    const png = await buildPoseSessionSharePng({
      buildArc,
      percentile,
      strength,
      streakCount,
      sincePoints: deltas?.since_points || 0,
      headline: "POSE SESSION",
      subhead: hype,
      wins,
      levers,
      // embed the 3 pose images (viral payload)
      poseImages: captures.map((c) => c.image_data_url).slice(0, 3),
    });

    await shareOrDownloadPng(
      png,
      `slimcal-pose-session-${todayISO}.png`,
      "Pose Session ✅ #SlimcalAI"
    );
  }, [aiSession, captures, todayISO, streakCount, deltas, prevSession, latestRecord]);

  const start = () => {
    setStarted(true);
    setStep(0);
    setCaptures([]);
    setAiSession(null);
    setAiError("");
    setCountdown(null);
    setLocked(false);
    setAutoSnapEnabled(false);
    stableRef.current.okFrames = 0;
  };

  const back = () => history.push("/");

  return (
    <Box sx={{ p: 2, maxWidth: 720, mx: "auto" }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<ArrowBackIcon />}
          onClick={back}
        >
          Back
        </Button>
        <Box sx={{ flex: 1 }} />
        {started && !isResults && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<FlipCameraAndroidIcon />}
            onClick={() => setCameraFacing((f) => (f === "user" ? "environment" : "user"))}
          >
            Flip
          </Button>
        )}
        {!started ? (
          <Chip label="BETA" color="success" size="small" />
        ) : (
          <Chip label={`${Math.min(step + 1, 3)}/3`} color="info" size="small" />
        )}
      </Stack>

      {!started ? (
        <Card sx={{ borderRadius: 3, background: "#0b0f14", color: "#eafffb" }}>
          <CardContent>
            <Typography variant="h5" sx={{ fontWeight: 900, letterSpacing: 0.5 }}>
              Pose Session
            </Typography>
            <Typography sx={{ mt: 0.5, color: "rgba(220,255,245,0.9)" }}>
              3 poses - auto-lock - share your progress
            </Typography>
            <Divider sx={{ my: 2, borderColor: "rgba(0,255,190,0.18)" }} />
            <Stack spacing={1.25}>
              {POSES.map((p) => (
                <Box
                  key={p.key}
                  sx={{
                    p: 1.25,
                    borderRadius: 2,
                    border: "1px solid rgba(0,255,190,0.15)",
                    background: "rgba(0,255,190,0.04)",
                  }}
                >
                  <Typography sx={{ fontWeight: 800 }}>{p.title}</Typography>
                  <Typography sx={{ fontSize: 13, color: "rgba(220,255,245,0.86)" }}>
                    {p.subtitle}
                  </Typography>
                </Box>
              ))}
            </Stack>
            <Button
              sx={{ mt: 2 }}
              fullWidth
              size="large"
              variant="contained"
              startIcon={<CameraAltIcon />}
              onClick={start}
            >
              Start Pose Session
            </Button>
          </CardContent>
        </Card>
      ) : !isResults ? (
        <Card sx={{ borderRadius: 3, background: "#05070a", color: "#eafffb", overflow: "hidden" }}>
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 900 }}>
              {pose.title}
            </Typography>
            <Typography sx={{ fontSize: 13, color: "rgba(220,255,245,0.88)" }}>
              {pose.subtitle}
            </Typography>

            <Box
              sx={{
                mt: 1.5,
                position: "relative",
                width: "100%",
                aspectRatio: captureLayout === "landscape" ? "16 / 9" : "9 / 16",
                borderRadius: 3,
                overflow: "hidden",
                border: "1px solid rgba(0,255,190,0.18)",
                background: "#000",
              }}
            >
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover", // fill container (no black bars)
                  transform: cameraFacing === "user" ? "scaleX(-1)" : "none",
                  background: "#000",
                }}
              />
              <canvas
                ref={overlayRef}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  pointerEvents: "none",
                  mixBlendMode: "screen",
                  transform: cameraFacing === "user" ? "scaleX(-1)" : "none",
                }}
              />

              {/* Countdown overlay */}
              {countdown ? (
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
                      width: 120,
                      height: 120,
                      borderRadius: "999px",
                      border: "2px solid rgba(0,255,190,0.55)",
                      boxShadow: "0 0 22px rgba(0,255,190,0.25)",
                      display: "grid",
                      placeItems: "center",
                      background: "rgba(0,0,0,0.45)",
                    }}
                  >
                    <Typography sx={{ fontSize: 54, fontWeight: 900, color: "#eafffb" }}>
                      {countdown}
                    </Typography>
                  </Box>
                </Box>
              ) : null}

              {/* Lock hint */}
              <Box
                sx={{
                  position: "absolute",
                  left: 10,
                  bottom: 10,
                  right: 10,
                  p: 1,
                  borderRadius: 2,
                  background: "rgba(0,0,0,0.55)",
                  border: locked ? "1px solid rgba(0,255,190,0.55)" : "1px solid rgba(0,255,190,0.18)",
                  boxShadow: locked ? "0 0 18px rgba(0,255,190,0.18)" : "none",
                }}
              >
                <Typography sx={{ fontSize: 13, fontWeight: 800, color: "#eafffb" }}>
                  {lockHint}
                </Typography>
              </Box>
            </Box>

            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Button
                fullWidth
                variant="outlined"
                onClick={() => {
                  // Capture should always be immediate (even if auto-snap countdown is running)
                  if (countdown) setCountdown(null);
                  onCapture();
                }}
              >
                Capture now
              </Button>
              <Button
                fullWidth
                variant={autoSnapEnabled ? "outlined" : "contained"}
                onClick={() => {
                  setAutoSnapEnabled((v) => {
                    const next = !v;
                    // If enabling auto-snap while already locked-in, start a countdown immediately.
                    if (next) {
                      // Only start a manual countdown immediately if the pose is already locked.
                      if (locked) {
                        setTimeout(() => {
                          try {
                            setCountdown((c) => (c ? c : 3));
                          } catch {}
                        }, 0);
                      }
                    } else {
                      // If disabling, cancel any in-progress countdown.
                      if (countdown) setCountdown(null);
                    }
                    return next;
                  });
                }}
              >
                Auto snap {autoSnapEnabled ? "On" : "Off"}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      ) : (
        <Card sx={{ borderRadius: 3, background: "#070a0f", color: "#eafffb" }}>
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 900 }}>
              Pose Session Results
            </Typography>
            <Typography sx={{ fontSize: 13, color: "rgba(220,255,245,0.9)" }}>
              {prevSession ? "Progress update" : "Baseline locked for future scans ✅"}
            </Typography>

            <Divider sx={{ my: 2, borderColor: "rgba(0,255,190,0.18)" }} />

            {scanBusy ? (
              <Typography sx={{ fontWeight: 800, color: "rgba(220,255,245,0.9)" }}>
                Scanning your poses…
              </Typography>
            ) : (
              <>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip
                    label={`BUILD ARC ${Math.round(
                      clamp(aiSession?.build_arc ?? aiSession?.buildArcScore ?? latestRecord?.build_arc ?? 78, 0, 100)
                    )}/100`}
                    color="success"
                    sx={{ fontWeight: 900 }}
                  />
                  <Chip
                    label={`Top ${clamp(aiSession?.percentile ?? 22, 1, 99)}%`}
                    color="info"
                    sx={{ fontWeight: 800 }}
                  />
                  <Chip
                    label={`Streak ${streakCount}`}
                    sx={{
                      fontWeight: 800,
                      border: "1px solid rgba(0,255,190,0.25)",
                      color: "#eafffb",
                    }}
                    variant="outlined"
                  />
                </Stack>

                <Typography sx={{ mt: 1, color: "rgba(220,255,245,0.95)", fontWeight: 800 }}>
                  {aiSession?.hype ||
                    (prevSession
                      ? "WHOA - your momentum is building. Keep showing up."
                      : "Great starting frame. You’re going to level up fast.")}
                </Typography>

                {deltas ? (
                  <Box sx={{ mt: 1.25 }}>
                    <Typography sx={{ fontSize: 13, color: "rgba(220,255,245,0.86)" }}>
                      Since last: <b>+{deltas.since_points || 0} levels</b>
                    </Typography>
                  </Box>
                ) : null}

                <Divider sx={{ my: 2, borderColor: "rgba(0,255,190,0.18)" }} />

                <Typography sx={{ fontWeight: 900, color: "#eafffb" }}>
                  Wins
                </Typography>
                <Stack spacing={0.75} sx={{ mt: 1 }}>
                  {(aiSession?.highlights || ["Chest pop", "Arms look fuller"]).slice(0, 3).map((t, idx) => (
                    <Box
                      key={idx}
                      sx={{
                        p: 1,
                        borderRadius: 2,
                        background: "rgba(0,255,190,0.05)",
                        border: "1px solid rgba(0,255,190,0.14)",
                      }}
                    >
                      <Typography sx={{ fontWeight: 800 }}>{t}</Typography>
                    </Box>
                  ))}
                </Stack>

                <Typography sx={{ mt: 2, fontWeight: 900, color: "#eafffb" }}>
                  Next unlocks (pick 1)
                </Typography>
                <Stack spacing={0.75} sx={{ mt: 1 }}>
                  {(aiSession?.levers || ["Protein +25g today", "Train 2-3× this week"])
                    .slice(0, 2)
                    .map((t, idx) => (
                      <Box
                        key={idx}
                        sx={{
                          p: 1,
                          borderRadius: 2,
                          background: "rgba(0,255,255,0.04)",
                          border: "1px solid rgba(0,255,255,0.14)",
                        }}
                      >
                        <Typography sx={{ fontWeight: 800 }}>{t}</Typography>
                      </Box>
                    ))}
                </Stack>

                {aiError ? (
                  <Typography sx={{ mt: 1.5, color: "rgba(255,180,180,0.9)", fontWeight: 700 }}>
                    {aiError}
                  </Typography>
                ) : null}

                <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                  <Button fullWidth variant="outlined" onClick={() => start()}>
                    New Session
                  </Button>
                  <Button
                    fullWidth
                    variant="contained"
                    startIcon={<IosShareIcon />}
                    onClick={share}
                  >
                    Share
                  </Button>
                </Stack>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </Box>
  );
}