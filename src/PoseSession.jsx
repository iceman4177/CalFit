// src/PoseSession.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useHistory } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import IosShareIcon from "@mui/icons-material/IosShare";
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
import { getPoseLandmarker, resetPoseLandmarker } from "./lib/poseLandmarker.js";

/**
 * GOALS (production-safe):
 * - Auto-capture only (no manual capture button)
 * - "LOCK-ON" progress driven by simple stability checks
 * - Guide outline is STATIC SVG (never flashes / never fat)
 * - AI analysis happens on 3 stills (ChatGPT-style). Send thumbnails to avoid 413.
 * - Shareable PNG uses full-res locals (crisp export).
 */

const POSES = [
  { key: "double_bi", title: "Double Bi", subtitle: "Elbows up · flex biceps · chin neutral", guide: "double_bi" },
  { key: "lat_spread", title: "Lat Spread", subtitle: "Elbows forward · widen lats · tall posture", guide: "lat_spread" },
  { key: "back_double_bi", title: "Back Double Bi", subtitle: "Turn around · elbows up · spread back", guide: "back_double_bi" },
];

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// --- Contain mapping helpers (safe + predictable) ---
function getContainVisibleRect(videoW, videoH, canvasW, canvasH) {
  // objectFit: contain => visible rect is centered
  const s = Math.min(canvasW / videoW, canvasH / videoH);
  const w = videoW * s;
  const h = videoH * s;
  const x = (canvasW - w) / 2;
  const y = (canvasH - h) / 2;
  return { x, y, w, h, s };
}

function mapLandmarksVideoToCanvas(lm, visRect) {
  // lm is normalized [0..1] in video space.
  // convert to canvas pixels respecting contain rect
  const { x, y, w, h } = visRect;
  return lm.map((p) => ({
    x: x + (p.x || 0) * w,
    y: y + (p.y || 0) * h,
    z: p.z,
    visibility: p.visibility,
  }));
}

function bboxFromLandmarks(points) {
  if (!Array.isArray(points) || points.length < 5) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
  const w = Math.max(0, maxX - minX);
  const h = Math.max(0, maxY - minY);
  if (w < 10 || h < 10) return null;
  return { x: minX, y: minY, w, h, cx: minX + w / 2, cy: minY + h / 2 };
}

async function captureFullResDataUrl(videoEl, facing = "user") {
  const vw = videoEl.videoWidth || 0;
  const vh = videoEl.videoHeight || 0;
  if (!vw || !vh) throw new Error("video_not_ready");

  const c = document.createElement("canvas");
  c.width = vw;
  c.height = vh;
  const ctx = c.getContext("2d");

  // Mirror user-facing so preview == capture.
  if (facing === "user") {
    ctx.translate(vw, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(videoEl, 0, 0, vw, vh);

  // PNG keeps text crisp for share card.
  return c.toDataURL("image/png");
}

async function toThumbnailDataUrl(fullPngDataUrl, maxW = 512, jpegQ = 0.78) {
  const img = new Image();
  img.src = fullPngDataUrl;
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
  });

  const w = img.naturalWidth || img.width || 1;
  const h = img.naturalHeight || img.height || 1;

  const scale = Math.min(1, maxW / w);
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));

  const c = document.createElement("canvas");
  c.width = tw;
  c.height = th;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, tw, th);

  return c.toDataURL("image/jpeg", clamp(jpegQ, 0.4, 0.9));
}

