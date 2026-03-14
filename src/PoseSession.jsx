import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
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
  LinearProgress,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import FlipCameraAndroidIcon from "@mui/icons-material/FlipCameraAndroid";
import maleFrontDoubleBicep from "./assets/poseGhosts/male_front_double_bicep.png";
import maleFrontLatSpread from "./assets/poseGhosts/male_front_lat_spread.png";
import maleBackDoubleBicep from "./assets/poseGhosts/male_back_double_bicep.png";
import femaleFrontPose from "./assets/poseGhosts/female_front_pose.png";
import femaleSidePose from "./assets/poseGhosts/female_side_pose.png";
import femaleBackPose from "./assets/poseGhosts/female_back_pose.png";

import { useAuth } from "./context/AuthProvider";
import { buildPoseSessionSharePng } from "./lib/poseSessionSharePng.js";
import { shareOrDownloadPng } from "./lib/frameCheckSharePng.js";
import FeatureUseBadge, {
  canUseDailyFeature,
  registerDailyFeatureUse,
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
  {
    key: "front_double_bi",
    title: "Double Bi",
    subtitle: "Elbows up · flex biceps · chin neutral",
  },
  {
    key: "lat_spread",
    title: "Lat Spread",
    subtitle: "Chest up · spread lats · stay tall",
  },
  {
    key: "back_double_bi",
    title: "Back Double Bi",
    subtitle: "Turn around · elbows up · spread back",
  },
];

const FEMALE_POSES = [
  {
    key: "front_scan",
    title: "Front Scan",
    subtitle:
      "Face forward · stand tall · arms relaxed slightly away from sides",
  },
  {
    key: "side_scan",
    title: "Side Scan",
    subtitle: "Turn sideways · stand tall · keep posture natural",
  },
  {
    key: "back_scan",
    title: "Back Scan",
    subtitle: "Turn around · stand tall · keep shoulders relaxed",
  },
];

const CAPTURE_DELAY_MS = 5000;
const OUTLINE_PULSE_MS = 2000;
const SCAN_PROGRESS_TICK_MS = 180;
const SCAN_PROGRESS_MAX_BEFORE_DONE = 92;

const ALL_OUTLINE_ASSETS = [
  maleFrontDoubleBicep,
  maleFrontLatSpread,
  maleBackDoubleBicep,
  femaleFrontPose,
  femaleSidePose,
  femaleBackPose,
];

function readStoredGoalType() {
  try {
    const raw = localStorage.getItem("userData");
    if (raw) {
      const parsed = JSON.parse(raw);
      const g = String(parsed?.goalType || parsed?.goal || "")
        .toLowerCase()
        .trim();
      if (g) return g;
    }
  } catch {}
  try {
    const g = String(localStorage.getItem("fitness_goal") || "")
      .toLowerCase()
      .trim();
    if (g) return g;
  } catch {}
  return "maintenance";
}

function readStoredGender() {
  try {
    const raw = localStorage.getItem("userData");
    if (raw) {
      const parsed = JSON.parse(raw);
      const g = String(parsed?.gender || "")
        .toLowerCase()
        .trim();
      if (g === "male" || g === "female") return g;
    }
  } catch {}
  try {
    const g = String(localStorage.getItem("gender") || "")
      .toLowerCase()
      .trim();
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

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = String(v || "").trim();
    if (s) return s;
  }
  return "";
}

function buildMemoryAwareShareSummary(result, isFemale = false) {
  const prebuilt = String(result?.shareCardSummary || "")
    .replace(/\s+/g, " ")
    .trim();
  if (prebuilt) return prebuilt.slice(0, 240);

  const strongest = firstNonEmpty(
    result?.physiqueSnapshot?.summary_seed?.strongest_feature,
    Array.isArray(result?.bestDeveloped) ? result.bestDeveloped[0] : "",
    Array.isArray(result?.highlights) ? result.highlights[0] : "",
  );
  const momentum = String(result?.momentumNote || "")
    .replace(/\s+/g, " ")
    .trim();
  const baseline = String(result?.baselineComparison || "")
    .replace(/\s+/g, " ")
    .trim();
  const firstHighlight = firstNonEmpty(
    Array.isArray(result?.highlights) ? result.highlights[0] : "",
  );
  const summary =
    String(result?.report || "")
      .split(/\n\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean)[0] || "";

  const fallback = strongest
    ? isFemale
      ? `Your ${strongest} is reading especially polished right now.`
      : `Your ${strongest} is reading especially strong right now.`
    : isFemale
      ? "Your overall look is landing polished and athletic right now."
      : "Your overall look is landing athletic and well put together right now.";

  const lead = firstNonEmpty(momentum, summary, baseline, fallback)
    .replace(
      /Compared with \d+ recent checks?,?/i,
      "Compared with your recent baseline,",
    )
    .trim();
  const closer = firstNonEmpty(
    firstHighlight ? `${firstHighlight}.` : "",
    baseline,
    fallback,
  )
    .replace(
      /Compared with \d+ recent checks?,?/i,
      "Compared with your recent baseline,",
    )
    .trim();

  const joined = [lead, closer]
    .filter(Boolean)
    .filter(
      (v, i, arr) =>
        arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i,
    )
    .join(" ")
    .trim();

  return joined.slice(0, 240);
}

