// src/DailyEvaluationHome.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useHistory } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import IosShareIcon from "@mui/icons-material/IosShare";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import UpgradeModal from "./components/UpgradeModal";
import FeatureUseBadge, {
  canUseDailyFeature,
  registerDailyFeatureUse,
  getDailyRemaining,
  getFreeDailyLimit,
} from "./components/FeatureUseBadge.jsx";
import { useEntitlements } from "./context/EntitlementsContext.jsx";
import { useAuth } from "./context/AuthProvider.jsx";

/**
 * DailyEvaluationHome — Option B + Win-first
 * Card 1: ultra-minimal rings (Calories / Protein / Exercise) + mini rings (Carbs / Fats)
 * Card 2: super-simple "Pick 1 fix → Do it now" (no slider)
 * Card 3: Win ✅ / Not Yet ⚠️ reveal (grade hidden behind tap), AI verdict gated (3/day free)
 *
 * IMPORTANT: This file intentionally avoids changing any sync/storage/math logic.
 * Only UI + copy + interaction changes.
 */

// ----------------------------- helpers ---------------------------------------
function safeJsonParse(v, fallback) {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}

function isoDay(d = new Date()) {
  try {
    const n = new Date(d);
    return new Date(n.getFullYear(), n.getMonth(), n.getDate()).toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function usDay(d = new Date()) {
  try {
    return new Date(d).toLocaleDateString("en-US");
  } catch {
    return "";
  }
}

function sumMealsCalories(dayRec) {
  const meals = dayRec?.meals;
  if (!Array.isArray(meals)) return 0;
  return meals.reduce((s, m) => s + (Number(m?.calories) || 0), 0);
}

function sumMealsMacros(dayRec) {
  const meals = dayRec?.meals;
  if (!Array.isArray(meals)) return { protein_g: 0, carbs_g: 0, fat_g: 0 };
  return meals.reduce(
    (acc, m) => {
      acc.protein_g += Number(m?.protein_g ?? m?.macros?.protein ?? 0) || 0;
      acc.carbs_g += Number(m?.carbs_g ?? m?.macros?.carbs ?? 0) || 0;
      acc.fat_g += Number(m?.fat_g ?? m?.macros?.fat ?? 0) || 0;
      return acc;
    },
    { protein_g: 0, carbs_g: 0, fat_g: 0 }
  );
}

function sumWorkoutsCalories(workoutHistory, dayStrUS) {
  if (!Array.isArray(workoutHistory)) return 0;
  return workoutHistory
    .filter((w) => w?.date === dayStrUS)
    .reduce((s, w) => {
      const c = Number(
        w?.totalCalories ??
          w?.total_calories ??
          w?.total_calories_burned ??
          w?.calories ??
          0
      );
      return s + (Number.isFinite(c) ? c : 0);
    }, 0);
}

function normalizeGoalType(raw) {
  const s = String(raw || "").toLowerCase().trim();
  if (!s) return "maintain";
  if (s.includes("cut") || s.includes("lose") || s.includes("deficit")) return "cut";
  if (s.includes("bulk") || s.includes("gain") || s.includes("surplus")) return "bulk";
  if (s.includes("maint")) return "maintain";
  return "maintain";
}

function hasBmrInputs(profile = {}) {
  const age = Number(profile?.age || 0);
  const gender = String(profile?.gender || "").toLowerCase();
  const w = Number(profile?.weight || 0);
  const ft = Number(profile?.height?.feet || 0);
  const inch = Number(profile?.height?.inches || 0);
  const act = String(profile?.activityLevel || "");
  const okGender = gender === "male" || gender === "female";
  const okHeight = ft > 0 || inch > 0;
  return age > 0 && okGender && w > 0 && okHeight && !!act;
}

// ---------- deterministic copy variants (stable per day) ----------
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function pickVariant(key, dayKey, options) {
  if (!options || options.length === 0) return "";
  const idx = hashStr(`${key}:${dayKey}`) % options.length;
  return options[idx];
}

// ----------------------------- scoring ----------------------------------------
function goalAwareCalorieScore({ goalType, calorieTarget, consumed, netKcal }) {
  const g = normalizeGoalType(goalType);
  const err = calorieTarget ? Math.abs(consumed - calorieTarget) : Math.abs(netKcal);
  const delta = calorieTarget ? consumed - calorieTarget : netKcal;

  const tight = 220;
  const mid = 420;
  const loose = 700;

  let s;
  if (err <= tight) s = 1.0;
  else if (err <= mid) s = 0.78;
  else if (err <= loose) s = 0.45;
  else s = 0.18;

  const isOver = delta > 0;
  const biasPenalty = clamp(Math.abs(delta) / 700, 0, 1) * 0.22;
  if (g === "cut" && isOver) s = clamp(s - biasPenalty, 0, 1);
  if (g === "bulk" && !isOver) s = clamp(s - biasPenalty, 0, 1);

  return clamp(s, 0, 1);
}

function proteinScore({ proteinTarget, proteinG, goalType }) {
  const g = normalizeGoalType(goalType);
  const fallbackTarget = g === "cut" ? 140 : 120;
  const target = Number(proteinTarget) || fallbackTarget;

  const ratio = clamp((Number(proteinG) || 0) / Math.max(1, target), 0, 1.25);
  if (ratio >= 1.0) return 1.0;
  if (ratio >= 0.85) return 0.82 + (ratio - 0.85) * (0.18 / 0.15);
  if (ratio >= 0.65) return 0.48 + (ratio - 0.65) * (0.34 / 0.20);
  return clamp(ratio / 0.65, 0, 1) * 0.48;
}

function trainingScore({ burned, hasWorkout }) {
  if (!hasWorkout) return 0;
  const b = Number(burned) || 0;
  return clamp(b / 220, 0, 1);
}

function computeScore({
  goalType,
  calorieTarget,
  consumed,
  burned,
  netKcal,
  proteinTarget,
  proteinG,
  hasWorkout,
}) {
  const calS = goalAwareCalorieScore({ goalType, calorieTarget, consumed, netKcal });
  const pS = proteinScore({ proteinTarget, proteinG, goalType });
  const tS = trainingScore({ burned, hasWorkout });

  const score = Math.round(100 * (0.48 * calS + 0.36 * pS + 0.16 * tS));
  return { score: clamp(score, 0, 100), components: { calS, pS, tS } };
}

// ----------------------------- UI primitives ---------------------------------
function CardShell({ title, subtitle, children, chip }) {
  return (
    <Card
      elevation={0}
      sx={{
        minWidth: { xs: 310, sm: 360 },
        maxWidth: 440,
        scrollSnapAlign: "start",
        borderRadius: 3,
        border: "1px solid rgba(148,163,184,0.18)",
        background: "linear-gradient(180deg, rgba(15,23,42,0.98) 0%, rgba(2,6,23,0.98) 100%)",
        color: "rgba(255,255,255,0.92)",
      }}
    >
      <CardContent sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 950, letterSpacing: -0.2, color: "rgba(255,255,255,0.92)" }}>
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.65)" }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          {chip}
        </Stack>
        <Divider sx={{ my: 1.4, borderColor: "rgba(148,163,184,0.18)" }} />
        {children}
      </CardContent>
    </Card>
  );
}

