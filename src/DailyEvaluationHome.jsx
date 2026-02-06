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
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
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
 * DailyEvaluationHome — Win-first + Action Checklist v2
 * - Card 1: Calories + Exercise top row; macros row below
 * - Card 2: Goal-aware, time-aware checklist with:
 *    - Manual morning "Rehydrate" checkbox (stored per-day)
 *    - Meal step that never jumps to "dinner" from a single morning entry
 *    - Specific action steps (remaining grams, clear intent)
 * - Card 3: Personal coach message (AI), gating unchanged
 *
 * IMPORTANT: UI/copy only. No change to persistence/sync logic.
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

// ----------------------------- scoring (unchanged) ----------------------------
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

function computeWinState({ score, confidenceLabel, profileComplete, hasLogs }) {
  if (!profileComplete) return { state: "notyet", reason: "Finish setup to personalize your win." };
  if (!hasLogs) return { state: "notyet", reason: "Log at least 1 meal or a workout." };
  if (confidenceLabel === "Low") return { state: "notyet", reason: "Log a bit more so it’s accurate." };
  if (score >= 74) return { state: "win", reason: "Solid day. Repeat this." };
  return { state: "notyet", reason: "Close. Do the next step to win." };
}

// ----------------------------- UI primitives ---------------------------------
function CardShell({ title, subtitle, children, right }) {
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
            <Typography sx={{ fontWeight: 950, letterSpacing: -0.2, color: "rgba(255,255,255,0.94)" }}>
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.70)" }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          {right}
        </Stack>
        <Divider sx={{ my: 1.4, borderColor: "rgba(148,163,184,0.18)" }} />
        {children}
      </CardContent>
    </Card>
  );
}

function Ring({ pct, size, title, primary, secondary, tone = "primary.main" }) {
  const v = clamp(Number(pct || 0), 0, 100);
  return (
    <Box sx={{ position: "relative", width: size, height: size, flex: "0 0 auto" }}>
      <CircularProgress variant="determinate" value={100} size={size} thickness={5} sx={{ color: "rgba(255,255,255,0.12)" }} />
      <CircularProgress
        variant="determinate"
        value={v}
        size={size}
        thickness={5}
        sx={{ color: tone, position: "absolute", left: 0, top: 0 }}
      />
      <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", px: 0.8 }}>
        <Box>
          <Typography sx={{ fontWeight: 950, fontSize: size >= 140 ? 18 : 14, lineHeight: 1.05, color: "rgba(255,255,255,0.94)" }}>
            {primary}
          </Typography>
          {secondary && (
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.72)", display: "block", mt: 0.25 }}>
              {secondary}
            </Typography>
          )}
          <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.74)", display: "block", mt: 0.25 }}>
            {title}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

// ----------------------------- checklist logic --------------------------------
function getMealStep({ hour, mealsCount }) {
  // We do NOT assume mealsCount == “meal events” because users may log individual foods.
  // So keep it conservative:
  // 0 -> breakfast, 1 -> next meal, 2 -> dinner later, >=3 -> optional snack.
  if (mealsCount <= 0) return { step: "breakfast", title: hour < 11 ? "Log breakfast" : "Log your first meal" };
  if (mealsCount === 1) return { step: "next", title: hour < 15 ? "Log lunch" : "Log your next meal" };
  if (mealsCount === 2) return { step: "next", title: hour < 17 ? "Log your next meal" : "Log dinner" };
  if (mealsCount >= 3) return { step: "snack", title: "Log a snack (optional)" };
  return { step: "next", title: "Log your next meal" };
}