const LOCKED_POSE_COPY = {
  male: {
    baseline: {
      mode: "Baseline Read",
      hero: "You look like you train.",
      subread:
        "You’ve already got a strong upper-body look, and the base is clearly there for an even more standout physique.",
      bulletsLabel: "WHAT STANDS OUT",
      bullets: [
        "Broad shoulders",
        "Solid upper-body presence",
        "Lean, athletic base",
      ],
      breakdown: [
        "Your shoulders read first, which gives you that trained look right away.",
        "Your upper body already has solid shape, and there’s enough structure there that it doesn’t look random or undeveloped.",
        "Your arms and upper torso are starting to come together nicely, and your frame gives off a clean athletic look already.",
        "From the back, there’s a good starting outline through the shoulders and upper back, which makes the physique feel more put together overall.",
      ],
      nextUp: [
        "You’re already looking lean and athletic, and you’re well on your way to looking even more built and dialed.",
        "Bringing more fullness through the chest, delts, and arms would make the strong look that’s already there read even bigger.",
      ],
      coachNote: [
        "This is a strong baseline because you’re not starting from zero.",
        "You already look like someone who trains, and if you keep stacking size while staying lean, this can turn into a seriously sharp physique.",
      ],
    },
    recheck: {
      mode: "Re-Check",
      hero: "Cleaner and more dialed.",
      subread:
        "This looks sharper than last time. The physique is tightening up, and the overall look feels more complete.",
      bulletsLabel: "WHAT IMPROVED",
      bullets: [
        "More upper-body definition",
        "Better shoulder pop",
        "Cleaner overall presentation",
      ],
      breakdown: [
        "Your upper body looks more dialed than before, especially through the shoulders and arms.",
        "There’s a cleaner look through the torso now, which makes the physique read sharper right away.",
        "Your back and shoulder area feel a little more developed, and the overall presentation comes across more confident and more trained.",
        "Compared to the last scan, this doesn’t just look similar — it looks more refined.",
      ],
      nextUp: [
        "You’re already looking fit and sculpted, and this is clearly moving toward an even more standout build.",
        "Keep pushing size in the upper body while holding onto the leanness that’s already showing, and this will separate fast.",
      ],
      coachNote: [
        "The big win here is that the progress is visible without needing to force it.",
        "You’re already carrying a sharper look, and if you keep the same consistency, the next jump should be even easier to notice.",
      ],
    },
  },
  female: {
    baseline: {
      mode: "Baseline Read",
      hero: "You’re looking toned.",
      subread:
        "Your shape already looks clean and put together, and the overall look is trending toward even more polished.",
      bulletsLabel: "WHAT STANDS OUT",
      bullets: [
        "Balanced, toned shape",
        "Lean waist",
        "Strong, put-together look",
      ],
      breakdown: [
        "Your physique already reads toned, especially through the waist and overall shape.",
        "There’s a clean athletic look here that feels balanced instead of forced, which makes the result come across polished.",
        "Your back and shoulders show nice definition, and the way your shape carries on camera gives the whole scan a confident feel.",
        "Your lower body also gives a strong foundation to the look, so overall this already feels like a fit, put-together baseline.",
      ],
      nextUp: [
        "You’re already looking lean and polished, and you’re well on your way to looking even more sculpted.",
        "Bringing a little more shape through the glutes and lower body would make this already polished look pop even harder.",
      ],
      coachNote: [
        "This is a really strong baseline because the shape is already there.",
        "You don’t need a complete transformation to look good — you already do — and the next phase is just about making the strengths show even more.",
      ],
    },
    recheck: {
      mode: "Re-Check",
      hero: "Sharper than last time.",
      subread:
        "This looks cleaner, more dialed, and more complete than your last scan.",
      bulletsLabel: "WHAT IMPROVED",
      bullets: [
        "More polished overall shape",
        "Better definition through the waist and back",
        "Stronger, more confident presentation",
      ],
      breakdown: [
        "Your physique looks more refined than before, especially through the waist, back, and overall shape.",
        "There’s a tighter, cleaner feel to the scan now, which makes the whole look come across more toned and more intentional.",
        "Your shoulders and upper back are reading with better definition, and the lower body shape feels more connected to the full look.",
        "Compared to the last scan, this feels more dialed and more obviously athletic.",
      ],
      nextUp: [
        "You’re already looking strong and toned, and this is clearly heading toward an even more sculpted version of the same look.",
        "Keep building shape where it counts while holding onto the polished look that’s already showing.",
      ],
      coachNote: [
        "What’s nice here is that the progress feels real and visible, not forced.",
        "You already had a good base, and now it’s starting to look more refined in a way people will actually notice.",
      ],
    },
  },
};