function Ring({ pct, size, label, value, tone = "primary.main" }) {
  const v = clamp(Number(pct || 0), 0, 100);
  return (
    <Box sx={{ position: "relative", width: size, height: size, flex: "0 0 auto" }}>
      <CircularProgress
        variant="determinate"
        value={100}
        size={size}
        thickness={5}
        sx={{ color: "rgba(255,255,255,0.12)" }}
      />
      <CircularProgress
        variant="determinate"
        value={v}
        size={size}
        thickness={5}
        sx={{ color: tone, position: "absolute", left: 0, top: 0 }}
      />
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          px: 0.5,
        }}
      >
        <Box>
          <Typography
            sx={{
              fontWeight: 950,
              fontSize: size >= 92 ? 18 : size >= 70 ? 14 : 12,
              lineHeight: 1.05,
              color: "rgba(255,255,255,0.92)",
            }}
          >
            {value}
          </Typography>
          <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.72)", fontSize: size >= 92 ? 12 : 11 }}>
            {label}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

function gradeFromScore(s) {
  const n = Number(s || 0);
  if (n >= 93) return "A";
  if (n >= 86) return "A-";
  if (n >= 80) return "B+";
  if (n >= 74) return "B";
  if (n >= 68) return "B-";
  if (n >= 62) return "C+";
  if (n >= 56) return "C";
  if (n >= 50) return "C-";
  if (n >= 44) return "D";
  return "F";
}

// “Win” is an interpretation layer (UI-only), not new math.
// We call it a “Win” when score is reasonably high AND user has enough signal.
// This avoids “you won!” when they logged nothing.
function computeWinState({ score, confidenceLabel, profileComplete, hasLogs }) {
  if (!profileComplete) return { state: "notyet", reason: "Finish setup to personalize your win." };
  if (!hasLogs) return { state: "notyet", reason: "Log at least 1 meal or a workout." };
  if (confidenceLabel === "Low") return { state: "notyet", reason: "Log a bit more so it’s accurate." };
  if (score >= 74) return { state: "win", reason: "Solid day. Repeat this." };
  return { state: "notyet", reason: "You’re close. Pick 1 fix to win." };
}