function buildChecklist({
  goalType,
  profileComplete,
  mealsCount,
  hasWorkout,
  proteinG,
  carbsG,
  fatG,
  proteinTarget,
  carbsTarget,
  fatTarget,
  dayHydrationDone,
}) {
  const g = normalizeGoalType(goalType);
  const hour = new Date().getHours();

  const items = [];

  // Setup (hide when done)
  items.push({
    key: "setup",
    title: "Finish setup",
    subtitle: "So your targets are accurate",
    done: !!profileComplete,
    action: "/health",
    priority: 0,
    hiddenWhenDone: true,
    manual: false,
  });

  // Manual hydration checkbox (only relevant morning-ish, but user controls it)
  items.push({
    key: "rehydrate",
    title: "Rehydrate",
    subtitle: hour < 12 ? "Water + electrolytes" : "Water (quick reset)",
    done: !!dayHydrationDone,
    action: null,
    priority: 1,
    hiddenWhenDone: false,
    manual: true,
  });

  // Meal logging step (time-aware, but never marks “done” just because you logged *something*)
  const mealStep = getMealStep({ hour, mealsCount });
  const mealDone = mealsCount >= 1 && mealStep.step === "snack"; // only truly “done” when they've logged 3+ entries
  items.push({
    key: "meal_step",
    title: mealStep.title,
    subtitle: "So today counts",
    done: mealDone,
    action: "/meals",
    priority: 2,
    hiddenWhenDone: false,
    manual: false,
  });

  // Specific protein action
  const pGap = Math.max(0, (Number(proteinTarget) || 0) - (Number(proteinG) || 0));
  const pNeed = Math.round(Math.min(45, pGap || 0));

  if ((Number(proteinTarget) || 0) > 0) {
    items.push({
      key: "protein",
      title: pGap > 0 ? "Hit protein target" : "Protein on track",
      subtitle: pGap > 0 ? `Add ~${pNeed}g protein` : "Keep it steady",
      done: pGap <= 0,
      action: "/meals",
      priority: 3,
      hiddenWhenDone: false,
      manual: false,
    });
  }

  // Goal-aware fuel step (bulk: carbs; cut: steps; maintain: move)
  if (g === "bulk") {
    const cGap = Math.max(0, (Number(carbsTarget) || 0) - (Number(carbsG) || 0));
    const cNeed = Math.round(Math.min(90, cGap || 0));

    items.push({
      key: "fuel",
      title: cGap > 0 ? "Fuel training (carbs)" : "Carbs on track",
      subtitle: cGap > 0 ? `Add ~${cNeed}g carbs` : "Nice",
      done: cGap <= 0,
      action: "/meals",
      priority: 4,
      hiddenWhenDone: false,
      manual: false,
    });
  } else if (g === "cut") {
    items.push({
      key: "steps",
      title: "10‑min walk",
      subtitle: "Easy deficit win",
      done: false, // we can't reliably detect steps; keep as a gentle action
      action: "/workout",
      priority: 4,
      hiddenWhenDone: false,
      manual: false,
    });
  } else {
    items.push({
      key: "move",
      title: "Move 10 minutes",
      subtitle: "Keeps your day clean",
      done: false,
      action: "/workout",
      priority: 4,
      hiddenWhenDone: false,
      manual: false,
    });
  }

  // Workout logging (detectable)
  items.push({
    key: "workout",
    title: hasWorkout ? "Workout logged" : "Log workout",
    subtitle: hasWorkout ? "Counts toward your day" : "So exercise counts",
    done: !!hasWorkout,
    action: "/workout",
    priority: 5,
    hiddenWhenDone: false,
    manual: false,
  });

  // Order + prune (max 6 visible; checklist feels satisfying)
  const visible = items
    .filter((it) => !(it.hiddenWhenDone && it.done))
    .sort((a, b) => a.priority - b.priority);

  return visible.slice(0, 6);
}

