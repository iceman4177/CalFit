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
  computeDeltasPositiveOnly,
  localDayISO,
} from "./lib/poseSessionStore.js";
import { getPoseLandmarker, scorePoseMatch, resetPoseLandmarker } from "./lib/poseLandmarker.js";

const POSES = [
  {
    key: "front_relaxed",
    title: "Front Relaxed",
    subtitle: "Stand tall · arms relaxed · shoulders + hips in frame",
  },
  {
    key: "front_double_bi",
    title: "Double Bi",
    subtitle: "Hands up · elbows out · squeeze arms",
  },
  {
    key: "back_double_bi",
    title: "Back Double Bi",
    subtitle: "Turn around · elbows up · spread back",
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

function getContainVisibleRect(videoW, videoH, canvasW, canvasH) {
  if (!videoW || !videoH || !canvasW || !canvasH) return { minX: 0, minY: 0, w: 1, h: 1 };
  const scale = Math.min(canvasW / videoW, canvasH / videoH);
  const drawW = videoW * scale;
  const drawH = videoH * scale;
  const x0 = (canvasW - drawW) / 2;
  const y0 = (canvasH - drawH) / 2;
  return {
    minX: x0 / canvasW,
    minY: y0 / canvasH,
    w: drawW / canvasW,
    h: drawH / canvasH,
  };
}

function mapLandmarksVideoToCanvas(landmarks, visCanvas) {
  if (!landmarks || !visCanvas) return landmarks;
  const { minX, minY, w, h } = visCanvas;
  return landmarks.map((p) => ({
    ...p,
    x: minX + p.x * w,
    y: minY + p.y * h,
  }));
}

function bboxToLocal(bboxCanvas, visCanvas) {
  if (!bboxCanvas || !visCanvas) return null;
  const { minX, minY, w, h } = visCanvas;
  const invW = w ? 1 / w : 1;
  const invH = h ? 1 / h : 1;
  return {
    minX: (bboxCanvas.minX - minX) * invW,
    minY: (bboxCanvas.minY - minY) * invH,
    maxX: (bboxCanvas.maxX - minX) * invW,
    maxY: (bboxCanvas.maxY - minY) * invH,
  };
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
function buildPoseTemplate(poseKey, anchors, bbox, opts = {}) {
  const bboxLocal = opts?.bboxLocal || null;
  const isUpperBodyOnly = !!opts?.upperBodyOnly;

  let a = anchors;
  if (!a && bbox) {
    const cx = (bbox.minX + bbox.maxX) / 2;
    const h = bbox.maxY - bbox.minY;
    const w = bbox.maxX - bbox.minX;
    a = {
      midShoulder: { x: cx, y: bbox.minY + Math.min(0.24, 0.30 * h) },
      midHip: { x: cx, y: bbox.minY + Math.min(0.64, 0.70 * h) },
      shoulderWidth: w * 0.60,
    };
  }
  if (!a) return null;
  const { midShoulder, midHip, shoulderWidth } = a;

  const b = bboxLocal || bbox;
  const bboxW = b ? Math.max(0.12, Math.min(0.90, b.maxX - b.minX)) : null;
  const bboxH = b ? Math.max(0.12, Math.min(0.95, b.maxY - b.minY)) : null;
  const swFromBbox = bboxW ? bboxW * 0.55 : null;
  const swRaw = Number.isFinite(shoulderWidth) ? shoulderWidth : null;
  const sw = clamp(swFromBbox || swRaw || 0.22, 0.10, 0.28);

  const head = { x: midShoulder.x, y: midShoulder.y - sw * 0.95 };
  const neck = { x: midShoulder.x, y: midShoulder.y - sw * 0.22 };
  const ls = { x: midShoulder.x - sw * 0.5, y: midShoulder.y };
  const rs = { x: midShoulder.x + sw * 0.5, y: midShoulder.y };
  const lh = { x: midHip.x - sw * 0.42, y: midHip.y };
  const rh = { x: midHip.x + sw * 0.42, y: midHip.y };

  let le, re, lw, rw;

  if (poseKey === "front_double_bi" || poseKey === "back_double_bi") {
    le = { x: midShoulder.x - sw * 1.05, y: midShoulder.y - sw * 0.45 };
    re = { x: midShoulder.x + sw * 1.05, y: midShoulder.y - sw * 0.45 };
    lw = { x: midShoulder.x - sw * 0.55, y: midShoulder.y - sw * 0.95 };
    rw = { x: midShoulder.x + sw * 0.55, y: midShoulder.y - sw * 0.95 };
  } else {
    le = { x: midShoulder.x - sw * 0.65, y: midShoulder.y + sw * 0.62 };
    re = { x: midShoulder.x + sw * 0.65, y: midShoulder.y + sw * 0.62 };
    lw = { x: midHip.x - sw * 0.55, y: midHip.y + sw * 0.75 };
    rw = { x: midHip.x + sw * 0.55, y: midHip.y + sw * 0.75 };
  }

  let lk = null,
    rk = null,
    la = null,
    ra = null;
  if (!isUpperBodyOnly) {
    const kneeY = midHip.y + sw * 1.75;
    const ankleY = midHip.y + sw * 2.65;
    lk = { x: midHip.x - sw * 0.28, y: kneeY };
    rk = { x: midHip.x + sw * 0.28, y: kneeY };
    la = { x: midHip.x - sw * 0.22, y: ankleY };
    ra = { x: midHip.x + sw * 0.22, y: ankleY };
  }

  const raw = {
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

  // Fit to bbox to prevent giant overlays when legs are missing / anchors jitter.
  if (!b || !bboxW || !bboxH) return raw;

  const pts = Object.entries(raw)
    .filter(
      ([k, v]) =>
        v &&
        typeof v?.x === "number" &&
        typeof v?.y === "number" &&
        k !== "midShoulder" &&
        k !== "midHip" &&
        k !== "shoulderWidth"
    )
    .map(([, v]) => v);
  if (!pts.length) return raw;

  let minX = 1e9,
    minY = 1e9,
    maxX = -1e9,
    maxY = -1e9;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const rawW = Math.max(1e-6, maxX - minX);
  const rawH = Math.max(1e-6, maxY - minY);

  const inset = 0.02;
  const targetMinX = clamp(b.minX + inset, 0, 1);
  const targetMaxX = clamp(b.maxX - inset, 0, 1);
  const targetMinY = clamp(b.minY + inset, 0, 1);
  const targetMaxY = clamp(b.maxY - inset, 0, 1);
  const targetW = Math.max(1e-6, targetMaxX - targetMinX);
  const targetH = Math.max(1e-6, targetMaxY - targetMinY);

  const widen = poseKey === "front_double_bi" || poseKey === "back_double_bi" ? 1.1 : 1.0;
  const s = Math.min((targetW * widen) / rawW, targetH / rawH);

  const cxRaw = (minX + maxX) / 2;
  const cyRaw = (minY + maxY) / 2;
  const cxT = (targetMinX + targetMaxX) / 2;
  const cyT = (targetMinY + targetMaxY) / 2;

  const scalePoint = (p) => ({
    x: clamp(cxT + (p.x - cxRaw) * s, 0, 1),
    y: clamp(cyT + (p.y - cyRaw) * s, 0, 1),
  });

  const fitted = { ...raw };
  for (const k of Object.keys(fitted)) {
    if (
      fitted[k] &&
      typeof fitted[k]?.x === "number" &&
      typeof fitted[k]?.y === "number" &&
      k !== "midShoulder" &&
      k !== "midHip"
    ) {
      fitted[k] = scalePoint(fitted[k]);
    }
  }

  if (fitted.ls && fitted.rs) {
    const dx = fitted.rs.x - fitted.ls.x;
    const dy = fitted.rs.y - fitted.ls.y;
    fitted.shoulderWidth = clamp(Math.sqrt(dx * dx + dy * dy), 0.10, 0.32);
  }

  return fitted;
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

  const grd = ctx.createRadialGradient(w * 0.5, h * 0.55, h * 0.1, w * 0.5, h * 0.55, h * 0.7);
  grd.addColorStop(0, "rgba(0,0,0,0)");
  grd.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);

  const baseWidth = Math.max(4, Math.min(10, tpl.shoulderWidth * w * 0.06));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (glow) {
    ctx.strokeStyle = "rgba(0, 255, 170, 0.25)";
    ctx.lineWidth = baseWidth * 3.0;
    ctx.shadowColor = "rgba(0, 255, 170, 0.45)";
    ctx.shadowBlur = 18;
    for (const [a, b] of segs) {
      const A = P(tpl[a]);
      const B = P(tpl[b]);
      if (!A || !B) continue;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      ctx.stroke();
    }
  }

  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(0, 255, 190, 0.92)";
  ctx.lineWidth = baseWidth * 1.15;
  for (const [a, b] of segs) {
    const A = P(tpl[a]);
    const B = P(tpl[b]);
    if (!A || !B) continue;
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
  }

  ctx.restore();
}

function drawFramingGuide(ctx, visCanvas, { w, h }) {
  if (!ctx || !visCanvas) return;

  const vx = visCanvas.minX * w;
  const vy = visCanvas.minY * h;
  const vw = visCanvas.w * w;
  const vh = visCanvas.h * h;

  const padX = vw * 0.18;
  const padTop = vh * 0.10;
  const padBottom = vh * 0.10;

  const rx = vx + padX;
  const ry = vy + padTop;
  const rw = vw - padX * 2;
  const rh = vh - padTop - padBottom;

  ctx.save();
  ctx.lineWidth = Math.max(3, Math.round(Math.min(w, h) * 0.006));
  ctx.strokeStyle = "rgba(0, 255, 214, 0.75)";
  ctx.shadowColor = "rgba(0, 255, 214, 0.9)";
  ctx.shadowBlur = 18;

  const r = Math.min(rw, rh) * 0.06;
  ctx.beginPath();
  ctx.moveTo(rx + r, ry);
  ctx.lineTo(rx + rw - r, ry);
  ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + r);
  ctx.lineTo(rx + rw, ry + rh - r);
  ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - r, ry + rh);
  ctx.lineTo(rx + r, ry + rh);
  ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - r);
  ctx.lineTo(rx, ry + r);
  ctx.quadraticCurveTo(rx, ry, rx + r, ry);
  ctx.closePath();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(2, Math.round(Math.min(w, h) * 0.004));
  ctx.strokeStyle = "rgba(0, 255, 214, 0.55)";
  ctx.beginPath();
  ctx.moveTo(rx, ry + rh * 0.22);
  ctx.lineTo(rx + rw, ry + rh * 0.22);
  ctx.moveTo(rx, ry + rh * 0.62);
  ctx.lineTo(rx + rw, ry + rh * 0.62);
  ctx.stroke();

  ctx.restore();
}

