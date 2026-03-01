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

function buildPoseTemplate(poseKey, anchors, bbox, opts = {}) {
  const bboxLocal = opts?.bboxLocal || null;
  const isUpperBodyOnly = !!opts?.upperBodyOnly;

  let a = anchors;
  if (!a && bbox) {
    const cx = (bbox.minX + bbox.maxX) / 2;
    const hh = bbox.maxY - bbox.minY;
    const ww = bbox.maxX - bbox.minX;
    a = {
      midShoulder: { x: cx, y: bbox.minY + Math.min(0.24, 0.30 * hh) },
      midHip: { x: cx, y: bbox.minY + Math.min(0.64, 0.70 * hh) },
      shoulderWidth: ww * 0.60,
    };
  }
  if (!a) return null;
  const { midShoulder, midHip, shoulderWidth } = a;

  const clamp2 = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const b = bboxLocal || bbox;
  const bboxW = b ? Math.max(0.12, Math.min(0.90, b.maxX - b.minX)) : null;
  const bboxH = b ? Math.max(0.12, Math.min(0.95, b.maxY - b.minY)) : null;
  const swFromBbox = bboxW ? bboxW * 0.55 : null;
  const swRaw = Number.isFinite(shoulderWidth) ? shoulderWidth : null;
  const sw = clamp2(swFromBbox || swRaw || 0.22, 0.10, 0.28);

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
  const targetMinX = clamp2(b.minX + inset, 0, 1);
  const targetMaxX = clamp2(b.maxX - inset, 0, 1);
  const targetMinY = clamp2(b.minY + inset, 0, 1);
  const targetMaxY = clamp2(b.maxY - inset, 0, 1);
  const targetW = Math.max(1e-6, targetMaxX - targetMinX);
  const targetH = Math.max(1e-6, targetMaxY - targetMinY);

  const widen = poseKey === "front_double_bi" || poseKey === "back_double_bi" ? 1.1 : 1.0;
  const s = Math.min((targetW * widen) / rawW, targetH / rawH);

  const cxRaw = (minX + maxX) / 2;
  const cyRaw = (minY + maxY) / 2;
  const cxT = (targetMinX + targetMaxX) / 2;
  const cyT = (targetMinY + targetMaxY) / 2;

  const scalePoint = (p) => ({
    x: clamp2(cxT + (p.x - cxRaw) * s, 0, 1),
    y: clamp2(cyT + (p.y - cyRaw) * s, 0, 1),
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
    fitted.shoulderWidth = clamp2(Math.sqrt(dx * dx + dy * dy), 0.10, 0.32);
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
      if (!tpl[a] || !tpl[b]) continue;
      const A = P(tpl[a]);
      const B = P(tpl[b]);
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
    if (!tpl[a] || !tpl[b]) continue;
    const A = P(tpl[a]);
    const B = P(tpl[b]);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
  }

  const zoneAlpha = 0.14;
  ctx.fillStyle = `rgba(0,255,190,${zoneAlpha})`;
  const drawZone = (p, r) => {
    if (!p) return;
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
  const stableRef = useRef({ t0: 0, okFrames: 0, inFrameFrames: 0, lastDetectAt: 0, justCapturedAt: 0, prevLm: null });
  const onCaptureRef = useRef(null);

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

    // reset gating
    setLocked(false);
    stableRef.current.okFrames = 0;
    stableRef.current.inFrameFrames = 0;
    stableRef.current.justCapturedAt = nowMs();

    if (step + 1 >= POSES.length) {
      setStep(POSES.length);
    } else {
      setStep((s) => s + 1);
    }
  }, [pose.key, step, cameraFacing]);

  useEffect(() => {
    onCaptureRef.current = onCapture;
  }, [onCapture]);

  // Pose loop: detect pose, update lock, draw guide/ghost, auto-capture
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
        let landmarks = null;

        const isVideoReady =
          !document.hidden &&
          v.readyState >= 2 &&
          (v.videoWidth || 0) > 0 &&
          (v.videoHeight || 0) > 0 &&
          Number.isFinite(v.currentTime);

        const fr = stableRef.current;
        if (!fr.lastDetectAt) fr.lastDetectAt = 0;
        const shouldDetect = isVideoReady && t - fr.lastDetectAt >= 85;

        if (shouldDetect) {
          fr.lastDetectAt = t;
          try {
            const r = landmarker.detectForVideo(v, t);
            landmarks = r?.landmarks?.[0] || null;
            fr.detectErrStreak = 0;
          } catch (e) {
            landmarks = null;
            fr.detectErrStreak = (fr.detectErrStreak || 0) + 1;

            const msg = String(e?.message || e || "");
            const looksLikeGraphPoison =
              msg.includes("roi->width") ||
              msg.includes("ROI width and height") ||
              msg.includes("Graph has errors") ||
              msg.includes("texImage2D") ||
              msg.includes("no video") ||
              msg.includes("Framebuffer is incomplete");

            if (looksLikeGraphPoison && fr.detectErrStreak >= 2) {
              fr.detectErrStreak = 0;
              try { stopStream(); } catch {}
              await new Promise((r2) => setTimeout(r2, 180));
              try { await startStream(); } catch {}
            }
          }
        }

        let match = 0;
        let anchors = null;
        let bbox = null;
        let visCanvas = null;

        if (landmarks && landmarks.length >= 33) {
          visCanvas = getContainVisibleRect(v.videoWidth, v.videoHeight, w, h);
          const lmCanvas = mapLandmarksVideoToCanvas(landmarks, visCanvas);
          const scored = scorePoseMatch(pose.key, lmCanvas);
          match = clamp(scored?.match || 0, 0, 1);
          anchors = scored?.anchors || null;
          bbox = scored?.bbox || null;
        }

        // --- framing gate ---
        let inFrameRaw = false;
        let framingBad = false;
        let bboxLocal = null;
        let bboxH = 0;
        let bboxW = 0;
        let bboxCX = 0.5;

        let upperBodyOk = false;
        let fullBodyOk = false;

        if (bbox) {
          bboxLocal = bboxToLocal(bbox, visCanvas) || null;
          const b = bboxLocal || bbox;

          bboxH = b.maxY - b.minY;
          bboxW = b.maxX - b.minX;
          bboxCX = (b.minX + b.maxX) / 2;

          const headOk = b.minY <= 0.30;
          const hipsOk = b.maxY >= 0.62;
          const sizeOk = bboxH >= 0.38 && bboxW >= 0.22;
          const notTooClose = bboxH <= 0.88 && bboxW <= 0.82;

          upperBodyOk = headOk && hipsOk && sizeOk && notTooClose;
          fullBodyOk = bboxH >= 0.72 && b.minY <= 0.14 && b.maxY >= 0.90 && bboxW >= 0.24 && bboxW <= 0.82;

          inFrameRaw = fullBodyOk || upperBodyOk;
          framingBad = !inFrameRaw;
        }

        if (bbox && framingBad) {
          drawFramingGuide(ctx, visCanvas, { w, h });
        } else {
          const upperBodyOnly = upperBodyOk && !fullBodyOk;
          const tpl = buildPoseTemplate(pose.key, anchors, bbox, { bboxLocal, upperBodyOnly });
          drawNeonGhost(ctx, tpl, { w, h, glow: true });
        }

        // hysteresis
        fr.inFrameFrames = fr.inFrameFrames || 0;
        fr.inFrameFrames = inFrameRaw ? Math.min(18, fr.inFrameFrames + 1) : Math.max(0, fr.inFrameFrames - 2);
        const inFrame = fr.inFrameFrames >= 6;

        const ok = inFrame && match >= 0.72;

        // stability from landmark movement
        let stable = false;
        if (landmarks && landmarks.length) {
          const prevLm = fr.prevLm;
          if (prevLm && prevLm.length === landmarks.length) {
            let sum = 0;
            for (let i = 0; i < landmarks.length; i++) {
              const dx = landmarks[i].x - prevLm[i].x;
              const dy = landmarks[i].y - prevLm[i].y;
              sum += Math.sqrt(dx * dx + dy * dy);
            }
            const avg = sum / landmarks.length;
            stable = avg < 0.0045;
          }
          fr.prevLm = landmarks;
        }

        // coaching
        const tooClose = bboxH > 0.88 || bboxW > 0.82;
        const tooFar = bboxH > 0 && bboxH < 0.34;
        const offLeft = bboxCX < 0.44;
        const offRight = bboxCX > 0.56;
        const headCropped = bboxLocal ? bboxLocal.minY > 0.32 : (bbox ? bbox.minY > 0.32 : false);
        const hipsMissing = bboxLocal ? bboxLocal.maxY < 0.62 : (bbox ? bbox.maxY < 0.62 : false);

        if (!bbox) {
          setLocked(false);
          setLockHint("Step into frame");
          fr.okFrames = 0;
        } else if (!inFrame) {
          setLocked(false);
          if (tooClose) setLockHint("Move back (camera is too close)");
          else if (tooFar) setLockHint("Move closer");
          else if (offLeft) setLockHint("Move right");
          else if (offRight) setLockHint("Move left");
          else if (hipsMissing) setLockHint("Tilt down until shoulders + hips are visible");
          else if (headCropped) setLockHint("Tilt up (your head is cropped)");
          else setLockHint("Center yourself (shoulders + hips in view)");
          fr.okFrames = 0;
        } else if (match < 0.72) {
          setLocked(false);
          setLockHint("Match the neon outline");
          fr.okFrames = 0;
        } else if (!stable) {
          setLocked(false);
          setLockHint("Hold still…");
          fr.okFrames = 0;
        } else {
          fr.okFrames = (fr.okFrames || 0) + 1;
          setLockHint(fr.okFrames >= 3 ? "LOCKED ✅" : "Hold…");
          setLocked(fr.okFrames >= 3);
        }

        // --- auto snap (no countdown): fire once when locked & stable for a few frames ---
        const enough = ok && stable && (fr.okFrames || 0) >= 6;
        const coolDownOk = !fr.justCapturedAt || t - fr.justCapturedAt > 1400;

        if (autoSnap && enough && coolDownOk && typeof onCaptureRef.current === "function") {
          fr.justCapturedAt = t;
          fr.okFrames = 0;
          fr.inFrameFrames = 0;
          try {
            await onCaptureRef.current();
          } catch {}
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
  }, [started, isResults, pose.key, autoSnap, startStream, stopStream]);

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
        try {
          const hist = readPoseSessionHistory(userId);
          computeSessionStreak(hist, todayISO);

          const record = {
            local_day: todayISO,
            created_at: Date.now(),
            build_arc: clamp(r.session?.build_arc ?? r.session?.buildArcScore ?? 78, 0, 100),
            muscleSignals: r.session?.muscleSignals || {},
            poseQuality: r.session?.poseQuality || {},
          };

          appendPoseSession(userId, record);
        } catch {}
      } else {
        setAiError(r.error || "Scan failed");
        try {
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
  }, [userId, aiSession, aiError]);

  const deltas = useMemo(() => {
    if (!latestRecord) return null;
    const hist = readPoseSessionHistory(userId);
    const prev = hist?.[1] || null;
    return computeDeltasPositiveOnly(prev, latestRecord);
  }, [latestRecord, userId]);

  const share = useCallback(async () => {
    const session = aiSession || {};

    const hype =
      session?.hype ||
      (prevSession
        ? "Momentum check ✅ You’re building something real."
        : "Baseline locked ✅ Your first scan is in the books.");

    const wins =
      session?.highlights ||
      (prevSession ? ["Clean pose control", "Strong symmetry"] : ["Strong starting frame", "Great pose control"]);

    const levers =
      session?.levers ||
      (session?.nextPlan ? session.nextPlan : ["Protein +25g today", "Train 2-3× this week"]);

    const png = await buildPoseSessionSharePng({
      headline: "POSE SESSION",
      subhead: hype,
      wins,
      levers,
      sincePoints: deltas?.since_points || 0,
      poseImages: captures.map((c) => c.image_data_url).slice(0, 3),
      localDay: todayISO,
    });

    await shareOrDownloadPng(
      png,
      `slimcal-pose-session-${todayISO}.png`,
      "Pose Session ✅ #SlimcalAI"
    );
  }, [aiSession, captures, todayISO, deltas, prevSession]);

  const start = () => {
    stableRef.current = { t0: 0, okFrames: 0, inFrameFrames: 0, lastDetectAt: 0, justCapturedAt: 0, prevLm: null };
    setStarted(true);
    setStep(0);
    setCaptures([]);
    setAiSession(null);
    setAiError("");
    setLocked(false);
    setLockHint("Step into frame");
  };

  const back = () => history.push("/");

  return (
    <Box sx={{ p: 2, maxWidth: 720, mx: "auto" }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Button size="small" variant="outlined" startIcon={<ArrowBackIcon />} onClick={back}>
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
        {!started ? <Chip label="BETA" color="success" size="small" /> : <Chip label={`${Math.min(step + 1, 3)}/3`} color="info" size="small" />}
      </Stack>

      {!started ? (
        <Card sx={{ borderRadius: 3, background: "#0b0f14", color: "#eafffb" }}>
          <CardContent>
            <Typography variant="h5" sx={{ fontWeight: 900, letterSpacing: 0.5 }}>
              Pose Session
            </Typography>
            <Typography sx={{ mt: 0.5, color: "rgba(220,255,245,0.9)" }}>
              3 poses • auto-lock • instant share card
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
            <Typography sx={{ fontSize: 13, color: "rgba(220,255,245,0.88)" }}>
              {pose.subtitle}
            </Typography>

            <Box
              sx={{
                mt: 1.5,
                position: "relative",
                width: "100%",
                aspectRatio: "9 / 16",
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
                  border: locked ? "1px solid rgba(0,255,190,0.55)" : "1px solid rgba(0,255,190,0.18)",
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
                Scanning your poses…
              </Typography>
            ) : (
              <>
                <Typography sx={{ mt: 0.5, color: "rgba(220,255,245,0.95)", fontWeight: 800 }}>
                  {aiSession?.hype ||
                    (prevSession
                      ? "Momentum check ✅ You’re building something real."
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

                <Typography sx={{ fontWeight: 900, color: "#eafffb" }}>Wins</Typography>
                <Stack spacing={0.75} sx={{ mt: 1 }}>
                  {(aiSession?.highlights || ["Clean pose control", "Strong symmetry"]).slice(0, 3).map((t, idx) => (
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

                <Typography sx={{ mt: 2, fontWeight: 900, color: "#eafffb" }}>Next unlocks (pick 1)</Typography>
                <Stack spacing={0.75} sx={{ mt: 1 }}>
                  {(aiSession?.levers || ["Protein +25g today", "Train 2-3× this week"]).slice(0, 2).map((t, idx) => (
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