// ----------------------------- main ------------------------------------------
export default function DailyEvaluationHome() {
  const history = useHistory();
  const { isProActive } = useEntitlements();
  const pro = !!isProActive || localStorage.getItem("isPro") === "true";

  const { user } = useAuth();
  const userId = user?.id || null;

  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // ring breakdown
  const [activeRing, setActiveRing] = useState(null);
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

  // Card 3 details
  const [showNumbers, setShowNumbers] = useState(false);

  // AI verdict state (gating unchanged)
  const [aiLoading, setAiLoading] = useState(false);
  const [aiVerdict, setAiVerdict] = useState("");
  const [aiError, setAiError] = useState("");

  // animated score badge
  const [scoreAnim, setScoreAnim] = useState(0);

  const FEATURE_KEY = "daily_eval_verdict";

  const bundle = useMemo(() => {
    const dayUS = usDay();
    const dayISO = isoDay();

    const userData = safeJsonParse(localStorage.getItem("userData"), {}) || {};

    // scoped keys
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
    const mealsCount = Array.isArray(dayMealsRec?.meals) ? dayMealsRec.meals.length : 0;

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

    // if you have macro targets in profile, prefer them; otherwise fall back to reasonable defaults
    const carbsTarget =
      Number(userData?.carbTargets?.daily_g) ||
      Number(localStorage.getItem("carb_target_daily_g") || 0) ||
      320;

    const fatTarget =
      Number(userData?.fatTargets?.daily_g) ||
      Number(localStorage.getItem("fat_target_daily_g") || 0) ||
      110;

    const goalType = normalizeGoalType(userData?.goalType);

    const bmrEst = Number(userData?.bmr_est) || Number(localStorage.getItem("bmr_est") || 0) || 0;
    const tdeeEst = Number(userData?.tdee_est) || Number(localStorage.getItem("tdee_est") || 0) || 0;

    const profileComplete = hasBmrInputs(userData) && !!userData?.goalType;

    const hasMeals = consumedFinal > 0 || mealsCount > 0;
    const hasWorkout = burnedFinal > 0;
    const hasLogs = hasMeals || hasWorkout;

    const fallbackProteinTarget = goalType === "cut" ? 140 : 120;
    const pTarget = Number(proteinTarget) || fallbackProteinTarget;

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

    return {
      dayUS,
      dayISO,
      profile: userData,
      targets: { calorieTarget, proteinTarget: pTarget, carbsTarget, fatTarget, goalType },
      totals: { consumed: consumedFinal, burned: burnedFinal, netKcal, macros, mealsCount },
      est: { bmr_est: bmrEst || 0, tdee_est: tdeeEst || 0 },
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

  // per-day hydration manual checkbox
  const hydrationKey = useMemo(() => {
    const uid = userId || bundle?.profile?.id || bundle?.profile?.user_id || "guest";
    return `dailyEvalHydrationDone:${uid}:${bundle.dayISO}`;
  }, [userId, bundle?.profile, bundle.dayISO]);

  const [hydrationDone, setHydrationDone] = useState(() => safeJsonParse(localStorage.getItem(hydrationKey), false) === true);
  useEffect(() => {
    const v = safeJsonParse(localStorage.getItem(hydrationKey), false) === true;
    setHydrationDone(v);
  }, [hydrationKey]);

  const toggleHydration = () => {
    const next = !hydrationDone;
    setHydrationDone(next);
    try {
      localStorage.setItem(hydrationKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

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

  // ring progress
  const calorieTarget = bundle.targets.calorieTarget;
  const consumed = bundle.totals.consumed;

  const calErr = calorieTarget ? Math.abs(consumed - calorieTarget) : Math.abs(bundle.totals.netKcal);
  const calScale = calorieTarget ? Math.max(500, calorieTarget) : 700;
  const calQuality = calorieTarget ? clamp(100 - (calErr / calScale) * 100, 0, 100) : 0;

  const proteinPct = clamp((bundle.totals.macros.protein_g / Math.max(1, bundle.targets.proteinTarget)) * 100, 0, 100);
  const carbsPct = clamp((bundle.totals.macros.carbs_g / Math.max(1, bundle.targets.carbsTarget)) * 100, 0, 100);
  const fatsPct = clamp((bundle.totals.macros.fat_g / Math.max(1, bundle.targets.fatTarget)) * 100, 0, 100);

  const exercisePct = bundle.derived.hasWorkout ? clamp((bundle.totals.burned / 220) * 100, 0, 100) : 0;

  // flags
  const proteinGap = Math.max(0, bundle.targets.proteinTarget - bundle.totals.macros.protein_g);
  const flag = useMemo(() => {
    if (!bundle.derived.profileComplete || !bundle.derived.hasMeals) {
      return { label: "ORANGE FLAG: NEEDS DATA", tone: "warning" };
    }
    if (bundle.targets.proteinTarget && proteinGap >= 25) {
      return { label: "PROTEIN LOW", tone: "error" };
    }
    if (bundle.targets.calorieTarget && calErr > 450) {
      return { label: "CALORIES OFF", tone: "warning" };
    }
    return { label: "ON TRACK", tone: "success" };
  }, [bundle.derived.profileComplete, bundle.derived.hasMeals, bundle.targets.proteinTarget, proteinGap, bundle.targets.calorieTarget, calErr]);

  // checklist (uses manual hydrationDone)
  const checklist = useMemo(() => {
    return buildChecklist({
      goalType: bundle.targets.goalType,
      profileComplete: bundle.derived.profileComplete,
      mealsCount: bundle.totals.mealsCount,
      hasWorkout: bundle.derived.hasWorkout,
      proteinG: bundle.totals.macros.protein_g,
      carbsG: bundle.totals.macros.carbs_g,
      fatG: bundle.totals.macros.fat_g,
      proteinTarget: bundle.targets.proteinTarget,
      carbsTarget: bundle.targets.carbsTarget,
      fatTarget: bundle.targets.fatTarget,
      dayHydrationDone: hydrationDone,
    });
  }, [bundle, hydrationDone]);

  const nextTodo = useMemo(() => checklist.find((i) => !i.done && (i.action || i.manual)) || null, [checklist]);

  // AI gating
  const remainingAi = getDailyRemaining("daily_eval_verdict");
  const limitAi = getFreeDailyLimit("daily_eval_verdict");

  const openUpgrade = () => setUpgradeOpen(true);

  const handleGenerateAiVerdict = async () => {
    setAiError("");
    setAiVerdict("");

    if (!pro) {
      if (!canUseDailyFeature("daily_eval_verdict")) {
        openUpgrade();
        return;
      }
      registerDailyFeatureUse("daily_eval_verdict");
    }

    setAiLoading(true);
    try {
      const goalType = normalizeGoalType(bundle.profile?.goalType);
      const hasEst = !!bundle.est.tdee_est && !!bundle.est.bmr_est;

      const payload = {
        feature: "daily_eval_verdict",
        prompt: `
You are SlimCal Coach. Write a short, personal message for the user.
Rules:
- 2–4 sentences max.
- supportive, simple language.
- Use numbers: calories eaten, exercise, net, protein, carbs, fats; include targets when available.
- Mention goal type (${goalType}).
- End with 2 bullets: "Next: ___" and "Tonight: ___".
Data:
Day: ${bundle.dayUS}
Goal: ${goalType}
Calories: ${Math.round(bundle.totals.consumed)} / ${bundle.targets.calorieTarget ? Math.round(bundle.targets.calorieTarget) : "—"}
Exercise: ${Math.round(bundle.totals.burned)} kcal
Net: ${Math.round(bundle.totals.netKcal)} kcal
Protein: ${Math.round(bundle.totals.macros.protein_g)} / ${Math.round(bundle.targets.proteinTarget)} g
Carbs: ${Math.round(bundle.totals.macros.carbs_g)} / ${Math.round(bundle.targets.carbsTarget)} g
Fats: ${Math.round(bundle.totals.macros.fat_g)} / ${Math.round(bundle.targets.fatTarget)} g
Metabolism: ${hasEst ? `BMR ${Math.round(bundle.est.bmr_est)}, TDEE ${Math.round(bundle.est.tdee_est)}` : "n/a"}
Confidence: ${bundle.derived.confidenceLabel}
Win: ${win.state}
`.trim(),
      };

      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || data?.message || "Coach message failed.";
        throw new Error(msg);
      }

      const text =
        data?.text ||
        data?.result ||
        data?.output ||
        data?.message ||
        data?.choices?.[0]?.message?.content ||
        "";

      if (!String(text || "").trim()) throw new Error("No coach text returned.");
      setAiVerdict(String(text).trim());
    } catch (e) {
      setAiError(e?.message || "Coach message failed.");
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

  const metabolismLine =
    bundle.est.bmr_est && bundle.est.tdee_est
      ? `BMR ${Math.round(bundle.est.bmr_est)} • TDEE ${Math.round(bundle.est.tdee_est)}`
      : "Set up Health Data to unlock BMR/TDEE";

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1150, mx: "auto" }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ xs: "flex-start", sm: "center" }} justifyContent="space-between">
        <Box>
          <Typography sx={{ fontWeight: 950, letterSpacing: -0.4, fontSize: 22, color: "rgba(2,6,23,0.98)" }}>
            Daily Evaluation
          </Typography>
          <Typography variant="caption" sx={{ color: "rgba(2,6,23,0.70)" }}>
            {bundle.dayUS} • swipe → do next → win
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
          {!pro && <FeatureUseBadge featureKey={FEATURE_KEY} isPro={false} labelPrefix="Coach" />}
          {pro && <FeatureUseBadge featureKey={FEATURE_KEY} isPro={true} labelPrefix="Coach" />}
        </Stack>
      </Stack>

      {/* Breakdown */}
      <Dialog open={showBreakdown} onClose={() => setShowBreakdown(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 950, color: "rgba(255,255,255,0.92)", bgcolor: "rgba(2,6,23,0.98)" }}>
          Breakdown
        </DialogTitle>
        <DialogContent sx={{ bgcolor: "rgba(2,6,23,0.98)", color: "rgba(255,255,255,0.80)" }}>
          <Stack spacing={1.2} sx={{ mt: 0.5 }}>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.72)" }}>Calories</Typography>
              <Typography sx={{ fontWeight: 900 }}>{Math.round(bundle.totals.consumed)} / {bundle.targets.calorieTarget ? Math.round(bundle.targets.calorieTarget) : "—"} kcal</Typography>
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
              <Typography sx={{ fontWeight: 900 }}>{Math.round(bundle.totals.macros.protein_g)} / {Math.round(bundle.targets.proteinTarget)} g</Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.72)" }}>Carbs</Typography>
              <Typography sx={{ fontWeight: 900 }}>{Math.round(bundle.totals.macros.carbs_g)} / {Math.round(bundle.targets.carbsTarget)} g</Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.72)" }}>Fats</Typography>
              <Typography sx={{ fontWeight: 900 }}>{Math.round(bundle.totals.macros.fat_g)} / {Math.round(bundle.targets.fatTarget)} g</Typography>
            </Stack>

            <Divider sx={{ borderColor: "rgba(148,163,184,0.18)" }} />

            <Box sx={{ mt: 0.3, p: 1, borderRadius: 2, border: "1px solid rgba(148,163,184,0.18)" }}>
              <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.60)" }}>
                {metabolismLine}
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

      {/* Cards */}
      <Box sx={{ mt: 2, display: "flex", gap: 1.5, overflowX: "auto", pb: 1, scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}>
        {/* Card 1 */}
        <CardShell
          title="Today"
          subtitle="Tap a ring • hold for breakdown"
          right={
            <Chip
              label={`${scoreAnim}/100`}
              sx={{ fontWeight: 950, borderRadius: 999 }}
              color={scoreAnim >= 88 ? "success" : scoreAnim >= 74 ? "primary" : "error"}
            />
          }
        >
          <Stack spacing={1.2} alignItems="center">
            {/* Top row: Calories + Exercise */}
            <Stack direction="row" spacing={2.0} justifyContent="center" alignItems="center" sx={{ width: "100%", flexWrap: "wrap" }}>
              <Box
                onPointerDown={() => startHold("calories")}
                onPointerUp={endHold}
                onPointerLeave={endHold}
                onClick={() => setActiveRing((v) => (v === "calories" ? null : "calories"))}
                sx={{ cursor: "pointer" }}
              >
                <Ring
                  pct={bundle.targets.calorieTarget ? calQuality : 0}
                  size={148}
                  title="Calories"
                  primary={`${Math.round(calQuality)}%`}
                  secondary={`${Math.round(bundle.totals.consumed)} / ${bundle.targets.calorieTarget ? Math.round(bundle.targets.calorieTarget) : "—"} kcal`}
                  tone="primary.main"
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
                  size={148}
                  title="Exercise"
                  primary={`${Math.round(bundle.totals.burned)} kcal`}
                  secondary={bundle.derived.hasWorkout ? "logged" : "not logged"}
                  tone="warning.main"
                />
              </Box>
            </Stack>

            {/* Macros row */}
            <Stack direction="row" spacing={1.2} justifyContent="center" alignItems="center" sx={{ width: "100%", flexWrap: "wrap" }}>
              <Box onPointerDown={() => startHold("protein")} onPointerUp={endHold} onPointerLeave={endHold} onClick={() => setActiveRing((v) => (v === "protein" ? null : "protein"))} sx={{ cursor: "pointer" }}>
                <Ring pct={proteinPct} size={96} title="Protein" primary={`${Math.round(bundle.totals.macros.protein_g)}g`} secondary={`of ${Math.round(bundle.targets.proteinTarget)}g`} tone="success.main" />
              </Box>

              <Box onPointerDown={() => startHold("carbs")} onPointerUp={endHold} onPointerLeave={endHold} onClick={() => setActiveRing((v) => (v === "carbs" ? null : "carbs"))} sx={{ cursor: "pointer" }}>
                <Ring pct={carbsPct} size={96} title="Carbs" primary={`${Math.round(bundle.totals.macros.carbs_g)}g`} secondary={`of ${Math.round(bundle.targets.carbsTarget)}g`} tone="info.main" />
              </Box>

              <Box onPointerDown={() => startHold("fats")} onPointerUp={endHold} onPointerLeave={endHold} onClick={() => setActiveRing((v) => (v === "fats" ? null : "fats"))} sx={{ cursor: "pointer" }}>
                <Ring pct={fatsPct} size={96} title="Fats" primary={`${Math.round(bundle.totals.macros.fat_g)}g`} secondary={`of ${Math.round(bundle.targets.fatTarget)}g`} tone="secondary.main" />
              </Box>
            </Stack>

            <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.78)", textAlign: "center" }}>
              Tap a ring to see what matters today.
            </Typography>

            <Chip icon={<WarningAmberIcon sx={{ color: "inherit" }} />} label={flag.label} color={flag.tone} sx={{ mt: 0.2, fontWeight: 950, borderRadius: 999 }} />

            <Stack direction="row" spacing={1} alignItems="center" justifyContent="center" sx={{ mt: 0.3 }}>
              <InfoOutlinedIcon sx={{ fontSize: 18, color: "rgba(255,255,255,0.62)" }} />
              <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.60)" }}>
                Tap a ring • Hold for breakdown • Swipe for your steps
              </Typography>
            </Stack>
          </Stack>
        </CardShell>

        {/* Card 2 */}
        <CardShell title="Fix" subtitle="Do the next step">
          <Stack spacing={1.1} alignItems="center">
            <Typography sx={{ fontWeight: 950, textAlign: "center" }}>Today’s steps</Typography>

            <Box sx={{ width: "100%", borderRadius: 2, border: "1px solid rgba(148,163,184,0.18)", background: "rgba(15,23,42,0.55)" }}>
              <List disablePadding>
                {checklist.map((it, idx) => {
                  const Icon = it.done ? CheckCircleIcon : RadioButtonUncheckedIcon;
                  const iconColor = it.done ? "rgba(34,197,94,0.92)" : "rgba(255,255,255,0.55)";
                  const isActionable = !it.done && (it.action || it.manual);

                  return (
                    <ListItemButton
                      key={it.key}
                      onClick={() => {
                        if (it.manual && it.key === "rehydrate") {
                          toggleHydration();
                          return;
                        }
                        if (it.action) history.push(it.action);
                      }}
                      sx={{
                        px: 1.2,
                        py: 1.0,
                        borderTop: idx === 0 ? "none" : "1px solid rgba(148,163,184,0.12)",
                        cursor: it.action || it.manual ? "pointer" : "default",
                        opacity: it.done ? 0.92 : 1, // do NOT grey it out hard
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 34 }}>
                        <Icon sx={{ fontSize: 20, color: iconColor }} />
                      </ListItemIcon>

                      <ListItemText
                        primary={
                          <Typography sx={{ fontWeight: 900, color: "rgba(255,255,255,0.92)" }}>
                            {it.title}
                          </Typography>
                        }
                        secondary={
                          <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.68)" }}>
                            {it.subtitle}
                          </Typography>
                        }
                      />

                      {isActionable && (
                        <Chip size="small" label={it.manual ? "TAP" : "DO"} color="primary" sx={{ fontWeight: 950, borderRadius: 999 }} />
                      )}

                      {it.done && (
                        <Chip
                          size="small"
                          label="DONE"
                          sx={{
                            fontWeight: 950,
                            borderRadius: 999,
                            bgcolor: "rgba(34,197,94,0.14)",
                            color: "rgba(255,255,255,0.86)",
                            border: "1px solid rgba(34,197,94,0.35)",
                          }}
                        />
                      )}
                    </ListItemButton>
                  );
                })}
              </List>
            </Box>

            <Button
              variant="contained"
              onClick={() => {
                if (!nextTodo) return;
                if (nextTodo.manual && nextTodo.key === "rehydrate") {
                  toggleHydration();
                  return;
                }
                if (nextTodo.action) history.push(nextTodo.action);
              }}
              disabled={!nextTodo}
              sx={{ borderRadius: 999, fontWeight: 950, px: 3.2, py: 1.1 }}
            >
              {nextTodo ? "Do next" : "All done"}
            </Button>

            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.60)", textAlign: "center" }}>
              Steps check off as you log (and hydration is manual).
            </Typography>
          </Stack>
        </CardShell>

        {/* Card 3 */}
        <CardShell
          title="Coach"
          subtitle="Your personal message"
          right={<FeatureUseBadge featureKey={FEATURE_KEY} isPro={pro} labelPrefix="Coach" />}
        >
          <Stack spacing={1.1} alignItems="center">
            <Box
              sx={{
                width: "100%",
                borderRadius: 3,
                border: "1px solid rgba(148,163,184,0.18)",
                background: win.state === "win" ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.10)",
                p: 1.6,
                textAlign: "center",
              }}
            >
              <Typography sx={{ fontWeight: 950, fontSize: 22 }}>
                {win.state === "win" ? "WIN ✅" : "NOT YET ⚠️"}
              </Typography>
              <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.78)" }}>
                {win.reason}
              </Typography>
            </Box>

            <Box
              onClick={() => setShowNumbers((v) => !v)}
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
                <Typography sx={{ fontWeight: 900, color: "rgba(255,255,255,0.90)" }}>
                  Your numbers
                </Typography>
                <Chip
                  size="small"
                  label={showNumbers ? "HIDE" : "TAP"}
                  sx={{
                    fontWeight: 950,
                    borderRadius: 999,
                    bgcolor: "rgba(255,255,255,0.10)",
                    color: "rgba(255,255,255,0.92)",
                    border: "1px solid rgba(255,255,255,0.18)",
                  }}
                />
              </Stack>

              {showNumbers ? (
                <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.78)", mt: 0.6 }}>
                  Calories {Math.round(bundle.totals.consumed)} / {bundle.targets.calorieTarget ? Math.round(bundle.targets.calorieTarget) : "—"} •
                  Exercise {Math.round(bundle.totals.burned)} •
                  Protein {Math.round(bundle.totals.macros.protein_g)}g • Carbs {Math.round(bundle.totals.macros.carbs_g)}g • Fats {Math.round(bundle.totals.macros.fat_g)}g
                </Typography>
              ) : (
                <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.65)", mt: 0.6, display: "block" }}>
                  Tap to reveal totals + grade
                </Typography>
              )}
            </Box>

            <Button onClick={handleGenerateAiVerdict} variant="contained" disabled={aiLoading} sx={{ borderRadius: 999, fontWeight: 950, px: 3.2, py: 1.1 }}>
              {aiLoading ? "Writing…" : "Get my coach message"}
            </Button>

            {!!aiError && (
              <Typography variant="body2" sx={{ color: "rgba(248,113,113,0.95)", textAlign: "center" }}>
                {aiError}
              </Typography>
            )}

            {!!aiVerdict && (
              <Box sx={{ width: "100%", p: 1.2, borderRadius: 2, border: "1px solid rgba(148,163,184,0.18)", background: "rgba(15,23,42,0.6)" }}>
                <Typography sx={{ fontWeight: 950, mb: 0.6 }}>Message</Typography>
                <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.80)", whiteSpace: "pre-wrap" }}>
                  {aiVerdict}
                </Typography>
              </Box>
            )}

            <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="center" alignItems="center" sx={{ width: "100%" }}>
              <Button variant="contained" onClick={() => history.push("/meals")} sx={{ borderRadius: 999, fontWeight: 950, px: 2.6, py: 1.05 }}>
                Log Meal
              </Button>
              <Button variant="contained" onClick={() => history.push("/workout")} sx={{ borderRadius: 999, fontWeight: 950, px: 2.6, py: 1.05 }}>
                Log Workout
              </Button>
              <Button variant="outlined" startIcon={<IosShareIcon />} disabled={!aiVerdict && !bundle.derived.hasLogs} onClick={handleShare} sx={{ borderRadius: 999, fontWeight: 950 }}>
                Share
              </Button>
            </Stack>

            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.55)", textAlign: "center" }}>
              Tip: hold any ring on the first card for a full breakdown.
            </Typography>

            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.55)", textAlign: "center" }}>
              {pro ? "Pro unlocked." : `Free coach uses left today: ${Math.max(0, remainingAi)} / ${limitAi}`}
            </Typography>
          </Stack>
        </CardShell>
      </Box>

      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
    </Box>
  );
}