function synthesizePositiveSession({ prevSession, todayISO }) {
  const headline = prevSession ? "Progress update" : "Baseline locked ✅";
  const hype = prevSession
    ? "Nice — your momentum is building. Keep showing up."
    : "Strong starting frame. You’re set up to level up fast.";
  const highlights = prevSession
    ? ["Pose control improving", "Shoulders + arms look sharper"]
    : ["Clean baseline captured", "Great posture + symmetry"];
  const levers = ["Protein target today", "Train 2–3× this week"];

  return {
    local_day: todayISO,
    build_arc: 78,
    headline,
    hype,
    highlights,
    levers,
  };
}

async function scorePoseSessionWithAI({ poses, prevSession, todayISO }) {
  // IMPORTANT: never block the results screen.
  // If AI is slow/fails, we fall back to a positive local session.
  const fallback = synthesizePositiveSession({ prevSession, todayISO });

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

    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 14000);

    const res = await fetch("/api/ai/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(clientId ? { "x-client-id": clientId } : {}),
      },
      signal: ac.signal,
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

    clearTimeout(to);

    const j = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, session: fallback, error: (j && j.error) || "AI failed" };
    if (!j || !j.session) return { ok: false, session: fallback, error: "Bad AI response" };

    // Guarantee positive-only fields.
    const s = j.session || {};
    const safe = {
      ...fallback,
      ...s,
      build_arc: clamp(s?.build_arc ?? s?.buildArcScore ?? fallback.build_arc, 0, 100),
      hype: String(s?.hype || fallback.hype),
      highlights: Array.isArray(s?.highlights) ? s.highlights.slice(0, 3) : fallback.highlights,
      levers: Array.isArray(s?.levers) ? s.levers.slice(0, 2) : fallback.levers,
    };

    return { ok: true, session: safe };
  } catch (e) {
    return { ok: false, session: fallback, error: String(e?.message || e) };
  }
}

