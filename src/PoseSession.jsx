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
import maleFrontOutline from "./assets/poseGhosts/male_front_outline.png";
import maleSideOutline from "./assets/poseGhosts/male_side_outline.png";
import maleBackOutline from "./assets/poseGhosts/male_back_outline.png";
import femaleFrontOutline from "./assets/poseGhosts/female_front_outline.png";
import femaleSideOutline from "./assets/poseGhosts/female_side_outline.png";
import femaleBackOutline from "./assets/poseGhosts/female_back_outline.png";

import { useAuth } from "./context/AuthProvider";
import { buildPoseSessionSharePng } from "./lib/poseSessionSharePng.js";
import { shareOrDownloadPng } from "./lib/frameCheckSharePng.js";
import FeatureUseBadge, {
  canUseDailyFeature,
  registerDailyFeatureUse,
  getDailyRemaining,
  setDailyRemaining,
} from "./components/FeatureUseBadge.jsx";
import {
  readPoseSessionHistory,
  appendPoseSession,
  computeDeltasPositiveOnly,
  localDayISO,
  buildRecentPoseContext,
} from "./lib/poseSessionStore.js";
import { postAI, getAIQuotaStatus } from "./lib/ai";

const MALE_POSES = [
  { key: "front_double_bi", title: "Double Bi", subtitle: "Elbows up · flex biceps · chin neutral" },
  { key: "lat_spread", title: "Front Lat Spread", subtitle: "Hands near waist · flare lats wide · elbows slightly forward" },
  { key: "back_double_bi", title: "Back Double Bi", subtitle: "Turn around · elbows up · spread back" },
];

const FEMALE_POSES = [
  { key: "front_scan", title: "Front Scan", subtitle: "Face forward · stand tall · arms relaxed slightly away from sides" },
  { key: "side_scan", title: "Side Scan", subtitle: "Turn sideways · stand tall · keep posture natural" },
  { key: "back_scan", title: "Back Scan", subtitle: "Turn around · stand tall · keep shoulders relaxed" },
];

const CAPTURE_DELAY_MS = 5000; // selfie timer (simple + reliable)
const OUTLINE_PULSE_MS = 2000;

const ALL_OUTLINE_ASSETS = [
  maleFrontOutline,
  maleSideOutline,
  maleBackOutline,
  femaleFrontOutline,
  femaleSideOutline,
  femaleBackOutline,
];

function readStoredGoalType() {
  try {
    const raw = localStorage.getItem("userData");
    if (raw) {
      const parsed = JSON.parse(raw);
      const g = String(parsed?.goalType || parsed?.goal || "").toLowerCase().trim();
      if (g) return g;
    }
  } catch {}
  try {
    const g = String(localStorage.getItem("fitness_goal") || "").toLowerCase().trim();
    if (g) return g;
  } catch {}
  return "maintenance";
}

function readStoredGender() {
  try {
    const raw = localStorage.getItem("userData");
    if (raw) {
      const parsed = JSON.parse(raw);
      const g = String(parsed?.gender || "").toLowerCase().trim();
      if (g === "male" || g === "female") return g;
    }
  } catch {}
  try {
    const g = String(localStorage.getItem("gender") || "").toLowerCase().trim();
    if (g === "male" || g === "female") return g;
  } catch {}
  return "male";
}

function readStoredIsPro() {
  try {
    return localStorage.getItem("isPro") === "true";
  } catch {}
  return false;
}