function GuideSvg({ variant = "double_bi" }) {
  // STATIC, smooth outline. Never depends on detection => no flashing.
  // Split into base + arms overlay.
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 10,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };

  return (
    <svg viewBox="0 0 300 500" width="100%" height="100%" aria-hidden="true">
      <g {...common}>
        {/* head */}
        <path d="M150 65c28 0 50 22 50 50s-22 50-50 50-50-22-50-50 22-50 50-50z" />
        {/* shoulders / upper torso */}
        <path d="M110 165c10 35 25 55 40 65s30 10 40 0 30-30 40-65" />
        {/* core */}
        <path d="M120 230c0 75 10 140 30 190" />
        <path d="M180 230c0 75-10 140-30 190" />
        {/* legs */}
        <path d="M150 420c-25 0-45 20-45 45" />
        <path d="M150 420c25 0 45 20 45 45" />
      </g>

      {/* pose arms overlay */}
      {variant === "double_bi" ? (
        <g {...common}>
          <path d="M120 205c-35 10-60 35-70 70" />
          <path d="M50 275c25 5 45-5 60-30" />
          <path d="M180 205c35 10 60 35 70 70" />
          <path d="M250 275c-25 5-45-5-60-30" />
        </g>
      ) : null}

      {variant === "lat_spread" ? (
        <g {...common}>
          <path d="M115 215c-45 10-75 40-90 85" />
          <path d="M185 215c45 10 75 40 90 85" />
        </g>
      ) : null}

      {variant === "back_double_bi" ? (
        <g {...common}>
          <path d="M120 205c-40 15-65 40-75 80" />
          <path d="M180 205c40 15 65 40 75 80" />
          <path d="M75 305c15 0 30-10 40-25" />
          <path d="M225 305c-15 0-30-10-40-25" />
        </g>
      ) : null}
    </svg>
  );
}

function buildTierFromArc(arc = 70) {
  const a = clamp(arc, 0, 100);
  if (a >= 90) return "ELITE ARC";
  if (a >= 80) return "V-TAPER RISING";
  if (a >= 70) return "AESTHETIC BUILDING";
  if (a >= 60) return "FOUNDATION LOCKED";
  return "BASELINE LOADING";
}