function drawUpperBodyShell(ctx, shell, opts = {}) {
  const { cx, cy, w, h } = shell || {};
  if (!ctx || !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(w) || !Number.isFinite(h)) return;

  const alpha = clamp(opts.alpha ?? 0.9, 0, 1);

  const left = cx - w / 2;
  const right = cx + w / 2;
  const top = cy - h / 2;
  const bottom = cy + h / 2;

  // Rounded "capsule" with a slightly narrower neck and wider shoulders.
  const r = Math.max(18, Math.min(w, h) * 0.16);
  const neckInset = w * 0.12;
  const shoulderY = top + h * 0.24;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = Math.max(4, Math.min(10, w * 0.012));
  ctx.strokeStyle = "rgba(120, 255, 235, 0.95)";
  ctx.shadowColor = "rgba(120, 255, 235, 0.95)";
  ctx.shadowBlur = Math.max(10, ctx.lineWidth * 2.2);

  ctx.beginPath();
  // start at top center
  ctx.moveTo(cx, top + r);

  // top-left curve
  ctx.quadraticCurveTo(cx - w * 0.18, top, left + r, top + r);

  // left shoulder flare down to shoulderY
  ctx.quadraticCurveTo(left, top + h * 0.18, left + neckInset, shoulderY);

  // left side down
  ctx.quadraticCurveTo(left + neckInset * 0.25, cy, left + r, bottom - r);

  // bottom-left curve
  ctx.quadraticCurveTo(left, bottom, left + r, bottom);

  // bottom-right curve
  ctx.quadraticCurveTo(right, bottom, right - r, bottom);

  // right side up
  ctx.quadraticCurveTo(right - neckInset * 0.25, cy, right - neckInset, shoulderY);

  // right shoulder flare to top-right curve
  ctx.quadraticCurveTo(right, top + h * 0.18, right - r, top + r);

  // close back to top center
  ctx.quadraticCurveTo(cx + w * 0.18, top, cx, top + r);

  ctx.stroke();
  ctx.restore();
}