function getOrCreateClientId() {
  try {
    let id = localStorage.getItem("slimcal_client_id");
    if (id) return id;
    id = (globalThis.crypto?.randomUUID?.() || `slimcal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    localStorage.setItem("slimcal_client_id", id);
    return id;
  } catch {}
  return `slimcal-${Date.now()}`;
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = String(v || "").trim();
    if (s) return s;
  }
  return "";
}

function buildMemoryAwareShareSummary(result, isFemale = false) {
  const strongest = firstNonEmpty(
    result?.physiqueSnapshot?.summary_seed?.strongest_feature,
    Array.isArray(result?.bestDeveloped) ? result.bestDeveloped[0] : "",
    Array.isArray(result?.highlights) ? result.highlights[0] : ""
  );

  const momentum = String(result?.momentumNote || "").trim();
  const baseline = String(result?.baselineComparison || "").trim();
  const summary = String(result?.report || "").split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)[0] || "";

  const softStrongest = strongest
    ? (isFemale ? `Today your ${strongest} reads especially polished.` : `Today your ${strongest} reads especially strong.`)
    : (isFemale ? "Today your overall look reads polished and athletic." : "Today your overall look reads muscular and athletic.");

  const lead = firstNonEmpty(momentum, baseline, summary, softStrongest)
    .replace(/\s+/g, " ")
    .replace(/Compared with \d+ recent checks?,?/i, "Compared with your recent baseline,")
    .trim();

  const closer = firstNonEmpty(baseline, softStrongest)
    .replace(/\s+/g, " ")
    .trim();

  const joined = [lead, closer]
    .filter(Boolean)
    .filter((v, i, arr) => arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i)
    .join(" ")
    .trim();

  return joined.slice(0, 240);
}


function PoseGhostOverlay({ poseKey, mirrored = false, active = false }) {
  const isFemaleCue = /_scan$/.test(String(poseKey || ""));
  const imageMap = {
    front_double_bi: maleFrontOutline,
    lat_spread: maleFrontOutline,
    back_double_bi: maleBackOutline,
    front_scan: femaleFrontOutline,
    side_scan: femaleSideOutline,
    back_scan: femaleBackOutline,
  };

  const src = imageMap[poseKey] || maleFrontOutline;
  const frameWidth = isFemaleCue ? "min(74%, 360px)" : "min(90%, 440px)";
  const frameBorder = isFemaleCue ? "1px solid rgba(255,105,180,0.16)" : "1px solid rgba(57,255,20,0.24)";
  const frameBg = isFemaleCue ? "rgba(36, 8, 22, 0.04)" : "rgba(5, 20, 12, 0.04)";
  const frameShadow = isFemaleCue
    ? "0 0 28px rgba(255,105,180,0.10), inset 0 0 18px rgba(255,105,180,0.04)"
    : "0 0 36px rgba(57,255,20,0.16), inset 0 0 22px rgba(57,255,20,0.07)";

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
          width: frameWidth,
          aspectRatio: "3 / 4",
          borderRadius: "32px",
          border: frameBorder,
          bgcolor: frameBg,
          boxShadow: active ? frameShadow : "none",
          overflow: "hidden",
          transform: mirrored ? "scaleX(-1)" : "none",
          animation: active ? "matrixPulse 1.1s ease-in-out infinite" : "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Box
          component="img"
          src={src}
          alt=""
          aria-hidden="true"
          sx={{
            width: isFemaleCue ? "68%" : "82%",
            height: "auto",
            objectFit: "contain",
            opacity: isFemaleCue ? 0.96 : 0.92,
            filter: isFemaleCue
              ? "drop-shadow(0 0 12px rgba(255,105,180,0.45)) drop-shadow(0 0 24px rgba(255,105,180,0.22))"
              : "hue-rotate(-18deg) saturate(2.1) brightness(0.9) drop-shadow(0 0 12px rgba(57,255,20,0.50)) drop-shadow(0 0 24px rgba(57,255,20,0.24))",
            userSelect: "none",
            WebkitUserDrag: "none",
          }}
        />
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
  const gender = useMemo(() => readStoredGender(), []);
  const goalType = useMemo(() => readStoredGoalType(), []);
  const isFemale = gender === "female";
  const activePoses = useMemo(() => (isFemale ? FEMALE_POSES : MALE_POSES), [isFemale]);
  const outlineColor = isFemale ? "rgba(255, 105, 180, 0.95)" : "rgba(57, 255, 20, 0.95)";

  const [stage, setStage] = useState("intro"); // intro | capture | scanning | results
  const [poseIdx, setPoseIdx] = useState(0);
  const [facingMode, setFacingMode] = useState("user");

  const [countdownMs, setCountdownMs] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const pageTopRef = useRef(null);

  const [captures, setCaptures] = useState([]); // { poseKey, title, fullDataUrl, thumbDataUrl }
  const [result, setResult] = useState(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [isPro, setIsPro] = useState(() => readStoredIsPro());

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const countdownRef = useRef(null);

  const pose = activePoses[poseIdx] || activePoses[0];

  const todayISO = useMemo(() => localDayISO(), []);
  const priorHistory = useMemo(() => readPoseSessionHistory(userId) || [], [userId]);
  const recentScanContext = useMemo(() => buildRecentPoseContext(priorHistory, 3), [priorHistory]);
  const deltas = useMemo(() => computeDeltasPositiveOnly(priorHistory), [priorHistory]);

  useEffect(() => {
    let active = true;
    const syncQuota = async () => {
      if (isPro || !user?.id) return;
      try {
        const q = await getAIQuotaStatus("pose_session");
        if (!active) return;
        if (typeof q?.remaining === "number") setDailyRemaining("pose_session", q.remaining);
      } catch {}
    };
    syncQuota();
    window.addEventListener("focus", syncQuota);
    return () => {
      active = false;
      window.removeEventListener("focus", syncQuota);
    };
  }, [isPro, user?.id]);

  useEffect(() => {
    ALL_OUTLINE_ASSETS.forEach((src) => {
      try {
        const img = new Image();
        img.decoding = "sync";
        img.loading = "eager";
        img.src = src;
      } catch {}
    });
  }, []);

  useEffect(() => {
    const refreshPro = () => setIsPro(readStoredIsPro());
    refreshPro();
    window.addEventListener("focus", refreshPro);
    window.addEventListener("slimcal:pro:refresh", refreshPro);
    return () => {
      window.removeEventListener("focus", refreshPro);
      window.removeEventListener("slimcal:pro:refresh", refreshPro);
    };
  }, []);

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
      if (poseIdx < activePoses.length - 1) {
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

  const goToIntro = useCallback(() => {
    setErrorMsg("");
    setCaptures([]);
    setResult(null);
    setPoseIdx(0);
    setStage("intro");
  }, []);

  const startScan = useCallback(() => {
    if (!isPro && !canUseDailyFeature("pose_session")) {
      setErrorMsg("Free limit reached (Pose Session: 3/day). Upgrade for unlimited scans.");
      try { sessionStorage.setItem("pose_session_force_upgrade", "1"); } catch {}
      try { window.dispatchEvent(new Event("slimcal:pose-session-upgrade")); } catch {}
      return;
    }
    setErrorMsg("");
    setCaptures([]);
    setResult(null);
    setPoseIdx(0);
    setStage("capture");
  }, [isPro]);

  const callAI = useCallback(async () => {
    if (captures.length < activePoses.length) return;
    setErrorMsg("");

    try {
      const payload = {
        feature: "pose_session",
        style: "detailed_muscle_groups_v1",
        gender,
        goalType,
        localDay: todayISO,
        scanMode: isFemale ? "female_pose_session" : "male_pose_session",
        poses: captures.map((c) => ({
          poseKey: c.poseKey,
          title: c.title,
          imageDataUrl: c.thumbDataUrl, // keep payload small
        })),
        deltas, // optional; app uses positive-only deltas
        recentScans: recentScanContext,
      };

      const json = await postAI("pose_session", payload);
      const session = json?.session || null;
      if (!isPro) {
        if (typeof json?.remaining === "number") setDailyRemaining("pose_session", json.remaining);
        else registerDailyFeatureUse("pose_session");
      }

      // Persist a small record for deltas
      try {
        appendPoseSession(userId, {
          id: `pose-${todayISO}`,
          local_day: todayISO,
          created_at: Date.now(),
          gender,
          goalType,
          scanMode: isFemale ? "female_pose_session" : "male_pose_session",
          build_arc: clamp(session?.build_arc ?? session?.buildArcScore ?? 78, 0, 100),
          muscleSignals: session?.muscleSignals || {},
          poseQuality: session?.poseQuality || {},
          momentumNote: session?.momentumNote || "",
          baselineComparison: session?.baselineComparison || "",
          strongestFeature: session?.physiqueSnapshot?.summary_seed?.strongest_feature || session?.bestDeveloped?.[0] || "",
          physiqueSnapshot: session?.physiqueSnapshot || null,
        });
      } catch {}

      setResult(session);
      setStage("results");
    } catch (e) {
      console.error(e);
      if (e?.code === 402) {
        setErrorMsg("Free limit reached (Pose Session: 3/day). Upgrade for unlimited scans.");
        setStage("intro");
        try { sessionStorage.setItem("pose_session_force_upgrade", "1"); } catch {}
        try { window.dispatchEvent(new Event("slimcal:pose-session-upgrade")); } catch {}
        return;
      }
      setErrorMsg("AI analysis failed. Please try again.");
      setStage("results");
      setResult(null);
    }
  }, [activePoses.length, captures, deltas, gender, goalType, isFemale, isPro, recentScanContext, todayISO, user?.id, userId]);

  useEffect(() => {
    if (stage !== "scanning") return;
    callAI();
  }, [stage, callAI]);

  const onShare = useCallback(async () => {
    if (!captures.length) return;
    setShareBusy(true);
    try {
      const shareSummary = buildMemoryAwareShareSummary(result, isFemale);
      const topWins = (Array.isArray(result?.bestDeveloped) && result.bestDeveloped.length
        ? result.bestDeveloped
        : (result?.highlights || result?.levers || [])
      ).slice(0, 3);
      const progressNotes = [result?.baselineComparison, result?.momentumNote]
        .map((t) => String(t || "").trim())
        .filter(Boolean)
        .filter((v, i, arr) => arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i)
        .slice(0, 2);

      const pngDataUrl = await buildPoseSessionSharePng({
        headline: isFemale ? "PHYSIQUE CHECK" : "PHYSIQUE CHECK",
        subhead: isFemale ? "Pretty, polished, and trending up" : "Built, sharp, and trending up",
        wins: topWins,
        levers: progressNotes,
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
  }, [captures, isFemale, result]);

  useEffect(() => {
    const run = () => {
      try {
        window.scrollTo({ top: 0, behavior: "auto" });
      } catch {}
      try {
        pageTopRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
      } catch {}
    };
    const id = window.setTimeout(run, 0);
    return () => window.clearTimeout(id);
  }, [stage, poseIdx]);

  const titleColor = "rgba(245,250,255,0.92)";
  const bodyColor = "rgba(220,235,245,0.86)";
  const outlinePulseActive = stage === "capture" && countdownMs > CAPTURE_DELAY_MS - OUTLINE_PULSE_MS;

  return (
    <>
      <Box sx={{ display: "none" }} aria-hidden="true">
        {ALL_OUTLINE_ASSETS.map((src) => (
          <Box key={src} component="img" src={src} alt="" sx={{ width: 1, height: 1 }} />
        ))}
      </Box>
      <Box ref={pageTopRef} sx={{ minHeight: "100svh", bgcolor: "#0b0f14", display: "flex", justifyContent: "center", p: { xs: 0.5, md: 4 } }}>
      <Card
        sx={{
          width: "min(980px, 100%)",
          bgcolor: "#0c1218",
          borderRadius: "28px",
          border: "1px solid rgba(120,255,220,0.18)",
          boxShadow: "0 0 24px rgba(0,0,0,0.45)",
          overflow: "hidden",
          minHeight: { xs: "100svh", md: "auto" },
        }}
      >
        <CardContent sx={{ p: { xs: 0.9, md: 3 }, minHeight: { xs: "100svh", md: "auto" }, display: "flex", flexDirection: "column" }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: { xs: 1, md: 2 } }}>
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
                  onClick={goToIntro}
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
            <Stack spacing={{ xs: 0.9, md: 2.2 }} sx={{ flex: 1, minHeight: 0 }}>
              <Typography variant="h4" sx={{ color: titleColor, fontWeight: 800, letterSpacing: 0.2 }}>
                AI Physique Tracker
              </Typography>
              <Stack spacing={1}>
                <Typography sx={{ color: bodyColor }}>
                  3 guided scans · 15 seconds · shareable results
                </Typography>
                <Box>
                  <FeatureUseBadge
                    featureKey="pose_session"
                    isPro={isPro}
                    labelPrefix="Free"
                    sx={{
                      color: "rgba(220,235,245,0.92)",
                      borderColor: "rgba(120,255,220,0.28)",
                      bgcolor: "rgba(255,255,255,0.02)",
                      '& .MuiChip-label': {
                        px: 1.1,
                        color: "rgba(220,235,245,0.92)",
                      },
                    }}
                  />
                </Box>
              </Stack>

              <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                {activePoses.map((p) => (
                  <Box
                    key={p.key}
                    sx={{
                      flex: 1,
                      borderRadius: 3,
                      border: "1px solid rgba(120,255,220,0.18)",
                      bgcolor: "rgba(0,0,0,0.22)",
                      p: { xs: 1.25, md: 2 },
                      textAlign: "center",
                    }}
                  >
                    <Box
                      sx={{
                        height: { xs: 52, md: 120 },
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
                    <Typography sx={{ color: bodyColor, fontSize: { xs: 12, md: 13 }, lineHeight: 1.35 }}>{p.subtitle}</Typography>
                  </Box>
                ))}
              </Stack>

              <Stack spacing={1} sx={{ display: { xs: "none", md: "flex" } }}>
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
                  mt: { xs: 0.5, md: 1 },
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
              <Typography sx={{ color: "rgba(180,220,230,0.6)", textAlign: "center", fontSize: { xs: 11, md: 12 } }}>
                Tip: step back so your full body shape is easy to read in frame.
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
            <Stack spacing={{ xs: 0.75, md: 2 }} sx={{ flex: 1, minHeight: 0 }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography sx={{ color: titleColor, fontWeight: 800 }}>
                  Pose {poseIdx + 1} of {activePoses.length}
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
                  width: { xs: "min(100%, 392px)", sm: "min(100%, 440px)", md: "100%" },
                  mx: "auto",
                  aspectRatio: { xs: "4 / 5", md: "3 / 4" },
                  height: { xs: "min(52svh, 520px)", md: "auto" },
                  maxHeight: { xs: "52svh", md: "none" },
                  borderRadius: 4,
                  overflow: "hidden",
                  border: "1px solid rgba(120,255,220,0.16)",
                  bgcolor: "#000",
                  flexShrink: 1,
                }}
              >
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: window.matchMedia && window.matchMedia("(max-width: 900px)").matches ? "cover" : "cover",
                    background: "#000",
                    transform: facingMode === "user" ? "scaleX(-1)" : "none",
                  }}
                />
                {/* Temporary matrix pose silhouette (no tracking) */}
                <PoseGhostOverlay
                  poseKey={pose.key}
                  mirrored={facingMode === "user"}
                  active={outlinePulseActive}
                  color={outlineColor}
                />
              </Box>

              <Box
                sx={{
                  mt: { xs: "auto", md: 1.25 },
                  display: "grid",
                  gap: { xs: 1, md: 1.2 },
                  pb: { xs: "calc(env(safe-area-inset-bottom, 0px) + 76px)", md: 0 },
                }}
              >
                <Box
                  sx={{
                    p: { xs: 1.2, md: 1.5 },
                    borderRadius: 3,
                    bgcolor: "rgba(0,0,0,0.55)",
                    border: "1px solid rgba(120,255,220,0.20)",
                    backdropFilter: "blur(6px)",
                  }}
                >
                  <Typography sx={{ color: "rgba(120,255,220,0.95)", fontWeight: 900, letterSpacing: 0.5, fontSize: { xs: 15, md: 16 } }}>
                    {pose.title}
                  </Typography>
                  <Typography sx={{ color: bodyColor, fontSize: { xs: 12.5, md: 13 }, mt: 0.35, lineHeight: 1.35 }}>
                    {pose.subtitle}
                  </Typography>

                  <Divider sx={{ my: { xs: 0.85, md: 1 }, borderColor: "rgba(255,255,255,0.08)" }} />

                  <Typography sx={{ color: "rgba(245,250,255,0.88)", fontSize: { xs: 12, md: 12.5 } }}>
                    Auto-capturing in{" "}
                    <b style={{ color: "rgba(120,255,220,0.95)" }}>
                      {Math.max(0, Math.ceil(countdownMs / 1000))}
                    </b>{" "}
                    …
                  </Typography>
                </Box>

                <Box
                  sx={{
                    px: { xs: 1.1, md: 2 },
                    py: { xs: 0.8, md: 1.1 },
                    borderRadius: 999,
                    border: "1px solid rgba(120,255,220,0.18)",
                    bgcolor: "rgba(0,0,0,0.22)",
                  }}
                >
                  <Typography sx={{ color: "rgba(120,255,220,0.9)", fontWeight: 900, textAlign: "center", letterSpacing: 2, fontSize: { xs: 11, md: 12 } }}>
                    LOCK-ON
                  </Typography>
                  <Box sx={{ mt: 0.8, height: 7, borderRadius: 999, bgcolor: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                    <Box
                      sx={{
                        height: "100%",
                        width: `${clamp(100 - (countdownMs / CAPTURE_DELAY_MS) * 100, 0, 100)}%`,
                        bgcolor: "rgba(120,255,220,0.85)",
                        boxShadow: "0 0 18px rgba(120,255,220,0.25)",
                      }}
                    />
                  </Box>
                  <Stack direction="row" spacing={0.75} justifyContent="center" sx={{ mt: 0.75, flexWrap: "wrap" }}>
                    <Chip label="Centered" size="small" sx={{ color: bodyColor, bgcolor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", height: { xs: 22, md: 32 }, fontSize: { xs: 11, md: 13 } }} />
                    <Chip label="Far enough" size="small" sx={{ color: bodyColor, bgcolor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", height: { xs: 22, md: 32 }, fontSize: { xs: 11, md: 13 } }} />
                    <Chip label="Hold still" size="small" sx={{ color: bodyColor, bgcolor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", height: { xs: 22, md: 32 }, fontSize: { xs: 11, md: 13 } }} />
                  </Stack>
                </Box>
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

              {(result?.momentumNote || result?.baselineComparison) ? (
                <Box
                  sx={{
                    p: 1.6,
                    borderRadius: 3,
                    bgcolor: "rgba(120,255,220,0.08)",
                    border: "1px solid rgba(120,255,220,0.18)",
                  }}
                >
                  <Typography sx={{ color: "rgba(120,255,220,0.95)", fontWeight: 900, letterSpacing: 0.4, mb: 0.5 }}>
                    MOMENTUM
                  </Typography>
                  {result?.momentumNote ? (
                    <Typography sx={{ color: bodyColor, lineHeight: 1.5 }}>
                      {String(result.momentumNote)}
                    </Typography>
                  ) : null}
                  {result?.baselineComparison ? (
                    <Typography sx={{ color: "rgba(220,235,245,0.72)", lineHeight: 1.45, mt: result?.momentumNote ? 0.9 : 0 }}>
                      {String(result.baselineComparison)}
                    </Typography>
                  ) : null}
                </Box>
              ) : null}

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
                    onClick={goToIntro}
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
    </>
  );
}