async function scorePoseSessionWithAI({ poses, clientId }) {
  // Send THUMBNAILS to avoid 413; server returns positive-only JSON.
  const res = await fetch("/api/ai/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Id": clientId || "pose_session_guest",
    },
    body: JSON.stringify({
      feature: "pose_session",
      poses: poses.map((p) => ({
        poseKey: p.key,
        title: p.title,
        imageDataUrl: p.thumbDataUrl || p.dataUrl,
      })),
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(t || `ai_error_${res.status}`);
  }
  const j = await res.json();
  return j?.session || null;
}

export default function PoseSession() {
  const history = useHistory();
  const { user } = useAuth();
  const userId = user?.id || "guest";

  const todayISO = useMemo(() => localDayISO(), []);
  const prevHistory = useMemo(() => readPoseSessionHistory(userId), [userId]);
  const prevSession = prevHistory?.[0] || null;

  const [phase, setPhase] = useState("intro"); // intro | capture | results
  const [step, setStep] = useState(0);
  const [cameraFacing, setCameraFacing] = useState("user");

  const [lockPct, setLockPct] = useState(0);
  const [checks, setChecks] = useState({ centered: false, farEnough: false, still: false });

  const [captures, setCaptures] = useState([]); // {key,title,dataUrl,thumbDataUrl}
  const [busy, setBusy] = useState(false);
  const [aiSession, setAiSession] = useState(null);
  const [aiError, setAiError] = useState("");

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);

  const detectRef = useRef({
    lastDetectAt: 0,
    lastGoodAt: 0,
    okFrames: 0,
    prevCx: null,
    prevCy: null,
    prevT: 0,
    lastSnapAt: 0,
    errStreak: 0,
  });

  const stopStream = useCallback(() => {
    try {
      const s = streamRef.current;
      if (s) {
        for (const tr of s.getTracks()) tr.stop();
      }
    } catch {}
    streamRef.current = null;
  }, []);

  const startStream = useCallback(async () => {
    stopStream();
    const constraints = {
      audio: false,
      video: {
        facingMode: cameraFacing === "environment" ? { ideal: "environment" } : "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    streamRef.current = stream;

    const v = videoRef.current;
    if (v) {
      v.srcObject = stream;
      await v.play().catch(() => {});
    }
  }, [cameraFacing, stopStream]);

  const begin = useCallback(async () => {
    setAiError("");
    setAiSession(null);
    setCaptures([]);
    setStep(0);
    setLockPct(0);
    setChecks({ centered: false, farEnough: false, still: false });
    setPhase("capture");

    // reset detector state
    detectRef.current = {
      lastDetectAt: 0,
      lastGoodAt: 0,
      okFrames: 0,
      prevCx: null,
      prevCy: null,
      prevT: 0,
      lastSnapAt: 0,
      errStreak: 0,
    };

    await startStream();
  }, [startStream]);

  const retake = useCallback(() => {
    // Retake current pose: drop the last capture and resume capture phase
    setCaptures((prev) => prev.slice(0, Math.max(0, step)));
    setAiSession(null);
    setAiError("");
    setBusy(false);
    setLockPct(0);
    setChecks({ centered: false, farEnough: false, still: false });
    setPhase("capture");
    // reset snap cooldown so we don't instantly re-snap
    detectRef.current.lastSnapAt = nowMs();
  }, [step]);

  const finishAndScore = useCallback(
    async (finalCaptures) => {
      setBusy(true);
      setAiError("");
      try {
        const clientId = `pose_session:${userId}:${todayISO}`;
        const session = await scorePoseSessionWithAI({ poses: finalCaptures, clientId });

        const fallback = session || {
          local_day: todayISO,
          build_arc: 78,
          hype: prevSession ? "Momentum is stacking. Keep showing up." : "Clean baseline captured. You’re set up to level up fast.",
          highlights: prevSession
            ? ["Pose control improving", "Shoulders + arms reading sharper", "Good consistency"]
            : ["Clean baseline", "Solid posture + symmetry", "Good frame control"],
          muscleSignals: {},
        };

        // Persist lightweight session record (no large images).
        const record = {
          id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
          local_day: todayISO,
          build_arc: clamp(fallback.build_arc || 70, 0, 100),
          hype: String(fallback.hype || ""),
          highlights: Array.isArray(fallback.highlights) ? fallback.highlights.slice(0, 5) : [],
          muscleSignals: fallback.muscleSignals || fallback.signals || {},
        };

        appendPoseSession(userId, record, 30);
        setAiSession(record);
        setPhase("results");
      } catch (e) {
        setAiError(String(e?.message || e || "AI error"));
        setPhase("results");
      } finally {
        setBusy(false);
      }
    },
    [prevSession, todayISO, userId]
  );

  const doShare = useCallback(async () => {
    try {
      // Use FULL-RES images for crisp export.
      const png = await buildPoseSessionSharePng({
        poses: captures.map((c) => ({
          key: c.key,
          title: c.title,
          imageDataUrl: c.dataUrl,
        })),
        session: aiSession,
      });

      await shareOrDownloadPng(png, {
        filename: `slimcal_build_arc_${todayISO}.png`,
        shareTitle: "Slimcal.ai • Build Arc",
        shareText: "Drop your Build Arc — #SlimcalAI",
      });
    } catch (e) {
      console.error("[PoseSession] share error:", e);
      setAiError("Couldn’t generate share card. Try again.");
    }
  }, [aiSession, captures, todayISO]);

  // Detection loop: light, low-FPS, stability-only.
  useEffect(() => {
    if (phase !== "capture") return;

    let alive = true;
    let landmarker = null;

    const run = async () => {
      try {
        landmarker = await getPoseLandmarker();
      } catch (e) {
        console.error("[PoseSession] landmarker init error:", e);
        return;
      }

      const v = videoRef.current;
      if (!v) return;

      const tick = async () => {
        if (!alive) return;
        rafRef.current = requestAnimationFrame(tick);

        const t = nowMs();
        const st = detectRef.current;

        // Avoid inference when tab hidden / video not ready.
        const ready =
          !document.hidden &&
          v.readyState >= 2 &&
          (v.videoWidth || 0) > 0 &&
          (v.videoHeight || 0) > 0 &&
          Number.isFinite(v.currentTime);

        if (!ready) {
          // keep last-good lock for a moment (no flashing UX)
          const age = t - (st.lastGoodAt || 0);
          if (age > 900) {
            setChecks({ centered: false, farEnough: false, still: false });
            setLockPct((p) => Math.max(0, p - 0.03));
          }
          return;
        }

        // Low FPS detection for stability (8-10fps max)
        if (t - (st.lastDetectAt || 0) < 120) return;
        st.lastDetectAt = t;

        // Use viewport to map landmarks into the *display* space (contain)
        const canvasW = v.clientWidth || 360;
        const canvasH = v.clientHeight || 640;
        const vis = getContainVisibleRect(v.videoWidth, v.videoHeight, canvasW, canvasH);

        let lmCanvas = null;
        let bb = null;

        try {
          const r = landmarker.detectForVideo(v, t);
          const lm = r?.landmarks?.[0] || null;
          if (lm && lm.length >= 20) {
            lmCanvas = mapLandmarksVideoToCanvas(lm, vis);
            bb = bboxFromLandmarks(lmCanvas);
          }
          st.errStreak = 0;
        } catch (e) {
          st.errStreak = (st.errStreak || 0) + 1;
          const msg = String(e?.message || e || "");
          const poisoned =
            msg.includes("roi->width") ||
            msg.includes("ROI width") ||
            msg.includes("texImage2D") ||
            msg.includes("no video") ||
            msg.includes("Framebuffer is incomplete") ||
            msg.includes("Graph has errors");

          if (poisoned && st.errStreak >= 2) {
            st.errStreak = 0;
            try {
              await resetPoseLandmarker();
            } catch {}
          }
          return;
        }

        if (!bb) {
          // hold last good for a moment
          const age = t - (st.lastGoodAt || 0);
          if (age > 900) {
            setChecks({ centered: false, farEnough: false, still: false });
            setLockPct((p) => Math.max(0, p - 0.05));
          }
          return;
        }

        st.lastGoodAt = t;

        // --- checks ---
        const cx = bb.cx;
        const cy = bb.cy;
        const frameCx = canvasW / 2;
        const frameCy = canvasH / 2;

        const centered =
          Math.abs(cx - frameCx) <= canvasW * 0.12 &&
          Math.abs(cy - frameCy) <= canvasH * 0.14;

        const farEnough =
          bb.w >= canvasW * 0.34 &&
          bb.w <= canvasW * 0.86 &&
          bb.h >= canvasH * 0.42 &&
          bb.h <= canvasH * 0.93;

        // movement threshold: based on bbox size
        const prevCx = st.prevCx;
        const prevCy = st.prevCy;
        const dt = Math.max(1, t - (st.prevT || t));
        st.prevT = t;
        st.prevCx = cx;
        st.prevCy = cy;

        let still = false;
        if (prevCx != null && prevCy != null) {
          const dx = cx - prevCx;
          const dy = cy - prevCy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const thresh = Math.max(2, Math.min(canvasW, canvasH) * 0.012);
          // require low movement for ~0.5s
          still = dist <= thresh;
        } else {
          still = false;
        }

        const okNow = centered && farEnough && still;

        if (okNow) st.okFrames = (st.okFrames || 0) + 1;
        else st.okFrames = Math.max(0, (st.okFrames || 0) - 2);

        const pct = clamp((st.okFrames || 0) / 12, 0, 1);
        setChecks({ centered, farEnough, still });
        setLockPct(pct);

        // --- auto snap ---
        const cooldownOk = t - (st.lastSnapAt || 0) > 900;
        if (pct >= 1 && cooldownOk && !busy) {
          st.lastSnapAt = t;

          try {
            const full = await captureFullResDataUrl(v, cameraFacing);
            const thumb = await toThumbnailDataUrl(full, 512, 0.78);

            const curPose = POSES[step] || POSES[0];
            const nextCapture = {
              key: curPose.key,
              title: curPose.title,
              dataUrl: full,
              thumbDataUrl: thumb,
            };

            const nextList = [...captures.slice(0, step), nextCapture];
            setCaptures(nextList);

            // advance or finish
            if (step >= POSES.length - 1) {
              stopStream();
              setPhase("results"); // show skeleton while AI runs
              await finishAndScore(nextList);
            } else {
              setStep((s) => Math.min(POSES.length - 1, s + 1));
              // reset lock so it feels intentional
              st.okFrames = 0;
              setLockPct(0);
              setChecks({ centered: false, farEnough: false, still: false });
            }
          } catch (e) {
            console.error("[PoseSession] capture error:", e);
            // soften: just reduce lock and keep going
            st.okFrames = 0;
            setLockPct(0);
          }
        }
      };

      rafRef.current = requestAnimationFrame(tick);
    };

    run();

    return () => {
      alive = false;
      try {
        cancelAnimationFrame(rafRef.current);
      } catch {}
    };
  }, [phase, step, cameraFacing, captures, busy, stopStream, finishAndScore]);

  useEffect(() => {
    // cleanup on unmount
    return () => {
      try {
        cancelAnimationFrame(rafRef.current);
      } catch {}
      stopStream();
    };
  }, [stopStream]);

  const curPose = POSES[step] || POSES[0];

  const arc = clamp(aiSession?.build_arc ?? 78, 0, 100);
  const tier = buildTierFromArc(arc);

  const deltas = useMemo(() => {
    if (!prevSession || !aiSession) return null;
    return computeDeltasPositiveOnly(prevSession, aiSession);
  }, [prevSession, aiSession]);

  return (
    <Box sx={{ p: 2, maxWidth: 720, mx: "auto" }}>
      {/* Top row */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => history.push("/evaluate")}
          sx={{ color: "rgba(220,255,245,0.9)" }}
        >
          Back
        </Button>

        {phase === "capture" ? (
          <Button
            startIcon={<FlipCameraAndroidIcon />}
            onClick={() => setCameraFacing((f) => (f === "user" ? "environment" : "user"))}
            sx={{ color: "rgba(220,255,245,0.9)" }}
          >
            Flip
          </Button>
        ) : null}
      </Stack>

      {phase === "intro" ? (
        <Card sx={{ borderRadius: 4, background: "#0b0f14", color: "#eafffb", overflow: "hidden" }}>
          <CardContent>
            <Typography variant="h4" sx={{ fontWeight: 950, letterSpacing: 0.3 }}>
              AI Physique Tracker
            </Typography>
            <Typography sx={{ mt: 0.5, color: "rgba(220,255,245,0.85)" }}>
              3 poses · 15 seconds · shareable results
            </Typography>

            <Divider sx={{ my: 2, borderColor: "rgba(0,255,190,0.18)" }} />

            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
              {POSES.map((p) => (
                <Box
                  key={p.key}
                  sx={{
                    flex: 1,
                    borderRadius: 3,
                    border: "1px solid rgba(0,255,190,0.16)",
                    background: "rgba(0,255,190,0.04)",
                    p: 1,
                    textAlign: "center",
                  }}
                >
                  <Box sx={{ width: "100%", aspectRatio: "1 / 1.15", opacity: 0.7 }}>
                    <GuideSvg variant={p.guide} />
                  </Box>
                  <Typography sx={{ mt: 0.5, fontWeight: 900, fontSize: 12 }}>{p.title}</Typography>
                </Box>
              ))}
            </Stack>

            <Stack spacing={1} sx={{ color: "rgba(220,255,245,0.85)" }}>
              <Typography sx={{ fontWeight: 800 }}>✅ Auto-captures when locked</Typography>
              <Typography sx={{ fontWeight: 800 }}>✅ Private — you control sharing</Typography>
            </Stack>

            <Button
              fullWidth
              variant="contained"
              onClick={begin}
              sx={{
                mt: 2.2,
                py: 1.35,
                borderRadius: 999,
                fontWeight: 950,
                letterSpacing: 0.6,
                background:
                  "linear-gradient(90deg, rgba(0,255,190,0.85), rgba(80,210,255,0.9))",
                color: "#041018",
                boxShadow: "0 0 26px rgba(0,255,190,0.25)",
                "&:hover": {
                  background:
                    "linear-gradient(90deg, rgba(0,255,190,0.92), rgba(80,210,255,0.98))",
                },
              }}
            >
              Start Scan
            </Button>

            <Typography sx={{ mt: 1, fontSize: 12, color: "rgba(220,255,245,0.7)", textAlign: "center" }}>
              Unlock your Build Arc Card
            </Typography>
          </CardContent>
        </Card>
      ) : null}

      {phase === "capture" ? (
        <Card sx={{ borderRadius: 4, background: "#0b0f14", color: "#eafffb", overflow: "hidden" }}>
          <CardContent>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography sx={{ fontWeight: 950, fontSize: 18 }}>
                Pose {step + 1} of {POSES.length}
              </Typography>
              <Button onClick={retake} sx={{ color: "rgba(220,255,245,0.85)" }}>
                Retake
              </Button>
            </Stack>

            <Box
              sx={{
                mt: 1.5,
                position: "relative",
                width: "100%",
                aspectRatio: "9 / 16",
                borderRadius: 4,
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

              {/* Static guide overlay */}
              <Box
                className="poseGuide"
                sx={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  pointerEvents: "none",
                  color: "rgba(120,255,220,0.95)",
                  filter:
                    "drop-shadow(0 0 10px rgba(120,255,220,0.55)) drop-shadow(0 0 22px rgba(120,255,220,0.35))",
                  opacity: 0.95,
                }}
              >
                <Box sx={{ width: "78%", height: "92%" }}>
                  <GuideSvg variant={curPose.guide} />
                </Box>
              </Box>

              {/* Lock-on HUD */}
              <Box
                sx={{
                  position: "absolute",
                  left: 10,
                  bottom: 10,
                  right: 10,
                  p: 1,
                  borderRadius: 3,
                  background: "rgba(0,0,0,0.55)",
                  border: lockPct >= 1 ? "1px solid rgba(0,255,190,0.55)" : "1px solid rgba(0,255,190,0.18)",
                }}
              >
                <Typography sx={{ fontWeight: 950, textAlign: "center", letterSpacing: 2 }}>
                  LOCK-ON
                </Typography>

                <Box
                  sx={{
                    mt: 1,
                    height: 10,
                    borderRadius: 999,
                    background: "rgba(0,255,190,0.14)",
                    overflow: "hidden",
                    border: "1px solid rgba(0,255,190,0.18)",
                  }}
                >
                  <Box
                    sx={{
                      height: "100%",
                      width: `${Math.round(lockPct * 100)}%`,
                      background:
                        "linear-gradient(90deg, rgba(0,255,190,0.85), rgba(80,210,255,0.9))",
                      transition: "width 120ms linear",
                    }}
                  />
                </Box>

                <Stack direction="row" spacing={1.2} sx={{ mt: 1, justifyContent: "center", flexWrap: "wrap" }}>
                  <Typography sx={{ fontSize: 12, opacity: checks.centered ? 1 : 0.6 }}>
                    {checks.centered ? "✅" : "⬜"} Centered
                  </Typography>
                  <Typography sx={{ fontSize: 12, opacity: checks.farEnough ? 1 : 0.6 }}>
                    {checks.farEnough ? "✅" : "⬜"} Far enough
                  </Typography>
                  <Typography sx={{ fontSize: 12, opacity: checks.still ? 1 : 0.6 }}>
                    {checks.still ? "✅" : "⬜"} Hold still
                  </Typography>
                </Stack>
              </Box>
            </Box>

            <Typography sx={{ mt: 1.25, fontWeight: 950, fontSize: 22, textAlign: "center" }}>
              {curPose.title}
            </Typography>
            <Typography sx={{ mt: 0.25, color: "rgba(220,255,245,0.8)", textAlign: "center" }}>
              {curPose.subtitle}
            </Typography>

            <Typography sx={{ mt: 1.25, fontSize: 12, color: "rgba(220,255,245,0.7)", textAlign: "center" }}>
              Auto-captures when locked — hold your pose.
            </Typography>
          </CardContent>
        </Card>
      ) : null}

      {phase === "results" ? (
        <Card sx={{ mt: 1, borderRadius: 4, background: "#0b0f14", color: "#eafffb", overflow: "hidden" }}>
          <CardContent>
            <Typography variant="h5" sx={{ fontWeight: 950, textAlign: "center" }}>
              Slimcal.ai
            </Typography>
            <Typography sx={{ mt: 0.25, textAlign: "center", color: "rgba(220,255,245,0.85)", fontWeight: 900 }}>
              Build Arc
            </Typography>

            <Box
              sx={{
                mt: 1.25,
                p: 1.5,
                borderRadius: 4,
                border: "1px solid rgba(0,255,190,0.18)",
                background: "rgba(0,255,190,0.05)",
              }}
            >
              <Typography sx={{ fontWeight: 950, textAlign: "center", letterSpacing: 1.2 }}>
                {tier}
              </Typography>
              <Box
                sx={{
                  mt: 1.1,
                  px: 1.2,
                  py: 0.9,
                  borderRadius: 999,
                  border: "1px solid rgba(0,255,190,0.22)",
                  background: "rgba(0,0,0,0.35)",
                }}
              >
                <Typography sx={{ textAlign: "center", fontWeight: 950 }}>
                  AESTHETIC: {(arc / 10).toFixed(1)}/10
                </Typography>
              </Box>
              {deltas ? (
                <Typography sx={{ mt: 1, textAlign: "center", fontSize: 12, color: "rgba(220,255,245,0.78)" }}>
                  Since last: <b>+{deltas.since_points || 0}</b>
                </Typography>
              ) : null}
            </Box>

            <Divider sx={{ my: 2, borderColor: "rgba(0,255,190,0.18)" }} />

            <Typography sx={{ fontWeight: 950 }}>WHAT’S POPPING</Typography>
            <Stack spacing={0.9} sx={{ mt: 1 }}>
              {(aiSession?.highlights || [
                "Upper chest looks fuller",
                "Lats widening — clean taper",
                "Arms reading thicker from all angles",
              ])
                .slice(0, 3)
                .map((t, idx) => (
                  <Box
                    key={idx}
                    sx={{
                      p: 1,
                      borderRadius: 3,
                      background: "rgba(0,255,190,0.05)",
                      border: "1px solid rgba(0,255,190,0.14)",
                    }}
                  >
                    <Typography sx={{ fontWeight: 850 }}>{t}</Typography>
                  </Box>
                ))}
            </Stack>

            <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
              {captures.slice(0, 3).map((c) => (
                <Box
                  key={c.key}
                  sx={{
                    flex: 1,
                    borderRadius: 3,
                    overflow: "hidden",
                    border: "1px solid rgba(0,255,190,0.18)",
                    background: "#000",
                  }}
                >
                  <Box
                    component="img"
                    src={c.thumbDataUrl || c.dataUrl}
                    alt={c.title}
                    sx={{ width: "100%", height: 110, objectFit: "cover", display: "block" }}
                  />
                  <Typography sx={{ p: 0.8, fontWeight: 900, fontSize: 12, textAlign: "center" }}>
                    {c.title}
                  </Typography>
                </Box>
              ))}
            </Stack>

            <Typography sx={{ mt: 1.4, textAlign: "center", fontSize: 12, color: "rgba(220,255,245,0.7)" }}>
              Drop your Build Arc — <b>#SlimcalAI</b>
            </Typography>

            {aiError ? (
              <Typography sx={{ mt: 1.2, color: "rgba(255,160,160,0.95)", fontSize: 12, textAlign: "center" }}>
                {aiError}
              </Typography>
            ) : null}

            <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
              <Button fullWidth variant="outlined" onClick={() => setPhase("intro")}>
                New Session
              </Button>
              <Button
                fullWidth
                variant="contained"
                startIcon={<IosShareIcon />}
                onClick={doShare}
                disabled={busy || captures.length < 2}
                sx={{
                  fontWeight: 950,
                  background:
                    "linear-gradient(90deg, rgba(0,255,190,0.85), rgba(80,210,255,0.9))",
                  color: "#041018",
                  "&:hover": {
                    background:
                      "linear-gradient(90deg, rgba(0,255,190,0.92), rgba(80,210,255,0.98))",
                  },
                }}
              >
                Share
              </Button>
            </Stack>

            <Typography sx={{ mt: 1.2, textAlign: "center", fontSize: 12, color: "rgba(220,255,245,0.7)" }}>
              Tap Share to copy a caption + hashtags
            </Typography>
          </CardContent>
        </Card>
      ) : null}
    </Box>
  );
}