export default function PoseSession() {
  const history = useHistory();
  const { user } = useAuth();

  const userId = user?.id || "guest";
  const todayISO = useMemo(() => localDayISO(), []);
  const prevHistory = useMemo(() => readPoseSessionHistory(userId), [userId]);
  const prevSession = prevHistory?.[0] || null;

  const [cameraFacing, setCameraFacing] = useState("user");
  const [captureLayout] = useState("portrait");
  const [step, setStep] = useState(0);
  const [started, setStarted] = useState(false);
  const [autoSnap, setAutoSnap] = useState(true);
  const [locked, setLocked] = useState(false);
  const [lockHint, setLockHint] = useState("Step into frame");
  const [captures, setCaptures] = useState([]);
  const [scanBusy, setScanBusy] = useState(false);
  const [aiSession, setAiSession] = useState(null);
  const [aiError, setAiError] = useState("");

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const overlayRef = useRef(null);
  const rafRef = useRef(0);

  const stableRef = useRef({ okFrames: 0, inFrameFrames: 0, prevMid: null, prevShellW: null, stepStartedAt: 0, lastSnapAt: 0, lastDetectAt: 0, detectErrStreak: 0 });
  const captureGuardRef = useRef({ busy: false, lastAt: 0 });

  const pose = POSES[Math.min(step, POSES.length - 1)];
  const isResults = step >= POSES.length;

// Reset per-pose timers so auto-capture can't instantly fire across steps.
useEffect(() => {
  const fr = stableRef.current;
  fr.okFrames = 0;
  fr.inFrameFrames = 0;
  fr.prevMid = null;
  fr.prevShellW = null;
  fr.stepStartedAt = nowMs();
}, [step, started]);



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
        facingMode: cameraFacing,
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

  const onCapture = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;

    // Prevent double-fires (autoSnap can trigger quickly).
    const g = captureGuardRef.current;
    const t = nowMs();
    if (g.busy || t - g.lastAt < 800) return;
    g.busy = true;
    g.lastAt = t;

    try {
      const vw = v.videoWidth || 720;
      const vh = v.videoHeight || 1280;

      const outW = 1080;
      const outH = 1920;

      const tmp = document.createElement("canvas");
      tmp.width = outW;
      tmp.height = outH;
      const ctx = tmp.getContext("2d");

      const scale = Math.min(outW / vw, outH / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      const dx = (outW - dw) / 2;
      const dy = (outH - dh) / 2;

      if (cameraFacing === "user") {
        ctx.translate(outW, 0);
        ctx.scale(-1, 1);
      }

      ctx.drawImage(v, 0, 0, vw, vh, dx, dy, dw, dh);

      const dataUrl = tmp.toDataURL("image/png", 0.92);
      const aiThumb = await makeAiThumbFromCanvas(tmp, 384, 0.72);

      setCaptures((cur) => [
        ...cur,
        { pose_key: pose.key, image_data_url: dataUrl, ai_image_data_url: aiThumb },
      ]);

      setLocked(false);
      stableRef.current.okFrames = 0;

      if (step + 1 >= POSES.length) {
        setStep(POSES.length);
      } else {
        setStep((s) => s + 1);
      }
    } finally {
      g.busy = false;
    }
  }, [pose.key, step, cameraFacing]);

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

        const t = nowMs();

        const isVideoReady =
          !document.hidden &&
          v.readyState >= 2 &&
          (v.videoWidth || 0) > 0 &&
          (v.videoHeight || 0) > 0 &&
          Number.isFinite(v.currentTime);

        const fr = stableRef.current;
        const shouldDetect = isVideoReady && t - (fr.lastDetectAt || 0) >= 85;

        let landmarks = null;
        let anchors = null;
        let bbox = null;
        let match = 0;
        let visCanvas = null;
        let bboxLocal = null;

        if (shouldDetect) {
          fr.lastDetectAt = t;
          try {
            const r = landmarker.detectForVideo(v, t);
            const lm = r?.landmarks?.[0] || null;
            if (lm && lm.length >= 33) {
              visCanvas = getContainVisibleRect(v.videoWidth, v.videoHeight, w, h);
              const lmCanvas = mapLandmarksVideoToCanvas(lm, visCanvas);
              const scored = scorePoseMatch(pose.key, lmCanvas);
              match = clamp(scored?.match || 0, 0, 1);
              anchors = scored?.anchors || null;
              bbox = scored?.bbox || null;
              landmarks = lmCanvas;
              if (bbox && visCanvas) bboxLocal = bboxToLocal(bbox, visCanvas);
            }
            fr.detectErrStreak = 0;
          } catch (e) {
            fr.detectErrStreak = (fr.detectErrStreak || 0) + 1;
            const msg = String(e?.message || e || "");
            const poisoned =
              msg.includes("roi->width") ||
              msg.includes("ROI width") ||
              msg.includes("texImage2D") ||
              msg.includes("no video") ||
              msg.includes("Framebuffer is incomplete") ||
              msg.includes("Graph has errors");
            if (poisoned && fr.detectErrStreak >= 2) {
              fr.detectErrStreak = 0;
              try {
                await resetPoseLandmarker();
              } catch {}
              try {
                stopStream();
              } catch {}
              await new Promise((r) => setTimeout(r, 180));
              try {
                await startStream();
              } catch {}
            }
          }
        }