// ----------------------------- main ------------------------------------------
export default function DailyEvaluationHome() {
  const history = useHistory();
  const { isProActive } = useEntitlements();
  const pro = !!isProActive || localStorage.getItem("isPro") === "true";

  const { user } = useAuth();
  const userId = user?.id || null;

  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // Card 1 interactions
  const [activeRing, setActiveRing] = useState(null); // "calories" | "protein" | "exercise" | "carbs" | "fats" | null
  const [showBreakdown, setShowBreakdown] = useState(false);
  const holdTimerRef = useRef(null);
  const startHold = (key) => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(() => {
      setActiveRing(key);
      setShowBreakdown(true);
    }, 520);
  };
  const endHold = () => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  };

  // Card 3: reveal grade details (hidden by default)
  const [showGradeDetails, setShowGradeDetails] = useState(false);

  // AI verdict state (unchanged gating)
  const [aiLoading, setAiLoading] = useState(false);
  const [aiVerdict, setAiVerdict] = useState("");
  const [aiError, setAiError] = useState("");

  // animated score badge
  const [scoreAnim, setScoreAnim] = useState(0);

  const FEATURE_KEY = "daily_eval_verdict";

  const macroChipSx = {
    bgcolor: "rgba(255,255,255,0.10)",
    color: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(255,255,255,0.18)",
    backdropFilter: "blur(6px)",
    "& .MuiChip-icon": { color: "rgba(255,255,255,0.92)" },
  };

  const bundle = useMemo(() => {
    const dayUS = usDay();
    const dayISO = isoDay();

    const userData = safeJsonParse(localStorage.getItem("userData"), {}) || {};

    // scoped keys (prevents cross-user flicker)
    const uid = userId || userData?.id || userData?.user_id || null;
    const mealKey = uid ? `mealHistory:${uid}` : "mealHistory";
    const workoutKey = uid ? `workoutHistory:${uid}` : "workoutHistory";
    const dailyCacheKey = uid ? `dailyMetricsCache:${uid}` : "dailyMetricsCache";

    const mealHistoryScoped = safeJsonParse(localStorage.getItem(mealKey), []);
    const workoutHistoryScoped = safeJsonParse(localStorage.getItem(workoutKey), []);
    const mealHistoryLegacy = safeJsonParse(localStorage.getItem("mealHistory"), []);
    const workoutHistoryLegacy = safeJsonParse(localStorage.getItem("workoutHistory"), []);

    const mealHistory =
      uid && Array.isArray(mealHistoryScoped) && mealHistoryScoped.length === 0 && Array.isArray(mealHistoryLegacy) && mealHistoryLegacy.length > 0
        ? mealHistoryLegacy
        : mealHistoryScoped;

    const workoutHistory =
      uid && Array.isArray(workoutHistoryScoped) && workoutHistoryScoped.length === 0 && Array.isArray(workoutHistoryLegacy) && workoutHistoryLegacy.length > 0
        ? workoutHistoryLegacy
        : workoutHistoryScoped;

    const dailyCache = safeJsonParse(localStorage.getItem(dailyCacheKey), {});

    const dayMealsRec = Array.isArray(mealHistory) ? mealHistory.find((d) => d?.date === dayUS) || null : null;

    const consumed = sumMealsCalories(dayMealsRec);
    const macros = sumMealsMacros(dayMealsRec);
    const burned = sumWorkoutsCalories(workoutHistory, dayUS);

    const cacheRow = dailyCache?.[dayISO] || null;
    const consumedFinal = consumed || Number(cacheRow?.consumed || 0) || 0;
    const burnedFinal = burned || Number(cacheRow?.burned || 0) || 0;

    const netKcal = consumedFinal - burnedFinal;

    const calorieTarget = Number(userData?.dailyGoal) || Number(localStorage.getItem("dailyGoal") || 0) || 0;

    const proteinTarget =
      Number(userData?.proteinTargets?.daily_g) ||
      Number(localStorage.getItem("protein_target_daily_g") || 0) ||
      0;

    const goalType = normalizeGoalType(userData?.goalType);

    const bmrEst = Number(userData?.bmr_est) || Number(localStorage.getItem("bmr_est") || 0) || 0;
    const tdeeEst = Number(userData?.tdee_est) || Number(localStorage.getItem("tdee_est") || 0) || 0;

    const profileComplete = hasBmrInputs(userData) && !!userData?.goalType;

    const hasMeals = consumedFinal > 0 || (dayMealsRec?.meals?.length || 0) > 0;
    const hasWorkout = burnedFinal > 0;
    const hasLogs = hasMeals || hasWorkout;

    const fallbackProteinTarget = goalType === "cut" ? 140 : 120;
    const pTarget = Number(proteinTarget) || fallbackProteinTarget;

    // confidence: profile + meals + workout
    const confidenceScore = (profileComplete ? 0.5 : 0) + (hasMeals ? 0.32 : 0) + (hasWorkout ? 0.18 : 0);
    const confidenceLabel =
      confidenceScore >= 0.86 ? "High" : confidenceScore >= 0.58 ? "Medium" : "Low";

    const { score, components } = computeScore({
      goalType,
      calorieTarget,
      consumed: consumedFinal,
      burned: burnedFinal,
      netKcal,
      proteinTarget: pTarget,
      proteinG: macros.protein_g,
      hasWorkout,
    });

    const tdeeDelta = tdeeEst ? Math.round(calorieTarget - tdeeEst) : 0;

    return {
      dayUS,
      dayISO,
      profile: userData,
      targets: { calorieTarget, proteinTarget: pTarget, goalType },
      totals: { consumed: consumedFinal, burned: burnedFinal, netKcal, macros },
      est: { bmr_est: bmrEst || 0, tdee_est: tdeeEst || 0, tdee_delta: tdeeDelta },
      derived: {
        profileComplete,
        hasMeals,
        hasWorkout,
        hasLogs,
        confidenceLabel,
        score,
        components,
      },
    };
  }, [userId]);

  // score animation
  useEffect(() => {
    let raf = null;
    const target = clamp(bundle.derived.score, 0, 100);
    const start = performance.now();
    const dur = 700;
    const tick = (t) => {
      const p = clamp((t - start) / dur, 0, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setScoreAnim(Math.round(e * target));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => raf && cancelAnimationFrame(raf);
  }, [bundle.derived.score]);

  // chips
  const goalChip = (() => {
    const g = normalizeGoalType(bundle.targets.goalType);
    const map = {
      cut: { label: "CUT", color: "secondary" },
      maintain: { label: "MAINTAIN", color: "info" },
      bulk: { label: "BULK", color: "success" },
    };
    const x = map[g] || map.maintain;
    return <Chip size="small" label={x.label} color={x.color} sx={{ fontWeight: 950 }} />;
  })();

  const confidenceChip = (() => {
    const c = bundle.derived.confidenceLabel;
    const color = c === "High" ? "success" : c === "Medium" ? "primary" : "warning";
    return <Chip size="small" label={`Confidence: ${c}`} color={color} sx={{ fontWeight: 900 }} />;
  })();

  // Calories “on track %” based on target (doesn't collapse to 0 when under)
  const calErr = bundle.targets.calorieTarget
    ? Math.abs(bundle.totals.consumed - bundle.targets.calorieTarget)
    : Math.abs(bundle.totals.netKcal);

  const calTightnessScale = bundle.targets.calorieTarget
    ? Math.max(500, bundle.targets.calorieTarget)
    : 700;

  const calQuality = bundle.targets.calorieTarget
    ? clamp(100 - (calErr / calTightnessScale) * 100, 0, 100)
    : 0;

  const proteinPct = bundle.targets.proteinTarget
    ? clamp((bundle.totals.macros.protein_g / Math.max(1, bundle.targets.proteinTarget)) * 100, 0, 100)
    : 0;

  // Carbs/fats: if no targets exist yet, show ring progress based on "reasonable daily cap" so it's still meaningful.
  // This is UI-only. It does NOT change actual scoring.
  const carbsCap = 260;
  const fatCap = 90;
  const carbsPct = clamp((bundle.totals.macros.carbs_g / carbsCap) * 100, 0, 100);
  const fatsPct = clamp((bundle.totals.macros.fat_g / fatCap) * 100, 0, 100);

  // Exercise ring: based on burn relative to ~220 “good baseline”
  const exercisePct = bundle.derived.hasWorkout ? clamp((bundle.totals.burned / 220) * 100, 0, 100) : 0;

  // “flag” chip (kept simple)
  const proteinGap = bundle.targets.proteinTarget
    ? Math.max(0, bundle.targets.proteinTarget - bundle.totals.macros.protein_g)
    : 0;

  const flag = useMemo(() => {
    const dayKey = bundle.dayISO || bundle.dayUS || "";
    if (!bundle.derived.profileComplete || !bundle.derived.hasMeals) {
      return { label: pickVariant("flag_data", dayKey, ["ORANGE FLAG: NEEDS DATA", "ORANGE FLAG: LOG 2 MEALS", "ORANGE FLAG: FINISH SETUP"]), tone: "warning" };
    }
    if (bundle.targets.proteinTarget && proteinGap >= 25) {
      return { label: pickVariant("flag_protein", dayKey, ["RED FLAG: PROTEIN GAP", "RED FLAG: LOW PROTEIN", "RED FLAG: PROTEIN LEAK"]), tone: "error" };
    }
    if (bundle.targets.calorieTarget && calErr > 450) {
      return { label: pickVariant("flag_cal", dayKey, ["ORANGE FLAG: CALORIES OFF", "ORANGE FLAG: CALORIE DRIFT", "ORANGE FLAG: TARGET MISSED"]), tone: "warning" };
    }
    return { label: pickVariant("flag_green", dayKey, ["GREEN FLAG: ON TRACK", "GREEN FLAG: SOLID DAY", "GREEN FLAG: KEEP IT GOING"]), tone: "success" };
  }, [bundle, proteinGap, calErr]);

  const hasEstimates = !!bundle.est.bmr_est && !!bundle.est.tdee_est;

  // ---------------- Card 2: 5-year-old simple fixes ----------------
  // No sliders. No “math.” Just pick 1 and do it.
  const fixOptions = useMemo(() => {
    // Keep it to 3 max. Humans freeze when you give too many choices.
    const opts = [];

    if (!bundle.derived.profileComplete) {
      opts.push({ key: "finish_setup", label: "Finish Setup", hint: "So targets are accurate", go: "/health" });
      opts.push({ key: "log_meal", label: "Log a Meal", hint: "So I can judge today", go: "/meals" });
      opts.push({ key: "log_workout", label: "Log Workout", hint: "So exercise counts", go: "/workout" });
      return opts;
    }

    if (!bundle.derived.hasMeals) {
      opts.push({ key: "log_meal", label: "Log a Meal", hint: "Fastest way to improve accuracy", go: "/meals" });
      opts.push({ key: "add_protein", label: "Eat Protein", hint: "Chicken, eggs, shake", go: "/meals" });
      opts.push({ key: "small_dinner", label: "Smaller Dinner", hint: "Stay near target", go: "/meals" });
      return opts;
    }

    if (!bundle.derived.hasWorkout) {
      opts.push({ key: "log_workout", label: "Log Workout", hint: "Makes your day count", go: "/workout" });
      opts.push({ key: "walk", label: "10-min Walk", hint: "Quick win", go: "/workout" });
      opts.push({ key: "eat_protein", label: "Eat Protein", hint: "Easiest macro fix", go: "/meals" });
      return opts;
    }

    // If protein gap is big, make protein the #1
    if (bundle.targets.proteinTarget && proteinGap >= 20) {
      opts.push({ key: "eat_protein", label: "Eat Protein", hint: `Add ~${Math.round(Math.min(30, proteinGap))}g`, go: "/meals" });
      opts.push({ key: "log_meal", label: "Log a Meal", hint: "Keep the day accurate", go: "/meals" });
      opts.push({ key: "small_snack", label: "Skip Snack", hint: "Easiest calorie win", go: "/meals" });
      return opts;
    }

    // Otherwise: keep it very simple
    opts.push({ key: "log_meal", label: "Log Next Meal", hint: "Stay on track", go: "/meals" });
    opts.push({ key: "log_workout", label: "Log Workout", hint: "Keep exercise counted", go: "/workout" });
    opts.push({ key: "skip_snack", label: "Skip Snack", hint: "Easy calorie win", go: "/meals" });
    return opts;
  }, [bundle.derived.profileComplete, bundle.derived.hasMeals, bundle.derived.hasWorkout, bundle.targets.proteinTarget, proteinGap]);

  const [selectedFix, setSelectedFix] = useState(null);
  useEffect(() => {
    if (!selectedFix || !fixOptions.some((o) => o.key === selectedFix)) {
      setSelectedFix(fixOptions?.[0]?.key || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixOptions]);

  const selectedFixObj = useMemo(() => fixOptions.find((o) => o.key === selectedFix) || null, [fixOptions, selectedFix]);

  // ---------------- Card 3: Win-first psychology ----------------
  const win = useMemo(
    () =>
      computeWinState({
        score: bundle.derived.score,
        confidenceLabel: bundle.derived.confidenceLabel,
        profileComplete: bundle.derived.profileComplete,
        hasLogs: bundle.derived.hasLogs,
      }),
    [bundle]
  );

  // AI (unchanged gating)
  const remainingAi = getDailyRemaining(FEATURE_KEY);
  const limitAi = getFreeDailyLimit(FEATURE_KEY);

  const openUpgrade = () => setUpgradeOpen(true);

  const handleGenerateAiVerdict = async () => {
    setAiError("");
    setAiVerdict("");

    if (!pro) {
      if (!canUseDailyFeature(FEATURE_KEY)) {
        openUpgrade();
        return;
      }
      registerDailyFeatureUse(FEATURE_KEY);
    }

    setAiLoading(true);
    try {
      const goalType = normalizeGoalType(bundle.profile?.goalType);
      const hasEst = !!bundle.est.tdee_est && !!bundle.est.bmr_est;

      const payload = {
        feature: "daily_eval_verdict",
        prompt: `
You are SlimCal Coach. Write a short, punchy verdict for today's day.

Rules:
- 2–4 sentences max.
- supportive, simple language, no rambling.
- MUST use numbers: calories consumed, burned, net, protein, carbs, fats (if available), and targets if available.
- Mention the user's goal type (${goalType}).
- End with 2 bullet points: "Tomorrow: ___" and "Do this: ___".
- If BMR/TDEE are provided, mention it in 1 short clause.

Data:
Day: ${bundle.dayUS}
Goal: ${goalType}
Consumed: ${Math.round(bundle.totals.consumed)} kcal
Burned: ${Math.round(bundle.totals.burned)} kcal
Net: ${Math.round(bundle.totals.netKcal)} kcal

Macros:
Protein: ${Math.round(bundle.totals.macros.protein_g)} g
Carbs: ${Math.round(bundle.totals.macros.carbs_g)} g
Fats: ${Math.round(bundle.totals.macros.fat_g)} g

Targets:
- Calories target: ${bundle.targets.calorieTarget ? Math.round(bundle.targets.calorieTarget) : "not set"}
- Protein target: ${bundle.targets.proteinTarget ? Math.round(bundle.targets.proteinTarget) : "not set"}

Metabolism (if available):
- BMR: ${hasEst ? Math.round(bundle.est.bmr_est) : "n/a"} kcal/day
- TDEE: ${hasEst ? Math.round(bundle.est.tdee_est) : "n/a"} kcal/day

Confidence: ${bundle.derived.confidenceLabel}
Win state: ${win.state}
`.trim(),
      };

      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || data?.message || "AI verdict failed.";
        throw new Error(msg);
      }

      const text =
        data?.text ||
        data?.result ||
        data?.output ||
        data?.message ||
        data?.choices?.[0]?.message?.content ||
        "";

      if (!String(text || "").trim()) throw new Error("No AI text returned.");
      setAiVerdict(String(text).trim());
    } catch (e) {
      setAiError(e?.message || "AI verdict failed.");
    } finally {
      setAiLoading(false);
    }
  };

  const handleShare = async () => {
    const grade = gradeFromScore(bundle.derived.score);
    const winLine = win.state === "win" ? "I got a WIN today ✅" : "I’m 1 move away from a WIN ⚠️";
    const msg = aiVerdict
      ? `${winLine}\n\n${aiVerdict}\n\nWhat’s your status today?`
      : `${winLine}\nCalories: ${Math.round(bundle.totals.consumed)} • Exercise: ${Math.round(bundle.totals.burned)} • Protein: ${Math.round(bundle.totals.macros.protein_g)}g\n(Grade: ${grade})\n\nWhat’s your status today?`;

    try {
      if (navigator.share) {
        await navigator.share({ text: msg });
      } else {
        await navigator.clipboard.writeText(msg);
      }
    } catch {
      // ignore
    }
  };

  // Breakdown dialog
  const metabolismLine = hasEstimates
    ? `BMR ${Math.round(bundle.est.bmr_est)} • TDEE ${Math.round(bundle.est.tdee_est)}`
    : "Set up Health Data to unlock BMR/TDEE";

  const targetLine = bundle.targets.calorieTarget
    ? `Target ${Math.round(bundle.targets.calorieTarget)}`
    : "Set a calorie target";

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1150, mx: "auto" }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        alignItems={{ xs: "flex-start", sm: "center" }}
        justifyContent="space-between"
      >
        <Box>
          <Typography sx={{ fontWeight: 950, letterSpacing: -0.4, fontSize: 22, color: "rgba(255,255,255,0.92)" }}>
            Daily Evaluation
          </Typography>
          <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.70)" }}>
            {bundle.dayUS} • swipe → pick 1 → win
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
          {goalChip}
          {confidenceChip}
          {!pro && <FeatureUseBadge featureKey={FEATURE_KEY} isPro={false} labelPrefix="AI" />}
          {pro && <FeatureUseBadge featureKey={FEATURE_KEY} isPro={true} labelPrefix="AI" />}
        </Stack>
      </Stack>

      {/* Breakdown sheet */}
      <Dialog open={showBreakdown} onClose={() => setShowBreakdown(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 950, color: "rgba(255,255,255,0.92)", bgcolor: "rgba(2,6,23,0.98)" }}>
          Breakdown
        </DialogTitle>
        <DialogContent sx={{ bgcolor: "rgba(2,6,23,0.98)", color: "rgba(255,255,255,0.80)" }}>
          <Stack spacing={1.2} sx={{ mt: 0.5 }}>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.72)" }}>Calories eaten</Typography>
              <Typography sx={{ fontWeight: 900 }}>{Math.round(bundle.totals.consumed)} kcal</Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.72)" }}>Exercise</Typography>
              <Typography sx={{ fontWeight: 900 }}>{Math.round(bundle.totals.burned)} kcal</Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.72)" }}>Net</Typography>
              <Typography sx={{ fontWeight: 900 }}>{Math.round(bundle.totals.netKcal)} kcal</Typography>
            </Stack>

            <Divider sx={{ borderColor: "rgba(148,163,184,0.18)" }} />

            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.72)" }}>Protein</Typography>
              <Typography sx={{ fontWeight: 900 }}>{Math.round(bundle.totals.macros.protein_g)} g</Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.72)" }}>Carbs</Typography>
              <Typography sx={{ fontWeight: 900 }}>{Math.round(bundle.totals.macros.carbs_g)} g</Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.72)" }}>Fats</Typography>
              <Typography sx={{ fontWeight: 900 }}>{Math.round(bundle.totals.macros.fat_g)} g</Typography>
            </Stack>

            <Divider sx={{ borderColor: "rgba(148,163,184,0.18)" }} />

            <Box sx={{ mt: 0.3, p: 1, borderRadius: 2, border: "1px solid rgba(148,163,184,0.18)" }}>
              <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.60)" }}>
                {metabolismLine} • {targetLine}
              </Typography>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ bgcolor: "rgba(2,6,23,0.98)" }}>
          <Button onClick={() => setShowBreakdown(false)} sx={{ borderRadius: 999, fontWeight: 900 }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Swipeable card row */}
      <Box
        sx={{
          mt: 2,
          display: "flex",
          gap: 1.5,
          overflowX: "auto",
          pb: 1,
          scrollSnapType: "x mandatory",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {/* Card 1: Scoreboard */}
        <CardShell
          title="Today"
          subtitle="Tap a circle"
          chip={
            <Chip
              label={`${scoreAnim}/100`}
              sx={{ fontWeight: 950, borderRadius: 999 }}
              color={scoreAnim >= 88 ? "success" : scoreAnim >= 74 ? "primary" : "error"}
            />
          }
        >
          <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.60)" }}>
            1/3 • Scoreboard
          </Typography>

          <Stack spacing={1.25} sx={{ mt: 1.2 }} alignItems="center">
            {/* Main rings */}
            <Stack direction="row" spacing={1.2} justifyContent="center" alignItems="center" sx={{ width: "100%", flexWrap: "wrap" }}>
              <Box
                onPointerDown={() => startHold("calories")}
                onPointerUp={endHold}
                onPointerLeave={endHold}
                onClick={() => setActiveRing((v) => (v === "calories" ? null : "calories"))}
                sx={{ cursor: "pointer" }}
              >
                <Ring
                  pct={bundle.targets.calorieTarget ? calQuality : 0}
                  size={112}
                  label="Calories"
                  value={bundle.targets.calorieTarget ? `${Math.round(calQuality)}%` : "—"}
                  tone="primary.main"
                />
              </Box>

              <Box
                onPointerDown={() => startHold("protein")}
                onPointerUp={endHold}
                onPointerLeave={endHold}
                onClick={() => setActiveRing((v) => (v === "protein" ? null : "protein"))}
                sx={{ cursor: "pointer" }}
              >
                <Ring
                  pct={proteinPct}
                  size={112}
                  label="Protein"
                  value={`${Math.round(bundle.totals.macros.protein_g)}g`}
                  tone="success.main"
                />
              </Box>

              <Box
                onPointerDown={() => startHold("exercise")}
                onPointerUp={endHold}
                onPointerLeave={endHold}
                onClick={() => setActiveRing((v) => (v === "exercise" ? null : "exercise"))}
                sx={{ cursor: "pointer" }}
              >
                <Ring
                  pct={exercisePct}
                  size={112}
                  label="Exercise"
                  value={bundle.derived.hasWorkout ? `${Math.round(bundle.totals.burned)} kcal` : "—"}
                  tone="warning.main"
                />
              </Box>
            </Stack>

            {/* Mini rings for carbs & fats (adds info without clutter) */}
            <Stack direction="row" spacing={1} justifyContent="center" alignItems="center" sx={{ width: "100%" }}>
              <Box
                onPointerDown={() => startHold("carbs")}
                onPointerUp={endHold}
                onPointerLeave={endHold}
                onClick={() => setActiveRing((v) => (v === "carbs" ? null : "carbs"))}
                sx={{ cursor: "pointer" }}
              >
                <Ring pct={carbsPct} size={78} label="Carbs" value={`${Math.round(bundle.totals.macros.carbs_g)}g`} tone="info.main" />
              </Box>

              <Box
                onPointerDown={() => startHold("fats")}
                onPointerUp={endHold}
                onPointerLeave={endHold}
                onClick={() => setActiveRing((v) => (v === "fats" ? null : "fats"))}
                sx={{ cursor: "pointer" }}
              >
                <Ring pct={fatsPct} size={78} label="Fats" value={`${Math.round(bundle.totals.macros.fat_g)}g`} tone="secondary.main" />
              </Box>
            </Stack>

            {/* Simple status lines */}
            <Typography sx={{ fontWeight: 950, color: "rgba(255,255,255,0.86)", textAlign: "center" }}>
              {bundle.derived.score >= 74 ? "Close." : "Loose pattern."}
            </Typography>
            <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.68)", textAlign: "center" }}>
              Tap a circle to see what to do.
            </Typography>

            {/* Tap-to-reveal panel (still short) */}
            {activeRing && (
              <Box
                sx={{
                  width: "100%",
                  p: 1.2,
                  borderRadius: 2,
                  border: "1px solid rgba(148,163,184,0.18)",
                  background: "rgba(15,23,42,0.6)",
                }}
              >
                {activeRing === "calories" && (
                  <Stack spacing={0.6} alignItems="center">
                    <Typography sx={{ fontWeight: 950 }}>Calories</Typography>
                    <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.74)", textAlign: "center" }}>
                      {bundle.targets.calorieTarget
                        ? (bundle.totals.consumed <= bundle.targets.calorieTarget
                          ? `You have ~${Math.round(bundle.targets.calorieTarget - bundle.totals.consumed)} calories left.`
                          : `You’re ~${Math.round(bundle.totals.consumed - bundle.targets.calorieTarget)} over target.`)
                        : "Set a calorie target to unlock accurate scoring."}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.55)", textAlign: "center" }}>
                      Press & hold any circle for full breakdown.
                    </Typography>
                  </Stack>
                )}

                {activeRing === "protein" && (
                  <Stack spacing={0.6} alignItems="center">
                    <Typography sx={{ fontWeight: 950 }}>Protein</Typography>
                    <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.74)", textAlign: "center" }}>
                      {bundle.targets.proteinTarget
                        ? (proteinGap > 0 ? `You’re short ~${Math.round(proteinGap)}g. Eat protein next.` : "You hit your protein target. Great.")
                        : "Set a protein target to make this meaningful."}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.55)", textAlign: "center" }}>
                      Easiest win: chicken, eggs, greek yogurt, shake.
                    </Typography>
                  </Stack>
                )}

                {activeRing === "exercise" && (
                  <Stack spacing={0.6} alignItems="center">
                    <Typography sx={{ fontWeight: 950 }}>Exercise</Typography>
                    <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.74)", textAlign: "center" }}>
                      {bundle.derived.hasWorkout ? "Workout logged ✅" : "No workout logged yet ⚠️"}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.55)", textAlign: "center" }}>
                      If you worked out, log it so it counts.
                    </Typography>
                  </Stack>
                )}

                {activeRing === "carbs" && (
                  <Stack spacing={0.6} alignItems="center">
                    <Typography sx={{ fontWeight: 950 }}>Carbs</Typography>
                    <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.74)", textAlign: "center" }}>
                      Carbs help training. Keep them reasonable for your goal.
                    </Typography>
                    <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.55)", textAlign: "center" }}>
                      Press & hold for breakdown.
                    </Typography>
                  </Stack>
                )}

                {activeRing === "fats" && (
                  <Stack spacing={0.6} alignItems="center">
                    <Typography sx={{ fontWeight: 950 }}>Fats</Typography>
                    <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.74)", textAlign: "center" }}>
                      Fats support hormones & hunger control. Don’t go crazy.
                    </Typography>
                    <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.55)", textAlign: "center" }}>
                      Press & hold for breakdown.
                    </Typography>
                  </Stack>
                )}
              </Box>
            )}

            {flag && (
              <Chip
                icon={<WarningAmberIcon sx={{ color: "inherit" }} />}
                label={flag.label}
                color={flag.tone}
                sx={{ mt: 0.5, fontWeight: 950, borderRadius: 999 }}
              />
            )}

            <Stack direction="row" spacing={1} alignItems="center" justifyContent="center" sx={{ mt: 0.5 }}>
              <InfoOutlinedIcon sx={{ fontSize: 18, color: "rgba(255,255,255,0.62)" }} />
              <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.60)" }}>
                Tap a circle • Swipe for the fix • Press & hold for details
              </Typography>
            </Stack>
          </Stack>
        </CardShell>

        {/* Card 2: Pick 1 fix (no slider) */}
        <CardShell
          title="Fix"
          subtitle="Pick 1 thing"
          chip={<Chip size="small" label="2/3" sx={{ fontWeight: 950, borderRadius: 999, ...macroChipSx }} />}
        >
          <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.60)" }}>
            2/3 • Do this now
          </Typography>

          <Stack spacing={1.2} sx={{ mt: 1.1 }} alignItems="center">
            <Typography sx={{ fontWeight: 950, textAlign: "center" }}>
              Step 1: Pick one
            </Typography>

            <Stack spacing={1} sx={{ width: "100%" }}>
              {fixOptions.map((o) => {
                const active = o.key === selectedFix;
                return (
                  <Box
                    key={o.key}
                    onClick={() => setSelectedFix(o.key)}
                    sx={{
                      p: 1.1,
                      borderRadius: 2,
                      cursor: "pointer",
                      border: active ? "1px solid rgba(59,130,246,0.65)" : "1px solid rgba(148,163,184,0.18)",
                      background: active ? "rgba(59,130,246,0.14)" : "rgba(15,23,42,0.55)",
                    }}
                  >
                    <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 950, color: "rgba(255,255,255,0.92)" }}>{o.label}</Typography>
                        <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.68)" }}>{o.hint}</Typography>
                      </Box>
                      <Chip
                        size="small"
                        label={active ? "SELECTED" : "TAP"}
                        color={active ? "primary" : "default"}
                        sx={{
                          fontWeight: 950,
                          borderRadius: 999,
                          ...(active
                            ? {}
                            : {
                                bgcolor: "rgba(255,255,255,0.08)",
                                color: "rgba(255,255,255,0.86)",
                                border: "1px solid rgba(255,255,255,0.16)",
                              }),
                        }}
                      />
                    </Stack>
                  </Box>
                );
              })}
            </Stack>

            <Typography sx={{ fontWeight: 950, textAlign: "center" }}>
              Step 2: Do it
            </Typography>

            <Button
              variant="contained"
              onClick={() => {
                if (!selectedFixObj) return;
                history.push(selectedFixObj.go);
              }}
              sx={{ mt: 0.2, borderRadius: 999, fontWeight: 950, px: 3.2, py: 1.1 }}
            >
              Do this now
            </Button>

            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.55)", textAlign: "center" }}>
              One tap. One action. Then swipe to see if you won.
            </Typography>
          </Stack>
        </CardShell>

        {/* Card 3: Win-first */}
        <CardShell
          title="Win"
          subtitle="Your status today"
          chip={<Chip size="small" label="3/3" sx={{ fontWeight: 950, borderRadius: 999, ...macroChipSx }} />}
        >
          <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.60)" }}>
            3/3 • Reveal
          </Typography>

          <Stack spacing={1.1} sx={{ mt: 1.1 }} alignItems="center">
            {/* Big win/not yet badge */}
            <Box
              sx={{
                width: 200,
                borderRadius: 999,
                border: "1px solid rgba(148,163,184,0.22)",
                px: 2,
                py: 1.4,
                textAlign: "center",
                background: win.state === "win" ? "rgba(34,197,94,0.14)" : "rgba(245,158,11,0.12)",
              }}
            >
              <Typography sx={{ fontWeight: 950, fontSize: 20, color: "rgba(255,255,255,0.92)" }}>
                {win.state === "win" ? "WIN ✅" : "NOT YET ⚠️"}
              </Typography>
              <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.70)" }}>
                {win.reason}
              </Typography>
            </Box>

            {/* Hidden grade (tap to reveal) */}
            <Box
              onClick={() => setShowGradeDetails((v) => !v)}
              sx={{
                width: "100%",
                p: 1.1,
                borderRadius: 2,
                cursor: "pointer",
                border: "1px solid rgba(148,163,184,0.18)",
                background: "rgba(15,23,42,0.55)",
              }}
            >
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                <Typography sx={{ fontWeight: 900, color: "rgba(255,255,255,0.86)" }}>
                  {showGradeDetails ? `Grade: ${gradeFromScore(bundle.derived.score)} (${bundle.derived.score}/100)` : "Tap to see details"}
                </Typography>
                <Chip
                  size="small"
                  label={showGradeDetails ? "HIDE" : "SHOW"}
                  sx={{ fontWeight: 950, borderRadius: 999, ...macroChipSx }}
                />
              </Stack>

              {showGradeDetails && (
                <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.65)", display: "block", mt: 0.5 }}>
                  Calories: {Math.round(bundle.totals.consumed)} • Exercise: {Math.round(bundle.totals.burned)} • Net: {Math.round(bundle.totals.netKcal)} •
                  Protein: {Math.round(bundle.totals.macros.protein_g)}g • Carbs: {Math.round(bundle.totals.macros.carbs_g)}g • Fats: {Math.round(bundle.totals.macros.fat_g)}g
                </Typography>
              )}
            </Box>

            {/* AI Coach (gated) */}
            <Button
              onClick={handleGenerateAiVerdict}
              variant="contained"
              disabled={aiLoading}
              sx={{ borderRadius: 999, fontWeight: 950, px: 3.2, py: 1.1 }}
            >
              {aiLoading ? "Coach is grading…" : "Get Coach Verdict"}
            </Button>

            {!!aiError && (
              <Typography variant="body2" sx={{ color: "rgba(248,113,113,0.95)", textAlign: "center" }}>
                {aiError}
              </Typography>
            )}

            {!!aiVerdict && (
              <Box
                sx={{
                  width: "100%",
                  p: 1.2,
                  borderRadius: 2,
                  border: "1px solid rgba(148,163,184,0.18)",
                  background: "rgba(15,23,42,0.6)",
                }}
              >
                <Typography sx={{ fontWeight: 950, mb: 0.6 }}>Coach Verdict</Typography>
                <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.80)", whiteSpace: "pre-wrap" }}>
                  {aiVerdict}
                </Typography>
              </Box>
            )}

            {/* Actions (centered, matching palette) */}
            <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="center" alignItems="center" sx={{ width: "100%" }}>
              <Button
                variant="contained"
                onClick={() => history.push("/meals")}
                sx={{ borderRadius: 999, fontWeight: 950, px: 2.6, py: 1.05 }}
              >
                Log Meal
              </Button>

              <Button
                variant="contained"
                onClick={() => history.push("/workout")}
                sx={{ borderRadius: 999, fontWeight: 950, px: 2.6, py: 1.05 }}
              >
                Log Workout
              </Button>

              {!bundle.derived.profileComplete && (
                <Button
                  variant="outlined"
                  onClick={() => history.push("/health")}
                  sx={{ borderRadius: 999, fontWeight: 950 }}
                >
                  Finish Health Setup
                </Button>
              )}

              <Button
                variant="outlined"
                startIcon={<IosShareIcon />}
                disabled={!aiVerdict && !bundle.derived.hasLogs}
                onClick={handleShare}
                sx={{ borderRadius: 999, fontWeight: 950 }}
              >
                Share
              </Button>
            </Stack>

            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.55)", textAlign: "center" }}>
              Remaining coach uses today: {Math.max(0, remainingAi)} / {limitAi}
            </Typography>
          </Stack>
        </CardShell>
      </Box>

      <Typography variant="caption" sx={{ display: "block", mt: 1, color: "rgba(255,255,255,0.55)" }}>
        Tip: Don’t overthink. Swipe → pick 1 → do it.
      </Typography>

      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
    </Box>
  );
}