function getLockedPoseCopy(gender = "male", hasPriorSameGender = false) {
  const g = gender === "female" ? "female" : "male";
  return LOCKED_POSE_COPY[g][hasPriorSameGender ? "recheck" : "baseline"];
}

function PoseGhostOverlay({ poseKey, mirrored = false, active = false }) {
  const isFemaleCue = /_scan$/.test(String(poseKey || ""));
  const imageMap = {
    front_double_bi: maleFrontDoubleBicep,
    lat_spread: maleFrontLatSpread,
    back_double_bi: maleBackDoubleBicep,
    front_scan: femaleFrontPose,
    side_scan: femaleSidePose,
    back_scan: femaleBackPose,
  };

  const src = imageMap[poseKey] || maleFrontDoubleBicep;
  const fitMap = {
    front_double_bi: {
      width: { xs: "74%", md: "72%" },
      maxHeight: { xs: "82%", md: "84%" },
      opacity: 0.96,
    },
    lat_spread: {
      width: { xs: "90%", md: "86%" },
      maxHeight: { xs: "78%", md: "80%" },
      opacity: 0.96,
    },
    back_double_bi: {
      width: { xs: "74%", md: "72%" },
      maxHeight: { xs: "82%", md: "84%" },
      opacity: 0.96,
    },
    front_scan: {
      width: { xs: "64%", md: "62%" },
      maxHeight: { xs: "84%", md: "86%" },
      opacity: 0.94,
    },
    side_scan: {
      width: { xs: "44%", md: "40%" },
      maxHeight: { xs: "82%", md: "84%" },
      opacity: 0.94,
    },
    back_scan: {
      width: { xs: "64%", md: "62%" },
      maxHeight: { xs: "84%", md: "86%" },
      opacity: 0.94,
    },
  };
  const fit = fitMap[poseKey] || fitMap.front_double_bi;

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
        px: { xs: 0.5, md: 1 },
      }}
    >
      <Box
        component="img"
        src={src}
        alt=""
        aria-hidden="true"
        sx={{
          width: fit.width,
          maxHeight: fit.maxHeight,
          height: "auto",
          objectFit: "contain",
          transform: mirrored ? "scaleX(-1)" : "none",
          opacity: fit.opacity,
          userSelect: "none",
          WebkitUserDrag: "none",
          filter: isFemaleCue
            ? "drop-shadow(0 0 10px rgba(255,105,180,0.28))"
            : "drop-shadow(0 0 10px rgba(198,255,80,0.24))",
          animation: active ? "matrixPulse 1.1s ease-in-out infinite" : "none",
        }}
      />
    </Box>
  );
}

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}