// ---- Simple upper-body framing (nose + shoulders only) ----
const nose = landmarks?.[0] || null;
const ls = landmarks?.[11] || null;
const rs = landmarks?.[12] || null;

let inFrameRaw = false;
let shell = null; // {cx, cy, w, h} in canvas pixels

if (nose && ls && rs) {
  const visN = nose.visibility ?? 1;
  const visL = ls.visibility ?? 1;
  const visR = rs.visibility ?? 1;
  const visOk = Math.min(visN, visL, visR) >= 0.4;

  const midX = (ls.x + rs.x) / 2;
  const midY = (ls.y + rs.y) / 2;
  const shoulderDist = Math.hypot(ls.x - rs.x, ls.y - rs.y);

  if (visOk && shoulderDist > 1) {
    const shellW = clamp(shoulderDist * 2.75, w * 0.36, w * 0.92);
    const shellH = clamp(shellW * 1.35, h * 0.44, h * 0.92);
    const cx = clamp(midX, shellW * 0.20, w - shellW * 0.20);
    // bias slightly up so head sits near top curve
    const cy = clamp(midY + shellH * 0.06, shellH * 0.22, h - shellH * 0.22);
    shell = { cx, cy, w: shellW, h: shellH };

    const left = cx - shellW / 2;
    const right = cx + shellW / 2;
    const top = cy - shellH / 2;
    const bottom = cy + shellH / 2;

    const mx = shellW * 0.08;
    inFrameRaw =
      nose.x > left + mx &&
      nose.x < right - mx &&
      nose.y > top + shellH * 0.02 &&
      nose.y < top + shellH * 0.48 &&
      ls.x > left + mx &&
      rs.x < right - mx &&
      midY > top + shellH * 0.20 &&
      midY < bottom - shellH * 0.16;
  }
}

