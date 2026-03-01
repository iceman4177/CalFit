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
    subtitle: "Stand tall • arms relaxed • full body in frame",
  },
  {
    key: "front_double_bi",
    title: "Double Bi",
    subtitle: "Hands up • elbows out • squeeze arms",
  },
  {
    key: "back_double_bi",
    title: "Back Double Bi",
    subtitle: "Turn around • elbows up • spread back",
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
function dataUrlApproxBytes(dataUrl) {
  try {
    const i = String(dataUrl || "").indexOf(",");
    if (i < 0) return 0;
    const b64 = String(dataUrl).slice(i + 1);
    // base64 length -> bytes approximation (ignores padding nuance; good enough for guarding)
    return Math.floor((b64.length * 3) / 4);
  } catch {
    return 0;
  }
}

async function compressImageDataUrlForAI(dataUrl) {
  // Goal: keep request body under typical serverless limits (413 seen in console)
  // We keep originals for share export; AI only receives compressed thumbnails.
  const MAX_BYTES = 220_000; // per-image target (3 images ~= 660KB)
  if (!dataUrl) return dataUrl;
  if (dataUrlApproxBytes(dataUrl) <= MAX_BYTES) return dataUrl;

  try {
    const img = new Image();
    img.decoding = "async";
    img.src = dataUrl;
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = reject;
    });

    const make = async (maxDim, quality) => {
      const w0 = img.naturalWidth || img.width;
      const h0 = img.naturalHeight || img.height;
      if (!w0 || !h0) return dataUrl;
      const scale = Math.min(1, maxDim / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * scale));
      const h = Math.max(1, Math.round(h0 * scale));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { alpha: false });
      ctx.drawImage(img, 0, 0, w, h);
      return c.toDataURL("image/jpeg", quality);
    };

    // Ladder: progressively smaller & lower quality until under budget
    const ladder = [
      { d: 640, q: 0.72 },
      { d: 512, q: 0.70 },
      { d: 420, q: 0.66 },
      { d: 360, q: 0.62 },
      { d: 300, q: 0.58 },
    ];

    let best = dataUrl;
    for (const s of ladder) {
      const out = await make(s.d, s.q);
      best = out;
      if (dataUrlApproxBytes(out) <= MAX_BYTES) return out;
    }
    return best;
  } catch {
    return dataUrl;
  }
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

    // Compress images BEFORE sending to serverless to avoid 413 payload too large.
    const compressedPoses = await Promise.all(
      (poses || []).map(async (p) => ({
        pose_key: p.pose_key,
        image_data_url: await compressImageDataUrlForAI(p.image_data_url),
      }))
    );

    const res = await fetch("/api/ai/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(clientId ? { "x-client-id": clientId } : {}),
      },
      body: JSON.stringify({
        feature: "pose_session",
        poses: compressedPoses,
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
  const [step, setStep] = useState(0); // 0..POSES-1 then results
  const [started, setStarted] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [locked, setLocked] = useState(false);
  const [lockHint, setLockHint] = useState("Move back to fit your full body");
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

        // Run pose detection at ~10fps
        const t = nowMs();
        let landmarks = null;
        try {
          const r = landmarker.detectForVideo(v, t);
          landmarks = r?.landmarks?.[0] || null;
        } catch {
          landmarks = null;
        }

        let match = 0;
        let anchors = null;
        let bbox = null;

        if (landmarks && landmarks.length >= 33) {
          const scored = scorePoseMatch(pose.key, landmarks);
          match = clamp(scored?.match || 0, 0, 1);
          anchors = scored?.anchors || null;
          bbox = scored?.bbox || null;
          lastLmRef.current = { landmarks, anchors, bbox, match };
        } else {
          lastLmRef.current = null;
        }

        const tpl = buildPoseTemplate(pose.key, anchors);
        drawNeonGhost(ctx, tpl, { w, h, glow: true });

        // Match + stability gating (MrBeast simple: MOVE BACK -> MATCH -> HOLD)
        let inFrame = false;
        if (bbox) {
          const height = bbox.maxY - bbox.minY;
          inFrame = height > 0.55 && bbox.minY < 0.22 && bbox.maxY > 0.88;
        }

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
          setLockHint("Move back • get full body inside the frame");
          stableRef.current.okFrames = 0;
        } else if (match < 0.72) {
          setLocked(false);
          setLockHint("Match the outline • then hold still");
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

    // draw current frame to a temp canvas (respect mirroring for selfie cam)
    const tmp = document.createElement("canvas");
    const w = v.videoWidth || 720;
    const h = v.videoHeight || 1280;
    tmp.width = w;
    tmp.height = h;
    const ctx = tmp.getContext("2d");

    if (cameraFacing === "user") {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0, w, h);

    const dataUrl = tmp.toDataURL("image/png", 0.92);
    setCaptures((cur) => [
      ...cur,
      { pose_key: pose.key, image_data_url: dataUrl },
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
        ? "WHOA — your consistency is showing. Keep the streak alive."
        : "Baseline locked ✅ You’re already off to a strong start.");

    const wins =
      session?.highlights ||
      (prevSession ? ["Chest signal up", "Arms looking fuller"] : ["Strong starting frame", "Great pose control"]);

    const levers =
      session?.levers ||
      (session?.nextPlan ? session.nextPlan : ["Protein +25g today", "Train 2–3× this week"]);

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

    await shareOrDownloadPng(png, {
      filename: `slimcal-pose-session-${todayISO}.png`,
      shareTitle: "SlimCal Pose Session",
      shareText: "Pose Session ✅ #SlimcalAI",
    });
  }, [aiSession, captures, todayISO, streakCount, deltas, prevSession, latestRecord]);

  const start = () => {
    setStarted(true);
    setStep(0);
    setCaptures([]);
    setAiSession(null);
    setAiError("");
    setCountdown(null);
    setLocked(false);
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
              3 poses • auto-lock • share your progress
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
                  objectFit: "contain", // FIX: no crop zoom
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
                onClick={() => setCountdown(3)}
                disabled={!!countdown}
              >
                Capture now
              </Button>
              <Button
                fullWidth
                variant="contained"
                onClick={() => setCountdown(3)}
                disabled={!!countdown}
              >
                Auto snap
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
                      ? "WHOA — your momentum is building. Keep showing up."
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
                  {(aiSession?.levers || ["Protein +25g today", "Train 2–3× this week"])
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