async function makeThumbDataUrl(dataUrl, maxW = 720, quality = 0.72) {
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
  const activePoses = useMemo(
    () => (isFemale ? FEMALE_POSES : MALE_POSES),
    [isFemale],
  );

  const [stage, setStage] = useState("intro");
  const [poseIdx, setPoseIdx] = useState(0);
  const [facingMode, setFacingMode] = useState("user");
  const [countdownMs, setCountdownMs] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [captures, setCaptures] = useState([]);
  const [result, setResult] = useState(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [isPro, setIsPro] = useState(() => readStoredIsPro());
  const [historyVersion, setHistoryVersion] = useState(0);
  const [scanHasPriorSameGender, setScanHasPriorSameGender] = useState(false);

  const pageTopRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const countdownRef = useRef(null);
  const scanProgressRef = useRef(null);

  const pose = activePoses[poseIdx] || activePoses[0];
  const todayISO = useMemo(() => localDayISO(), []);

  const priorHistory = useMemo(
    () => readPoseSessionHistory(userId) || [],
    [userId, historyVersion],
  );
  const priorSameGenderHistory = useMemo(
    () =>
      priorHistory.filter(
        (entry) => String(entry?.gender || "").toLowerCase() === gender,
      ),
    [priorHistory, gender],
  );
  const liveHasPriorSameGender = priorSameGenderHistory.length > 0;
  const previousSameGenderSession = priorSameGenderHistory[0] || null;
  const olderSameGenderSession = priorSameGenderHistory[1] || null;
  const recentScanContext = useMemo(
    () => buildRecentPoseContext(priorHistory, 3),
    [priorHistory],
  );
  const deltas = useMemo(
    () =>
      computeDeltasPositiveOnly(
        olderSameGenderSession,
        previousSameGenderSession,
      ),
    [olderSameGenderSession, previousSameGenderSession],
  );
  const lockedCopy = useMemo(
    () => getLockedPoseCopy(gender, scanHasPriorSameGender),
    [gender, scanHasPriorSameGender],
  );

  useEffect(() => {
    if (stage === "intro") {
      setScanHasPriorSameGender(liveHasPriorSameGender);
    }
  }, [stage, liveHasPriorSameGender]);

  useEffect(() => {
    let active = true;
    const syncQuota = async () => {
      if (isPro || !user?.id) return;
      try {
        const q = await getAIQuotaStatus("pose_session");
        if (!active) return;
        if (typeof q?.remaining === "number")
          setDailyRemaining("pose_session", q.remaining);
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
      if (scanProgressRef.current) clearInterval(scanProgressRef.current);
      timerRef.current = null;
      countdownRef.current = null;
      scanProgressRef.current = null;
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
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
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
      setErrorMsg(
        "Camera unavailable. Please allow camera permissions and retry.",
      );
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
        {
          poseKey: pose.key,
          title: pose.title,
          fullDataUrl: snap.fullDataUrl,
          thumbDataUrl: snap.thumbDataUrl,
        },
      ]);

      if (poseIdx < activePoses.length - 1) setPoseIdx((i) => i + 1);
      else setStage("scanning");
    }, CAPTURE_DELAY_MS);
  }, [
    activePoses.length,
    cameraReady,
    pose.key,
    pose.title,
    poseIdx,
    takeSnapshot,
  ]);

  useEffect(() => {
    if (stage !== "capture" || !cameraReady) return undefined;
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
    setCaptures((prev) => prev.filter((c) => c.poseKey !== pose.key));
    setStage("capture");
  }, [pose.key]);

  const goToIntro = useCallback(() => {
    setErrorMsg("");
    setCaptures([]);
    setResult(null);
    setScanProgress(0);
    setPoseIdx(0);
    setStage("intro");
    setHistoryVersion((v) => v + 1);
  }, []);

  const startScan = useCallback(() => {
    setScanProgress(0);
    if (!isPro && !canUseDailyFeature("pose_session")) {
      setErrorMsg(
        "Free limit reached (Pose Session: 3/day). Upgrade for unlimited scans.",
      );
      try {
        sessionStorage.setItem("pose_session_force_upgrade", "1");
      } catch {}
      try {
        window.dispatchEvent(new Event("slimcal:pose-session-upgrade"));
      } catch {}
      return;
    }
    setScanHasPriorSameGender(liveHasPriorSameGender);
    setErrorMsg("");
    setCaptures([]);
    setResult(null);
    setPoseIdx(0);
    setStage("capture");
  }, [isPro, liveHasPriorSameGender]);

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
          imageDataUrl: c.thumbDataUrl,
        })),
        deltas,
        recentScans: recentScanContext,
      };

      const json = await postAI("pose_session", payload);
      const session = json?.session || null;
      if (!isPro) {
        if (typeof json?.remaining === "number")
          setDailyRemaining("pose_session", json.remaining);
        else registerDailyFeatureUse("pose_session");
      }

      try {
        appendPoseSession(userId, {
          id: `pose-${todayISO}-${Date.now()}`,
          local_day: todayISO,
          created_at: Date.now(),
          gender,
          goalType,
          scanMode: isFemale ? "female_pose_session" : "male_pose_session",
          build_arc: clamp(
            session?.build_arc ?? session?.buildArcScore ?? 78,
            0,
            100,
          ),
          muscleSignals: session?.muscleSignals || {},
          poseQuality: session?.poseQuality || {},
          momentumNote: session?.momentumNote || "",
          baselineComparison: session?.baselineComparison || "",
          strongestFeature:
            session?.physiqueSnapshot?.summary_seed?.strongest_feature ||
            session?.bestDeveloped?.[0] ||
            "",
          physiqueSnapshot: session?.physiqueSnapshot || null,
        });
        setHistoryVersion((v) => v + 1);
      } catch {}

      setScanProgress(100);
      setResult(session);
      setStage("results");
    } catch (e) {
      console.error(e);
      if (e?.code === 402) {
        setScanProgress(100);
        setErrorMsg(
          "Free limit reached (Pose Session: 3/day). Upgrade for unlimited scans.",
        );
        setStage("intro");
        try {
          sessionStorage.setItem("pose_session_force_upgrade", "1");
        } catch {}
        try {
          window.dispatchEvent(new Event("slimcal:pose-session-upgrade"));
        } catch {}
        return;
      }
      setScanProgress(100);
      setErrorMsg("AI analysis failed. Please try again.");
      setStage("results");
      setResult(null);
    }
  }, [
    activePoses.length,
    captures,
    deltas,
    gender,
    goalType,
    isFemale,
    isPro,
    recentScanContext,
    todayISO,
    userId,
  ]);

  useEffect(() => {
    if (stage !== "scanning") {
      if (scanProgressRef.current) clearInterval(scanProgressRef.current);
      scanProgressRef.current = null;
      if (scanProgress !== 0) setScanProgress(0);
      return;
    }

    setScanProgress((prev) => (prev > 6 ? prev : 6));
    if (scanProgressRef.current) clearInterval(scanProgressRef.current);
    scanProgressRef.current = window.setInterval(() => {
      setScanProgress((prev) => {
        if (prev >= SCAN_PROGRESS_MAX_BEFORE_DONE) return prev;
        const remaining = SCAN_PROGRESS_MAX_BEFORE_DONE - prev;
        const step = Math.max(1, Math.ceil(remaining * 0.08));
        return Math.min(SCAN_PROGRESS_MAX_BEFORE_DONE, prev + step);
      });
    }, SCAN_PROGRESS_TICK_MS);

    return () => {
      if (scanProgressRef.current) clearInterval(scanProgressRef.current);
      scanProgressRef.current = null;
    };
  }, [stage]);

  useEffect(() => {
    if (stage !== "scanning") return;
    callAI();
  }, [stage, callAI]);

  const onShare = useCallback(async () => {
    if (!captures.length) return;
    setShareBusy(true);
    try {
      const shareSummary = buildMemoryAwareShareSummary(result, isFemale);
      const shareCardCopy = {
        ...lockedCopy,
        subread: shareSummary || lockedCopy.subread,
      };
      const pngDataUrl = await buildPoseSessionSharePng({
        mode: scanHasPriorSameGender ? "recheck" : "baseline",
        gender,
        copy: shareCardCopy,
        summary: shareSummary,
        hashtag: "#SlimCalAI",
        thumbs: captures.map((c) => ({
          poseKey: c.poseKey,
          title: c.title,
          dataUrl: c.fullDataUrl,
        })),
      });
      await shareOrDownloadPng(pngDataUrl, "slimcal-build-arc.png");
    } catch (e) {
      console.error(e);
      setErrorMsg("Could not generate share card.");
    } finally {
      setShareBusy(false);
    }
  }, [captures, gender, isFemale, lockedCopy, result, scanHasPriorSameGender]);

  useEffect(() => {
    const run = () => {
      try {
        window.scrollTo({ top: 0, behavior: "auto" });
      } catch {}
      try {
        pageTopRef.current?.scrollIntoView({
          block: "start",
          behavior: "auto",
        });
      } catch {}
    };
    const id = window.setTimeout(run, 0);
    return () => window.clearTimeout(id);
  }, [stage, poseIdx]);

  const titleColor = "rgba(245,250,255,0.92)";
  const bodyColor = "rgba(220,235,245,0.86)";
  const outlinePulseActive =
    stage === "capture" && countdownMs > CAPTURE_DELAY_MS - OUTLINE_PULSE_MS;

  return (
    <>
      <Box sx={{ display: "none" }} aria-hidden="true">
        {ALL_OUTLINE_ASSETS.map((src) => (
          <Box
            key={src}
            component="img"
            src={src}
            alt=""
            sx={{ width: 1, height: 1 }}
          />
        ))}
      </Box>

      <Box
        ref={pageTopRef}
        sx={{
          minHeight: "100svh",
          bgcolor: "#0b0f14",
          display: "flex",
          justifyContent: "center",
          p: { xs: 0.5, md: 4 },
        }}
      >
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
          <CardContent
            sx={{
              p: { xs: 1, md: 3 },
              minHeight: { xs: "100svh", md: "auto" },
              display: "flex",
              flexDirection: "column",
            }}
          >
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ mb: { xs: 1, md: 2 } }}
            >
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
              <Box
                sx={{
                  mb: 2,
                  p: 1.5,
                  borderRadius: 2,
                  bgcolor: "rgba(255,80,80,0.08)",
                  border: "1px solid rgba(255,80,80,0.18)",
                }}
              >
                <Typography
                  sx={{ color: "rgba(255,200,200,0.95)", fontSize: 14 }}
                >
                  {errorMsg}
                </Typography>
              </Box>
            ) : null}

            {stage === "intro" && (
              <Stack
                spacing={{ xs: 0.9, md: 2.2 }}
                sx={{ flex: 1, minHeight: 0 }}
              >
                <Typography
                  variant="h4"
                  sx={{
                    color: titleColor,
                    fontWeight: 800,
                    letterSpacing: 0.2,
                  }}
                >
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
                        "& .MuiChip-label": {
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
                        <Typography
                          sx={{
                            color: "rgba(120,255,220,0.7)",
                            fontWeight: 800,
                          }}
                        >
                          {p.title}
                        </Typography>
                      </Box>
                      <Typography
                        sx={{
                          color: bodyColor,
                          fontSize: { xs: 12, md: 13 },
                          lineHeight: 1.35,
                        }}
                      >
                        {p.subtitle}
                      </Typography>
                    </Box>
                  ))}
                </Stack>

                <Stack spacing={1} sx={{ display: { xs: "none", md: "flex" } }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip
                      label="Auto-captures after a short timer"
                      size="small"
                      sx={{
                        bgcolor: "rgba(120,255,220,0.12)",
                        color: bodyColor,
                        border: "1px solid rgba(120,255,220,0.18)",
                      }}
                    />
                    <Chip
                      label="Private — you control sharing"
                      size="small"
                      sx={{
                        bgcolor: "rgba(255,255,255,0.06)",
                        color: bodyColor,
                        border: "1px solid rgba(255,255,255,0.10)",
                      }}
                    />
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
                <Typography
                  sx={{
                    color: "rgba(180,220,230,0.6)",
                    textAlign: "center",
                    fontSize: { xs: 11, md: 12 },
                  }}
                >
                  Tip: step back so your full body shape is easy to read in
                  frame.
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
              <Stack
                spacing={{ xs: 0.75, md: 2 }}
                sx={{ flex: 1, minHeight: 0 }}
              >
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <Typography sx={{ color: titleColor, fontWeight: 800 }}>
                    Pose {poseIdx + 1} of {activePoses.length}
                  </Typography>
                  <Button
                    onClick={retakePose}
                    sx={{
                      color: bodyColor,
                      textTransform: "none",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 999,
                    }}
                  >
                    Retake
                  </Button>
                </Stack>

                <Box
                  sx={{
                    position: "relative",
                    width: { xs: "min(100%, 360px)", md: "100%" },
                    mx: "auto",
                    aspectRatio: "3/4",
                    height: { xs: "min(58svh, 500px)", md: "auto" },
                    maxHeight: { xs: "58svh", md: "none" },
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
                      objectFit: "cover",
                      background: "#000",
                      transform: facingMode === "user" ? "scaleX(-1)" : "none",
                    }}
                  />

                  <PoseGhostOverlay
                    poseKey={pose.key}
                    mirrored={facingMode === "user"}
                    active={outlinePulseActive}
                  />

                  <Box
                    sx={{
                      position: "absolute",
                      inset: 0,
                      pointerEvents: "none",
                    }}
                  >
                    <Box
                      sx={{
                        position: "absolute",
                        left: 10,
                        right: 10,
                        bottom: 10,
                        p: { xs: 1.35, md: 2 },
                        borderRadius: 3,
                        bgcolor: "rgba(0,0,0,0.55)",
                        border: "1px solid rgba(120,255,220,0.20)",
                        backdropFilter: "blur(6px)",
                      }}
                    >
                      <Typography
                        sx={{
                          color: "rgba(120,255,220,0.95)",
                          fontWeight: 900,
                          letterSpacing: 0.5,
                        }}
                      >
                        {pose.title}
                      </Typography>
                      <Typography
                        sx={{
                          color: bodyColor,
                          fontSize: { xs: 12, md: 13 },
                          mt: 0.4,
                          lineHeight: 1.35,
                        }}
                      >
                        {outlinePulseActive
                          ? `Match this outline for a second, then lock in. ${pose.subtitle}`
                          : pose.subtitle}
                      </Typography>

                      <Divider
                        sx={{
                          my: { xs: 0.9, md: 1.2 },
                          borderColor: "rgba(255,255,255,0.08)",
                        }}
                      />

                      <Typography
                        sx={{
                          color: "rgba(245,250,255,0.88)",
                          fontSize: { xs: 11, md: 12 },
                        }}
                      >
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
                    px: { xs: 1.1, md: 2 },
                    py: { xs: 0.8, md: 1.4 },
                    borderRadius: 999,
                    border: "1px solid rgba(120,255,220,0.18)",
                    bgcolor: "rgba(0,0,0,0.22)",
                  }}
                >
                  <Typography
                    sx={{
                      color: "rgba(120,255,220,0.9)",
                      fontWeight: 900,
                      textAlign: "center",
                      letterSpacing: 2,
                      fontSize: { xs: 11, md: 12 },
                    }}
                  >
                    LOCK-ON
                  </Typography>
                  <Box
                    sx={{
                      mt: 0.8,
                      height: 7,
                      borderRadius: 999,
                      bgcolor: "rgba(255,255,255,0.08)",
                      overflow: "hidden",
                    }}
                  >
                    <Box
                      sx={{
                        height: "100%",
                        width: `${clamp(100 - (countdownMs / CAPTURE_DELAY_MS) * 100, 0, 100)}%`,
                        bgcolor: "rgba(120,255,220,0.85)",
                        boxShadow: "0 0 18px rgba(120,255,220,0.25)",
                      }}
                    />
                  </Box>
                  <Stack
                    direction="row"
                    spacing={0.75}
                    justifyContent="center"
                    sx={{ mt: 0.75, flexWrap: "wrap" }}
                  >
                    <Chip
                      label="Centered"
                      size="small"
                      sx={{
                        color: bodyColor,
                        bgcolor: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.10)",
                        height: { xs: 22, md: 32 },
                        fontSize: { xs: 11, md: 13 },
                      }}
                    />
                    <Chip
                      label="Far enough"
                      size="small"
                      sx={{
                        color: bodyColor,
                        bgcolor: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.10)",
                        height: { xs: 22, md: 32 },
                        fontSize: { xs: 11, md: 13 },
                      }}
                    />
                    <Chip
                      label="Hold still"
                      size="small"
                      sx={{
                        color: bodyColor,
                        bgcolor: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.10)",
                        height: { xs: 22, md: 32 },
                        fontSize: { xs: 11, md: 13 },
                      }}
                    />
                  </Stack>
                </Box>
              </Stack>
            )}

            {stage === "scanning" && (
              <Stack spacing={2} alignItems="center" sx={{ py: 6 }}>
                <CircularProgress />
                <Typography sx={{ color: titleColor, fontWeight: 800 }}>
                  Scanning poses…
                </Typography>
                <Box
                  sx={{
                    width: "min(420px, 100%)",
                    px: { xs: 1, md: 0 },
                  }}
                >
                  <LinearProgress
                    variant="determinate"
                    value={scanProgress}
                    sx={{
                      height: 10,
                      borderRadius: 999,
                      bgcolor: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(120,255,220,0.14)",
                      overflow: "hidden",
                      "& .MuiLinearProgress-bar": {
                        borderRadius: 999,
                        background:
                          "linear-gradient(90deg, rgba(120,255,220,0.72), rgba(80,220,255,0.92))",
                        boxShadow: "0 0 16px rgba(120,255,220,0.22)",
                      },
                    }}
                  />
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    sx={{ mt: 0.9, px: 0.25 }}
                  >
                    <Typography
                      sx={{
                        color: "rgba(120,255,220,0.92)",
                        fontWeight: 800,
                        fontSize: 13,
                      }}
                    >
                      {Math.round(scanProgress)}%
                    </Typography>
                    <Typography
                      sx={{ color: "rgba(180,220,230,0.72)", fontSize: 12 }}
                    >
                      Building your results
                    </Typography>
                  </Stack>
                </Box>
                <Typography
                  sx={{ color: bodyColor, textAlign: "center", maxWidth: 520 }}
                >
                  Generating your private physique breakdown.
                </Typography>
              </Stack>
            )}

            {stage === "results" && (
              <Stack spacing={2.2}>
                <Stack spacing={0.6}>
                  <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    sx={{ gap: 1 }}
                  >
                    <Stack spacing={0.15}>
                      <Typography
                        sx={{
                          color: "#f7efe6",
                          fontSize: { xs: 14, md: 16 },
                          fontWeight: 900,
                          letterSpacing: 0.3,
                        }}
                      >
                        SlimCal AI
                      </Typography>
                      <Typography
                        sx={{
                          color: "rgba(245,226,205,0.92)",
                          fontSize: { xs: 12, md: 13 },
                          fontWeight: 800,
                          letterSpacing: 1.1,
                        }}
                      >
                        POSE SESSION
                      </Typography>
                    </Stack>
                    <Chip
                      label={lockedCopy.mode}
                      sx={{
                        bgcolor: "rgba(255,190,120,0.12)",
                        color: "#ffd8a8",
                        border: "1px solid rgba(255,190,120,0.28)",
                        fontWeight: 800,
                      }}
                    />
                  </Stack>
                  <Divider sx={{ borderColor: "rgba(255,190,120,0.18)" }} />
                </Stack>

                <Stack spacing={0.8}>
                  <Typography
                    sx={{
                      color: "#f6d8c1",
                      fontSize: { xs: 34, md: 42 },
                      lineHeight: 1,
                      fontWeight: 700,
                      fontStyle: "italic",
                      letterSpacing: -0.4,
                    }}
                  >
                    {lockedCopy.hero}
                  </Typography>
                  <Typography
                    sx={{
                      color: "rgba(245,235,225,0.9)",
                      lineHeight: 1.45,
                      fontSize: { xs: 14, md: 15 },
                    }}
                  >
                    {lockedCopy.subread}
                  </Typography>
                </Stack>

                <Stack
                  direction="row"
                  spacing={1.2}
                  sx={{ overflowX: "auto", pb: 0.5 }}
                >
                  {captures.map((c) => (
                    <Box
                      key={c.poseKey}
                      sx={{ minWidth: { xs: 108, md: 150 }, flex: 1 }}
                    >
                      <Box
                        sx={{
                          width: "100%",
                          aspectRatio: "0.82 / 1",
                          borderRadius: 3,
                          overflow: "hidden",
                          border: "1px solid rgba(255,190,120,0.35)",
                          bgcolor: "rgba(255,255,255,0.04)",
                          boxShadow: "0 0 22px rgba(255,170,90,0.12)",
                        }}
                      >
                        <img
                          src={c.fullDataUrl}
                          alt={c.title}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                          }}
                        />
                      </Box>
                    </Box>
                  ))}
                </Stack>

                <Stack spacing={0.8}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography
                      sx={{
                        color: "#f2c27b",
                        fontWeight: 900,
                        letterSpacing: 0.8,
                        fontSize: { xs: 14, md: 15 },
                      }}
                    >
                      {lockedCopy.bulletsLabel}
                    </Typography>
                    <Box
                      sx={{
                        flex: 1,
                        height: 1,
                        bgcolor: "rgba(255,190,120,0.18)",
                      }}
                    />
                  </Stack>
                  <Stack spacing={0.65}>
                    {lockedCopy.bullets.map((item) => (
                      <Typography
                        key={item}
                        sx={{
                          color: "rgba(246,236,226,0.94)",
                          lineHeight: 1.4,
                        }}
                      >
                        • {item}
                      </Typography>
                    ))}
                  </Stack>
                </Stack>

                <Stack spacing={0.8}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography
                      sx={{
                        color: "#f2c27b",
                        fontWeight: 900,
                        letterSpacing: 0.8,
                        fontSize: { xs: 14, md: 15 },
                      }}
                    >
                      BREAKDOWN
                    </Typography>
                    <Box
                      sx={{
                        flex: 1,
                        height: 1,
                        bgcolor: "rgba(255,190,120,0.18)",
                      }}
                    />
                  </Stack>
                  <Stack spacing={0.75}>
                    {lockedCopy.breakdown.map((item) => (
                      <Typography
                        key={item}
                        sx={{
                          color: "rgba(246,236,226,0.92)",
                          lineHeight: 1.5,
                        }}
                      >
                        {item}
                      </Typography>
                    ))}
                  </Stack>
                </Stack>

                <Stack spacing={0.8}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography
                      sx={{
                        color: "#f2c27b",
                        fontWeight: 900,
                        letterSpacing: 0.8,
                        fontSize: { xs: 14, md: 15 },
                      }}
                    >
                      NEXT UP
                    </Typography>
                    <Box
                      sx={{
                        flex: 1,
                        height: 1,
                        bgcolor: "rgba(255,190,120,0.18)",
                      }}
                    />
                  </Stack>
                  <Stack spacing={0.75}>
                    {lockedCopy.nextUp.map((item) => (
                      <Typography
                        key={item}
                        sx={{
                          color: "rgba(246,236,226,0.92)",
                          lineHeight: 1.5,
                        }}
                      >
                        {item}
                      </Typography>
                    ))}
                  </Stack>
                </Stack>

                <Stack spacing={0.8}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography
                      sx={{
                        color: "#f2c27b",
                        fontWeight: 900,
                        letterSpacing: 0.8,
                        fontSize: { xs: 14, md: 15 },
                      }}
                    >
                      COACH NOTE
                    </Typography>
                    <Box
                      sx={{
                        flex: 1,
                        height: 1,
                        bgcolor: "rgba(255,190,120,0.18)",
                      }}
                    />
                  </Stack>
                  <Stack spacing={0.75}>
                    {lockedCopy.coachNote.map((item) => (
                      <Typography
                        key={item}
                        sx={{
                          color: "rgba(246,236,226,0.92)",
                          lineHeight: 1.5,
                        }}
                      >
                        {item}
                      </Typography>
                    ))}
                  </Stack>
                </Stack>

                <Stack direction={{ xs: "column", md: "row" }} spacing={1.2}>
                  <Button
                    variant="outlined"
                    onClick={goToIntro}
                    sx={{
                      color: "rgba(246,236,226,0.9)",
                      textTransform: "none",
                      borderColor: "rgba(255,190,120,0.3)",
                      borderRadius: 999,
                      py: 1.2,
                      fontWeight: 800,
                    }}
                  >
                    Retake
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={onShare}
                    disabled={shareBusy}
                    sx={{
                      flex: 1,
                      color: "#f2c27b",
                      textTransform: "none",
                      borderColor: "rgba(255,190,120,0.5)",
                      borderWidth: "2px",
                      borderRadius: 999,
                      py: 1.2,
                      fontWeight: 900,
                      letterSpacing: 0.8,
                    }}
                  >
                    {shareBusy ? "Preparing…" : "SHARE"}
                  </Button>
                </Stack>
              </Stack>
            )}
          </CardContent>
        </Card>
      </Box>
    </>
  );
}