// hysteresis to prevent flicker
fr.inFrameFrames = fr.inFrameFrames || 0;
fr.inFrameFrames = inFrameRaw
  ? Math.min(20, fr.inFrameFrames + 1)
  : Math.max(0, fr.inFrameFrames - 2);
const inFrame = fr.inFrameFrames >= 6;

// stability: shoulder-mid movement + scale stability
let stable = false;
if (shell) {
  const prev = fr.prevMid || null;
  const prevW = fr.prevShellW || null;
  const move = prev ? Math.hypot(shell.cx - prev.x, shell.cy - prev.y) : 999;
  const scaleDelta = prevW ? Math.abs(shell.w - prevW) / Math.max(1, prevW) : 999;

  fr.prevMid = { x: shell.cx, y: shell.cy };
  fr.prevShellW = shell.w;

  stable = move < 6 && scaleDelta < 0.06;
}

// draw overlay: smooth shell only (NO boxes, NO skeleton)
ctx.clearRect(0, 0, w, h);
if (shell) {
  drawUpperBodyShell(ctx, shell, { alpha: inFrame ? 0.95 : 0.55 });
} else {
  // subtle centered shell hint
  drawUpperBodyShell(ctx, { cx: w / 2, cy: h / 2, w: w * 0.74, h: h * 0.80 }, { alpha: 0.22 });
}

// lock gating (simple + reliable)
const tSinceStep = t - (fr.stepStartedAt || t);
const canSnap =
  autoSnap &&
  inFrame &&
  stable &&
  tSinceStep >= 1200 &&
  t - (fr.lastSnapAt || 0) >= 1500;

if (!shell) {
  setLocked(false);
  setLockHint("Step into frame");
  fr.okFrames = 0;
} else if (!inFrame) {
  setLocked(false);
  setLockHint("Center head + shoulders");
  fr.okFrames = 0;
} else if (!stable) {
  setLocked(false);
  setLockHint("Hold still…");
  fr.okFrames = 0;
} else {
  fr.okFrames = Math.min(30, (fr.okFrames || 0) + 1);
  setLocked(true);
  setLockHint("LOCKED ✅");
}

// Auto-capture: hands-free only
if (canSnap && (fr.okFrames || 0) >= 10) {
  fr.lastSnapAt = t;
  fr.okFrames = 0;
  await onCapture();
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
  }, [started, isResults, pose.key, autoSnap, onCapture, startStream, stopStream]);

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

      setAiSession(r.session || null);
      if (!r.ok) setAiError(r.error || "AI unavailable (share card still ready)");

      // Always save a small record so deltas can work.
      try {
        const record = {
          local_day: todayISO,
          created_at: Date.now(),
          build_arc: clamp(r.session?.build_arc ?? r.session?.buildArcScore ?? 78, 0, 100),
          muscleSignals: r.session?.muscleSignals || {},
          poseQuality: r.session?.poseQuality || {},
        };
        appendPoseSession(userId, record);
      } catch {}

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
  }, [userId, aiSession, aiError]);

  const deltas = useMemo(() => {
    if (!latestRecord) return null;
    const hist = readPoseSessionHistory(userId);
    const prev = hist?.[1] || null;
    return computeDeltasPositiveOnly(prev, latestRecord);
  }, [latestRecord, userId]);

  const share = useCallback(async () => {
    const session = aiSession || synthesizePositiveSession({ prevSession, todayISO });

    const buildArc = clamp(session?.build_arc ?? session?.buildArcScore ?? latestRecord?.build_arc ?? 78, 0, 100);
    const hype = session?.hype || "Nice work — keep going.";
    const wins = (session?.highlights || ["Clean baseline", "Solid pose control"]).slice(0, 3);
    const levers = (session?.levers || ["Protein target today", "Train 2–3× this week"]).slice(0, 2);

    const png = await buildPoseSessionSharePng({
      buildArc,
      headline: "POSE SESSION",
      subhead: hype,
      wins,
      levers,
      // Viral payload: embed the 3 pose images.
      poseImages: captures.map((c) => c.image_data_url).slice(0, 3),
      // Neutral/positive only (no percentile / streak).
      showMeta: false,
      sincePoints: deltas?.since_points || 0,
    });

    await shareOrDownloadPng(png, `slimcal-pose-session-${todayISO}.png`, "Pose Session ✅ #SlimcalAI");
  }, [aiSession, captures, todayISO, deltas, prevSession, latestRecord]);

  const start = () => {
    setStarted(true);
    setStep(0);
    setCaptures([]);
    setAiSession(null);
    setAiError("");
    setLocked(false);
    stableRef.current.okFrames = 0;
    stableRef.current.inFrameFrames = 0;
    stableRef.current.prevLm = null;
  };

  const back = () => history.push("/");

  return (
    <Box sx={{ p: 2, maxWidth: 720, mx: "auto" }}>
            <Typography sx={{ mt: 1.5, fontSize: 13, color: "rgba(220,255,245,0.78)", textAlign: "center", fontWeight: 800 }}>
              Auto-captures when locked — hold your pose.
            </Typography>

      {!started ? (
        <Card sx={{ borderRadius: 3, background: "#0b0f14", color: "#eafffb" }}>
          <CardContent>
            <Typography variant="h5" sx={{ fontWeight: 900, letterSpacing: 0.5 }}>
              Pose Session
            </Typography>
            <Typography sx={{ mt: 0.5, color: "rgba(220,255,245,0.9)" }}>
              3 poses · auto-lock · instant share card
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
            <Button sx={{ mt: 2 }} fullWidth size="large" variant="contained" startIcon={<CameraAltIcon />} onClick={start}>
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
            <Typography sx={{ fontSize: 13, color: "rgba(220,255,245,0.88)" }}>{pose.subtitle}</Typography>

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
                  objectFit: "contain",
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

              <Box
                sx={{
                  position: "absolute",
                  left: 10,
                  bottom: 10,
                  right: 10,
                  p: 1,
                  borderRadius: 2,
                  background: "rgba(0,0,0,0.55)",
                  border: locked
                    ? "1px solid rgba(0,255,190,0.55)"
                    : "1px solid rgba(0,255,190,0.18)",
                  boxShadow: locked ? "0 0 18px rgba(0,255,190,0.18)" : "none",
                }}
              >
                <Typography sx={{ fontSize: 13, fontWeight: 800, color: "#eafffb" }}>{lockHint}</Typography>
              </Box>
            </Box>

            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Button fullWidth variant="outlined" onClick={() => onCapture()}>
                Capture now
              </Button>
              <Button fullWidth variant="contained" onClick={() => setAutoSnap((a) => !a)}>
                {autoSnap ? "Auto snap On" : "Auto snap Off"}
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
                Finalizing your share card…
              </Typography>
            ) : (
              <>
                <Typography sx={{ mt: 0.25, color: "rgba(220,255,245,0.95)", fontWeight: 800 }}>
                  {aiSession?.hype ||
                    (prevSession
                      ? "Nice — your momentum is building. Keep showing up."
                      : "Great starting frame. You’re going to level up fast.")}
                </Typography>

                {deltas ? (
                  <Box sx={{ mt: 1.25 }}>
                    <Typography sx={{ fontSize: 13, color: "rgba(220,255,245,0.86)" }}>
                      Since last: <b>+{deltas.since_points || 0}</b>
                    </Typography>
                  </Box>
                ) : null}

                <Divider sx={{ my: 2, borderColor: "rgba(0,255,190,0.18)" }} />

                <Typography sx={{ fontWeight: 900, color: "#eafffb" }}>Wins</Typography>
                <Stack spacing={0.75} sx={{ mt: 1 }}>
                  {(aiSession?.highlights || ["Clean baseline", "Solid pose control"]).slice(0, 3).map((t, idx) => (
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

                <Typography sx={{ mt: 2, fontWeight: 900, color: "#eafffb" }}>Next</Typography>
                <Stack spacing={0.75} sx={{ mt: 1 }}>
                  {(aiSession?.levers || ["Protein target today", "Train 2–3× this week"])
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
                  <Typography sx={{ mt: 1.5, color: "rgba(220,255,245,0.75)", fontWeight: 700 }}>
                    {aiError}
                  </Typography>
                ) : null}

                <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                  <Button fullWidth variant="outlined" onClick={() => start()}>
                    New Session
                  </Button>
                  <Button fullWidth variant="contained" startIcon={<IosShareIcon />} onClick={share}>
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
