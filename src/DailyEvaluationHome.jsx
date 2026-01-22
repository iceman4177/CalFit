// src/DailyEvaluationHome.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Stack,
  Chip,
  Divider,
  LinearProgress,
  CircularProgress,
  Tooltip,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import UpgradeModal from "./components/UpgradeModal";
import FeatureUseBadge, {
  canUseDailyFeature,
  registerDailyFeatureUse,
  getDailyRemaining,
  getFreeDailyLimit,
} from "./components/FeatureUseBadge.jsx";
import { useEntitlements } from "./context/EntitlementsContext.jsx";

/**
 * DailyEvaluationHome (Acquisition-first)
 * Step 2:
 *  - Goal-type aware scoring (cut / maintain / bulk)
 *  - Tomorrow Plan (2 steps)
 *  - AI “Coach Verdict” button (quota gated)
 *
 * Inputs (local-first friendly):
 *  - HealthDataForm: localStorage.userData (profile/targets/goals)
 *  - Meals: localStorage.mealHistory
 *  - Workouts: localStorage.workoutHistory
 *  - Optional cache: localStorage.dailyMetricsCache
 */

// ----------------------------- tiny helpers -----------------------------------
function safeJsonParse(v, fallback) {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

function clamp(n, a, b) {
  const x = Number(n);
  if (Number.isNaN(x)) return a;
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
  // supports both:
  //  - meal.protein_g / carbs_g / fat_g (common)
  //  - meal.macros.protein / carbs / fat (fallback)
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

function pickPrimaryLimiter({ hasProfile, hasMeals, hasWorkout, score, proteinDelta, calorieDelta }) {
  if (!hasProfile) return "missing_profile";
  if (!hasMeals) return "missing_meals";
  if (!hasWorkout) return "missing_training";
  if (proteinDelta < -25) return "protein";
  if (Math.abs(calorieDelta) > 450) return "energy_balance";
  if (score < 70) return "execution";
  return "tighten_one_leak";
}

function limiterCopy(key) {
  switch (key) {
    case "missing_profile":
      return {
        title: "Your #1 limiter is missing your plan.",
        body: "Set your goal + targets. Then your evaluation becomes personal (and ruthless).",
      };
    case "missing_meals":
      return {
        title: "Your #1 limiter is missing meal signal.",
        body: "Log even 1–2 meals and the score becomes real. No data = no verdict.",
      };
    case "missing_training":
      return {
        title: "Your #1 limiter is missing training signal.",
        body: "Log a workout and your net calories + recovery profile snap into focus.",
      };
    case "protein":
      return {
        title: "Your #1 limiter is protein execution.",
        body: "Protein is the lever that makes the day ‘count.’ Fix this and you’ll feel it fast.",
      };
    case "energy_balance":
      return {
        title: "Your #1 limiter is calorie swing.",
        body: "Big swings create random results. Tighten your range and progress becomes predictable.",
      };
    case "execution":
      return {
        title: "Your #1 limiter is consistency.",
        body: "Your day isn’t repeatable yet. Repeatable patterns are what transform physiques.",
      };
    default:
      return {
        title: "Your #1 limiter is one small leak.",
        body: "You’re close. Fix one limiter and the whole system feels easier tomorrow.",
      };
  }
}

function verdictFromSignals({ hasLogs, confidenceLabel, score }) {
  if (!hasLogs) {
    return {
      headline: "No signal yet.",
      sub: "Log a meal + a workout. Then I’ll judge the day.",
      tag: "insufficient signal",
    };
  }
  if (confidenceLabel !== "High") {
    return {
      headline: "Directionally true…",
      sub: "but your evaluation sharpens as you log more.",
      tag: "low confidence",
    };
  }
  if (score >= 88) return { headline: "This day compounds.", sub: "Repeat this pattern.", tag: "elite day" };
  if (score >= 74) return { headline: "Good day — one leak.", sub: "Fix one limiter.", tag: "close" };
  return { headline: "Pattern is loose.", sub: "Tighten signal → tighten plan.", tag: "needs tightening" };
}

// ----------------------------- scoring (Step 2) --------------------------------
function goalAwareCalorieScore({ goalType, calorieTarget, consumed, burned, netKcal }) {
  // If no explicit calorie target, use netKcal tolerance as fallback
  const g = normalizeGoalType(goalType);

  // “error” is how far from intended daily energy plan
  const err = calorieTarget ? Math.abs(consumed - calorieTarget) : Math.abs(netKcal);

  // different goals tolerate different deviations:
  // - cut: being over is worse than being under
  // - bulk: being under is worse than being over
  // - maintain: symmetrical
  let asym = 0; // - means "under is worse", + means "over is worse"
  if (g === "cut") asym = +1;
  if (g === "bulk") asym = -1;

  // directional delta (positive means over target; negative means under)
  const delta = calorieTarget ? consumed - calorieTarget : netKcal;

  // base tolerance band (tight enough to feel “real” on demo)
  const tight = 220;
  const mid = 420;
  const loose = 700;

  // start with symmetric score by distance
  let s;
  if (err <= tight) s = 1.0;
  else if (err <= mid) s = 0.78;
  else if (err <= loose) s = 0.45;
  else s = 0.18;

  // apply directional penalty depending on goal
  // - cut: if over, reduce
  // - bulk: if under, reduce
  if (asym !== 0 && Number.isFinite(delta)) {
    const isOver = delta > 0;
    const biasPenalty = clamp(Math.abs(delta) / 700, 0, 1) * 0.22; // max -0.22
    if (asym === +1 && isOver) s = clamp(s - biasPenalty, 0, 1);
    if (asym === -1 && !isOver) s = clamp(s - biasPenalty, 0, 1);
  }

  return clamp(s, 0, 1);
}

function proteinScore({ proteinTarget, proteinG, goalType }) {
  // Slightly stricter on cut (protein matters more)
  const g = normalizeGoalType(goalType);
  const fallbackTarget = g === "cut" ? 140 : 120;
  const target = Number(proteinTarget) || fallbackTarget;

  const ratio = clamp((Number(proteinG) || 0) / Math.max(1, target), 0, 1.25);
  // map to 0..1 with diminishing returns > 1.0
  if (ratio >= 1.0) return 1.0;
  if (ratio >= 0.85) return 0.82 + (ratio - 0.85) * (0.18 / 0.15); // 0.82..1.0
  if (ratio >= 0.65) return 0.48 + (ratio - 0.65) * (0.34 / 0.20); // 0.48..0.82
  return clamp(ratio / 0.65, 0, 1) * 0.48; // 0..0.48
}

function trainingScore({ burned, hasWorkout, goalType }) {
  // cut: cardio/NEAT slightly valued, but still modest
  // bulk: training stimulus valued
  // maintain: neutral
  const g = normalizeGoalType(goalType);
  if (!hasWorkout) return 0;

  const b = Number(burned) || 0;
  const base = clamp(b / 220, 0, 1); // ~220kcal burn = "full credit" heuristic
  if (g === "bulk") return clamp(base * 1.05, 0, 1);
  if (g === "cut") return clamp(base * 0.95, 0, 1);
  return base;
}

function computeScoreV2({
  goalType,
  calorieTarget,
  consumed,
  burned,
  netKcal,
  proteinTarget,
  proteinG,
  hasWorkout,
}) {
  const calS = goalAwareCalorieScore({ goalType, calorieTarget, consumed, burned, netKcal });
  const pS = proteinScore({ proteinTarget, proteinG, goalType });
  const tS = trainingScore({ burned, hasWorkout, goalType });

  // weights tuned for “feels right” on demo:
  // calories + protein dominate, training supports
  const score = Math.round(100 * (0.48 * calS + 0.36 * pS + 0.16 * tS));
  return {
    score: clamp(score, 0, 100),
    components: { calS, pS, tS },
  };
}

// ----------------------------- tomorrow plan ----------------------------------
function buildTomorrowPlan({
  goalType,
  limiterKey,
  calorieTarget,
  proteinTarget,
  proteinG,
  calorieDelta,
  hasWorkout,
  hasMeals,
  profile,
}) {
  const g = normalizeGoalType(goalType);

  const pt = Number(proteinTarget) || (g === "cut" ? 140 : 120);
  const pShort = Math.max(0, Math.round(pt - (Number(proteinG) || 0)));

  const actions = [];

  // Constraints (best-effort): diet preference / equipment / training intent
  const dietPref = String(profile?.dietPreference || "").toLowerCase();
  const trainingIntent = String(profile?.trainingIntent || "").toLowerCase();

  const proteinFix =
    dietPref.includes("veg") || dietPref.includes("plant")
      ? "Add 1–2 high-protein servings: tofu/tempeh + Greek yogurt (if allowed) or protein shake."
      : "Add 1–2 protein anchors: greek yogurt + whey OR chicken/lean beef at one meal.";

  const cutCalFix =
    "Tighten calories by removing 1 “liquid/hidden” item (oil, sauce, snack) and keep dinner simpler.";
  const bulkCalFix =
    "Add one controlled calorie block: +350 kcal from clean carbs/protein (rice + lean meat, oats + whey).";
  const maintainCalFix =
    "Aim for a tighter range: keep calories within ±250 of target by planning one meal ahead.";

  const trainingFix =
    trainingIntent.includes("strength")
      ? "Train tomorrow: 45–60 min compound focus + finish with 8–12 min incline walk."
      : "Train tomorrow: 30–45 min + 10 min incline walk (easy repeatable).";

  const signalFix = hasMeals
    ? "Log the rest of the day (especially dinner). More signal = more accurate coaching."
    : "Log at least 2 meals tomorrow (breakfast + dinner). Then your score becomes real.";

  // Choose 2 steps. We keep it crisp for Reels.
  if (limiterKey === "missing_profile") {
    actions.push({
      title: "Finish Health Setup (60 seconds).",
      detail: "Set goal + targets so the evaluation becomes personal.",
      badge: "setup",
    });
    actions.push({
      title: "Log 2 meals + 1 workout tomorrow.",
      detail: "That’s the minimum signal for a real verdict.",
      badge: "signal",
    });
    return actions;
  }

  if (limiterKey === "missing_meals") {
    actions.push({
      title: "Log 2 meals tomorrow (breakfast + dinner).",
      detail: "No signal = no verdict. Your score sharpens instantly.",
      badge: "signal",
    });
    actions.push({
      title: "Hit protein first.",
      detail: proteinFix,
      badge: "protein",
    });
    return actions;
  }

  if (limiterKey === "missing_training") {
    actions.push({
      title: "Log a workout tomorrow.",
      detail: trainingFix,
      badge: "training",
    });
    actions.push({
      title: "Keep calories controlled.",
      detail: g === "bulk" ? bulkCalFix : g === "cut" ? cutCalFix : maintainCalFix,
      badge: "calories",
    });
    return actions;
  }

  if (limiterKey === "protein") {
    actions.push({
      title: `Close the protein gap (+${pShort}g).`,
      detail: proteinFix,
      badge: "protein",
    });
    actions.push({
      title: "Keep calories tighter.",
      detail: g === "bulk" ? bulkCalFix : g === "cut" ? cutCalFix : maintainCalFix,
      badge: "calories",
    });
    return actions;
  }

  if (limiterKey === "energy_balance") {
    actions.push({
      title: "Tighten the calorie range.",
      detail: g === "bulk" ? bulkCalFix : g === "cut" ? cutCalFix : maintainCalFix,
      badge: "calories",
    });
    actions.push({
      title: "Anchor protein early.",
      detail: proteinFix,
      badge: "protein",
    });
    return actions;
  }

  // execution / tighten_one_leak
  actions.push({
    title: "Pick ONE non-negotiable.",
    detail: hasWorkout ? "Protein target first. The rest follows." : "One workout + log dinner.",
    badge: "focus",
  });
  actions.push({
    title: "Improve signal by 20%.",
    detail: signalFix,
    badge: "signal",
  });
  return actions;
}

// ----------------------------- UI atoms --------------------------------------
function GlassCard({ children, sx }) {
  return (
    <Card
      elevation={0}
      sx={{
        borderRadius: 4,
        border: "1px solid",
        borderColor: (t) => alpha("#fff", t.palette.mode === "dark" ? 0.08 : 0.12),
        background: (t) =>
          t.palette.mode === "dark"
            ? `linear-gradient(180deg, ${alpha("#111827", 0.78)}, ${alpha("#0b1220", 0.6)})`
            : alpha("#fff", 0.85),
        backdropFilter: "blur(12px)",
        overflow: "hidden",
        ...sx,
      }}
    >
      {children}
    </Card>
  );
}

function MiniRing({ value, size = 46, label }) {
  const v = clamp(value, 0, 125);
  return (
    <Box sx={{ position: "relative", width: size, height: size }}>
      <CircularProgress
        variant="determinate"
        value={100}
        size={size}
        thickness={6}
        sx={{
          position: "absolute",
          left: 0,
          top: 0,
          color: (t) => alpha("#fff", t.palette.mode === "dark" ? 0.08 : 0.12),
        }}
      />
      <CircularProgress
        variant="determinate"
        value={clamp(v, 0, 100)}
        size={size}
        thickness={6}
        sx={{
          position: "absolute",
          left: 0,
          top: 0,
          color: "inherit",
        }}
      />
      <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
        <Typography variant="caption" sx={{ fontWeight: 900, opacity: 0.9 }}>
          {label}
        </Typography>
      </Box>
    </Box>
  );
}

function MacroTile({ title, valueText, subText, ringValue, accent = "inherit" }) {
  return (
    <GlassCard sx={{ flex: 1, minWidth: 0, color: accent }}>
      <CardContent sx={{ p: 2.2 }}>
        <Stack direction="row" spacing={1.6} alignItems="center">
          <MiniRing value={ringValue} label="" />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="caption" sx={{ opacity: 0.75, fontWeight: 800, letterSpacing: 0.3 }}>
              {title}
            </Typography>
            <Typography sx={{ fontWeight: 950, lineHeight: 1.1, fontSize: 18 }}>
              {valueText}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              {subText}
            </Typography>
          </Box>
        </Stack>
      </CardContent>
    </GlassCard>
  );
}

function PlanBadge({ type }) {
  const map = {
    setup: { label: "setup", c: alpha("#60A5FA", 0.95) },
    signal: { label: "signal", c: alpha("#22D3EE", 0.95) },
    protein: { label: "protein", c: alpha("#A78BFA", 0.95) },
    calories: { label: "calories", c: alpha("#FBBF24", 0.95) },
    training: { label: "training", c: alpha("#34D399", 0.95) },
    focus: { label: "focus", c: alpha("#F472B6", 0.95) },
  };
  const x = map[type] || { label: "plan", c: alpha("#fff", 0.75) };

  return (
    <Chip
      size="small"
      label={x.label}
      sx={{
        fontWeight: 950,
        bgcolor: alpha(x.c, 0.12),
        color: x.c,
        border: `1px solid ${alpha(x.c, 0.22)}`,
      }}
    />
  );
}

// ----------------------------- main component --------------------------------
export default function DailyEvaluationHome() {
  const { isProActive } = useEntitlements();
  const pro = !!isProActive || localStorage.getItem("isPro") === "true";

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [unlockedLimiter, setUnlockedLimiter] = useState(false);

  // AI verdict state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiVerdict, setAiVerdict] = useState("");
  const [aiError, setAiError] = useState("");

  // score animation (premium feel)
  const [scoreAnim, setScoreAnim] = useState(0);

  useEffect(() => {
    if (pro) setUnlockedLimiter(true);
  }, [pro]);

  const openUpgrade = () => setUpgradeOpen(true);

  const handleUnlockLimiter = () => {
    if (pro) return setUnlockedLimiter(true);
    const featureKey = "daily_recap"; // reuse existing daily gating
    if (canUseDailyFeature(featureKey)) {
      registerDailyFeatureUse(featureKey);
      setUnlockedLimiter(true);
      return;
    }
    openUpgrade();
  };

  // AI verdict quota gating (separate key so limiter unlock doesn't consume verdicts)
  const AI_FEATURE_KEY = "daily_eval_ai_verdict";

  const handleGenerateAiVerdict = async (bundle, tomorrowPlan) => {
    setAiError("");
    setAiVerdict("");

    if (!pro) {
      if (!canUseDailyFeature(AI_FEATURE_KEY)) {
        openUpgrade();
        return;
      }
      registerDailyFeatureUse(AI_FEATURE_KEY);
    }

    setAiLoading(true);
    try {
      const goalType = normalizeGoalType(bundle.profile?.goalType);
      const payload = {
        feature: "daily_eval_verdict",
        // Keep prompt compact, extremely “coach-y”, demo-friendly
        prompt: `
You are SlimCal Coach. Write a short, punchy verdict for today's day.
Rules:
- 2–4 sentences max.
- confident, slightly confrontational but supportive.
- MUST use numbers: calories consumed, burned, net, protein grams, and targets if available.
- Mention the user's goal type (${goalType}) and the #1 limiter.
- End with 2 bullet points for tomorrow (based on the plan).
Data:
Day: ${bundle.dayUS}
Goal: ${goalType}
Consumed: ${Math.round(bundle.totals.consumed)} kcal
Burned: ${Math.round(bundle.totals.burned)} kcal
Net: ${Math.round(bundle.totals.netKcal)} kcal
Protein: ${Math.round(bundle.totals.macros.protein_g)} g
Targets:
- Calories target: ${bundle.targets.calorieTarget ? Math.round(bundle.targets.calorieTarget) : "not set"}
- Protein target: ${bundle.targets.proteinTarget ? Math.round(bundle.targets.proteinTarget) : "not set"}
Limiter: ${bundle.derived.limiterKey}
Tomorrow Plan:
1) ${tomorrowPlan?.[0]?.title || ""} — ${tomorrowPlan?.[0]?.detail || ""}
2) ${tomorrowPlan?.[1]?.title || ""} — ${tomorrowPlan?.[1]?.detail || ""}
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

      // Common shapes: { text } or { result } or { output } or OpenAI-style
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

  // ----------------------------- Inputs bundle --------------------------------
  const bundle = useMemo(() => {
    const dayUS = usDay();
    const dayISO = isoDay();

    const userData = safeJsonParse(localStorage.getItem("userData"), {}) || {};

    const mealHistory = safeJsonParse(localStorage.getItem("mealHistory"), []);
    const workoutHistory = safeJsonParse(localStorage.getItem("workoutHistory"), []);
    const dailyCache = safeJsonParse(localStorage.getItem("dailyMetricsCache"), {});

    const dayMealsRec =
      Array.isArray(mealHistory) ? mealHistory.find((d) => d?.date === dayUS) || null : null;

    const consumed = sumMealsCalories(dayMealsRec);
    const macros = sumMealsMacros(dayMealsRec);

    const burned = sumWorkoutsCalories(workoutHistory, dayUS);

    // optional cache (if present, prefer real-time non-zero)
    const cacheRow = dailyCache?.[dayISO] || null;
    const consumedFinal = consumed || Number(cacheRow?.consumed || 0) || 0;
    const burnedFinal = burned || Number(cacheRow?.burned || 0) || 0;

    const netKcal = consumedFinal - burnedFinal;

    // HealthDataForm-derived targets (best-effort)
    const calorieTarget =
      Number(userData?.dailyGoal) ||
      Number(localStorage.getItem("dailyGoal") || 0) ||
      0;

    const proteinTarget =
      Number(userData?.proteinTargets?.daily_g) ||
      Number(localStorage.getItem("protein_target_daily_g") || 0) ||
      0;

    const goalType = normalizeGoalType(userData?.goalType);

    const hasProfile =
      !!userData?.goalType ||
      !!userData?.dailyGoal ||
      !!userData?.weight ||
      !!userData?.height ||
      !!userData?.age;

    const hasMeals = consumedFinal > 0 || (dayMealsRec?.meals?.length || 0) > 0;
    const hasWorkout = burnedFinal > 0;
    const hasLogs = hasMeals || hasWorkout;

    // Deltas
    const calorieDelta = calorieTarget ? consumedFinal - calorieTarget : netKcal;
    const proteinDelta = proteinTarget ? macros.protein_g - proteinTarget : macros.protein_g - (goalType === "cut" ? 140 : 120);

    // Confidence (signal quality)
    const confidenceScore = (hasProfile ? 0.45 : 0) + (hasMeals ? 0.35 : 0) + (hasWorkout ? 0.20 : 0);
    const confidenceLabel = confidenceScore >= 0.85 ? "High" : confidenceScore >= 0.55 ? "Medium" : "Low";

    const missing = [];
    if (!hasProfile) missing.push("Finish Health Setup");
    if (!hasMeals) missing.push("Log meals");
    if (!hasWorkout) missing.push("Log workout");

    // Step 2 scoring
    const { score, components } = computeScoreV2({
      goalType,
      calorieTarget,
      consumed: consumedFinal,
      burned: burnedFinal,
      netKcal,
      proteinTarget,
      proteinG: macros.protein_g,
      hasWorkout,
    });

    // for macro rings: percent to target if available
    const fallbackProteinTarget = goalType === "cut" ? 140 : 120;
    const pTarget = Number(proteinTarget) || fallbackProteinTarget;
    const pPct = clamp((macros.protein_g / Math.max(1, pTarget)) * 100, 0, 125);

    // we don’t compute carb/fat targets yet; keep premium UI stable
    const cPct = 60;
    const fPct = 60;

    const limiterKey = pickPrimaryLimiter({
      hasProfile,
      hasMeals,
      hasWorkout,
      score,
      proteinDelta,
      calorieDelta,
    });

    return {
      dayUS,
      dayISO,
      profile: userData,
      targets: {
        calorieTarget,
        proteinTarget: pTarget,
        goalType,
      },
      totals: {
        consumed: consumedFinal,
        burned: burnedFinal,
        netKcal,
        macros,
      },
      derived: {
        hasProfile,
        hasMeals,
        hasWorkout,
        hasLogs,
        confidenceScore,
        confidenceLabel,
        missing,
        score,
        calorieDelta,
        proteinDelta,
        macroPct: { pPct, cPct, fPct },
        limiterKey,
        components, // { calS, pS, tS }
      },
    };
  }, []);

  const verdict = useMemo(
    () =>
      verdictFromSignals({
        hasLogs: bundle.derived.hasLogs,
        confidenceLabel: bundle.derived.confidenceLabel,
        score: bundle.derived.score,
      }),
    [bundle]
  );

  const limiter = useMemo(() => limiterCopy(bundle.derived.limiterKey), [bundle]);

  const tomorrowPlan = useMemo(() => {
    return buildTomorrowPlan({
      goalType: bundle.targets.goalType,
      limiterKey: bundle.derived.limiterKey,
      calorieTarget: bundle.targets.calorieTarget,
      proteinTarget: bundle.targets.proteinTarget,
      proteinG: bundle.totals.macros.protein_g,
      calorieDelta: bundle.derived.calorieDelta,
      hasWorkout: bundle.derived.hasWorkout,
      hasMeals: bundle.derived.hasMeals,
      profile: bundle.profile,
    });
  }, [bundle]);

  // animate score ring for premium feel
  useEffect(() => {
    let raf = null;
    const target = clamp(bundle.derived.score, 0, 100);
    const start = performance.now();
    const dur = 850;

    const tick = (t) => {
      const p = clamp((t - start) / dur, 0, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setScoreAnim(Math.round(e * target));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => raf && cancelAnimationFrame(raf);
  }, [bundle.derived.score]);

  const remainingLimiter = getDailyRemaining("daily_recap");
  const limitLimiter = getFreeDailyLimit("daily_recap");

  const remainingAi = getDailyRemaining(AI_FEATURE_KEY);
  const limitAi = getFreeDailyLimit(AI_FEATURE_KEY);

  // ----------------------------- Styling --------------------------------------
  const bgSx = {
    minHeight: "calc(100vh - 64px)",
    px: { xs: 2, sm: 3 },
    py: 3,
    color: "#E5E7EB",
    background: `
      radial-gradient(1200px 600px at 20% -10%, ${alpha("#7C3AED", 0.22)}, transparent 55%),
      radial-gradient(900px 520px at 95% 10%, ${alpha("#06B6D4", 0.18)}, transparent 55%),
      radial-gradient(900px 520px at 60% 120%, ${alpha("#F59E0B", 0.10)}, transparent 55%),
      linear-gradient(180deg, #05070B 0%, #070A12 30%, #05070B 100%)
    `,
  };

  const pillSx = {
    borderRadius: 999,
    px: 1.5,
    py: 0.6,
    fontWeight: 900,
    border: "1px solid",
    borderColor: alpha("#fff", 0.12),
    background: alpha("#0B1220", 0.55),
    backdropFilter: "blur(10px)",
  };

  const goalChip = (() => {
    const g = normalizeGoalType(bundle.targets.goalType);
    const map = {
      cut: { label: "CUT", c: alpha("#F472B6", 0.95) },
      maintain: { label: "MAINTAIN", c: alpha("#22D3EE", 0.95) },
      bulk: { label: "BULK", c: alpha("#34D399", 0.95) },
    };
    const x = map[g] || map.maintain;
    return (
      <Chip
        size="small"
        label={x.label}
        sx={{
          fontWeight: 950,
          bgcolor: alpha(x.c, 0.12),
          color: x.c,
          border: `1px solid ${alpha(x.c, 0.22)}`,
        }}
      />
    );
  })();

  return (
    <Box sx={bgSx}>
      {/* Top header */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography sx={{ fontWeight: 950, letterSpacing: -0.4, fontSize: 22 }}>
            Daily Evaluation
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.75 }}>
            Verdict → Score → #1 limiter → tomorrow plan.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} alignItems="center">
          {goalChip}
          <Box sx={pillSx}>
            <Typography variant="caption" sx={{ opacity: 0.75 }}>
              {bundle.dayUS}
            </Typography>
          </Box>
          <Box sx={pillSx}>
            <Typography variant="caption" sx={{ opacity: 0.75 }}>
              {pro ? "PRO" : "FREE"}
            </Typography>
          </Box>
        </Stack>
      </Stack>

      {/* HERO: Verdict + Score ring */}
      <GlassCard sx={{ mb: 2 }}>
        <CardContent sx={{ p: 2.6 }}>
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2.2} alignItems={{ sm: "center" }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  sx={{
                    fontWeight: 980,
                    letterSpacing: -0.6,
                    lineHeight: 1.05,
                    fontSize: { xs: 28, sm: 32 },
                    mb: 0.8,
                  }}
                >
                  {verdict.headline}
                </Typography>
                <Typography sx={{ opacity: 0.78, maxWidth: 560 }}>
                  {verdict.sub}
                </Typography>

                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.6, flexWrap: "wrap" }}>
                  <Chip
                    size="small"
                    label={verdict.tag}
                    sx={{
                      fontWeight: 900,
                      color: "#E5E7EB",
                      bgcolor: alpha("#111827", 0.55),
                      border: `1px solid ${alpha("#fff", 0.10)}`,
                    }}
                  />

                  <Box sx={pillSx}>
                    <Typography variant="caption" sx={{ opacity: 0.8 }}>
                      Net:{" "}
                      <Box component="span" sx={{ fontWeight: 950, opacity: 1 }}>
                        {Math.round(bundle.totals.netKcal)} kcal
                      </Box>
                    </Typography>
                  </Box>

                  <Box sx={pillSx}>
                    <Typography variant="caption" sx={{ opacity: 0.8 }}>
                      Protein:{" "}
                      <Box component="span" sx={{ fontWeight: 950, opacity: 1 }}>
                        {Math.round(bundle.totals.macros.protein_g)} g
                      </Box>
                      {bundle.targets.proteinTarget ? (
                        <Box component="span" sx={{ opacity: 0.75 }}>
                          {" "}
                          / {Math.round(bundle.targets.proteinTarget)}g
                        </Box>
                      ) : null}
                    </Typography>
                  </Box>

                  <Box sx={pillSx}>
                    <Typography variant="caption" sx={{ opacity: 0.8 }}>
                      Confidence:{" "}
                      <Box component="span" sx={{ fontWeight: 950, opacity: 1 }}>
                        {bundle.derived.confidenceLabel}
                      </Box>
                    </Typography>
                  </Box>
                </Stack>

                <Box sx={{ mt: 1.4 }}>
                  <LinearProgress
                    variant="determinate"
                    value={Math.round(bundle.derived.confidenceScore * 100)}
                    sx={{
                      height: 10,
                      borderRadius: 999,
                      bgcolor: alpha("#fff", 0.08),
                      "& .MuiLinearProgress-bar": {
                        borderRadius: 999,
                        bgcolor: alpha("#A78BFA", 0.9),
                      },
                    }}
                  />
                </Box>

                {bundle.derived.missing.length > 0 && (
                  <Stack direction="row" spacing={1} sx={{ mt: 1.6, flexWrap: "wrap" }}>
                    {bundle.derived.missing.map((m) => (
                      <Chip
                        key={m}
                        size="small"
                        label={m}
                        variant="outlined"
                        sx={{
                          borderColor: alpha("#fff", 0.18),
                          color: alpha("#fff", 0.85),
                          fontWeight: 800,
                        }}
                      />
                    ))}
                  </Stack>
                )}

                {/* Component breakdown (tiny, premium) */}
                <Stack direction="row" spacing={1} sx={{ mt: 1.6, flexWrap: "wrap" }}>
                  <Tooltip title="Calories alignment vs your goal/target">
                    <Chip
                      size="small"
                      label={`Calories ${Math.round(bundle.derived.components.calS * 100)}%`}
                      sx={{
                        fontWeight: 950,
                        bgcolor: alpha("#FBBF24", 0.10),
                        color: alpha("#FBBF24", 0.95),
                        border: `1px solid ${alpha("#FBBF24", 0.20)}`,
                      }}
                    />
                  </Tooltip>
                  <Tooltip title="Protein adequacy vs target">
                    <Chip
                      size="small"
                      label={`Protein ${Math.round(bundle.derived.components.pS * 100)}%`}
                      sx={{
                        fontWeight: 950,
                        bgcolor: alpha("#A78BFA", 0.10),
                        color: alpha("#A78BFA", 0.95),
                        border: `1px solid ${alpha("#A78BFA", 0.20)}`,
                      }}
                    />
                  </Tooltip>
                  <Tooltip title="Training signal based on logged burn">
                    <Chip
                      size="small"
                      label={`Training ${Math.round(bundle.derived.components.tS * 100)}%`}
                      sx={{
                        fontWeight: 950,
                        bgcolor: alpha("#34D399", 0.10),
                        color: alpha("#34D399", 0.95),
                        border: `1px solid ${alpha("#34D399", 0.20)}`,
                      }}
                    />
                  </Tooltip>
                </Stack>
              </Box>

              {/* Score ring */}
              <Box
                sx={{
                  width: { xs: "100%", sm: 180 },
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <Box sx={{ position: "relative", width: 160, height: 160 }}>
                  <CircularProgress
                    variant="determinate"
                    value={100}
                    size={160}
                    thickness={7}
                    sx={{ color: alpha("#fff", 0.08) }}
                  />
                  <CircularProgress
                    variant="determinate"
                    value={scoreAnim}
                    size={160}
                    thickness={7}
                    sx={{
                      color: alpha("#A78BFA", 0.95),
                      position: "absolute",
                      left: 0,
                      top: 0,
                      filter: "drop-shadow(0px 10px 22px rgba(167,139,250,0.22))",
                    }}
                  />
                  <Box
                    sx={{
                      position: "absolute",
                      inset: 0,
                      display: "grid",
                      placeItems: "center",
                      textAlign: "center",
                    }}
                  >
                    <Typography sx={{ fontWeight: 980, letterSpacing: -1.0, fontSize: 44, lineHeight: 1 }}>
                      {scoreAnim}
                    </Typography>
                    <Typography variant="caption" sx={{ opacity: 0.7, fontWeight: 900 }}>
                      score
                    </Typography>
                  </Box>
                </Box>

                <Stack direction="row" spacing={1} sx={{ mt: 1.6 }}>
                  <Box sx={pillSx}>
                    <Typography variant="caption" sx={{ opacity: 0.8 }}>
                      Consumed{" "}
                      <Box component="span" sx={{ fontWeight: 950 }}>
                        {Math.round(bundle.totals.consumed)}
                      </Box>
                    </Typography>
                  </Box>
                  <Box sx={pillSx}>
                    <Typography variant="caption" sx={{ opacity: 0.8 }}>
                      Burned{" "}
                      <Box component="span" sx={{ fontWeight: 950 }}>
                        {Math.round(bundle.totals.burned)}
                      </Box>
                    </Typography>
                  </Box>
                </Stack>
              </Box>
            </Stack>
          </Stack>
        </CardContent>
      </GlassCard>

      {/* Macro tiles row */}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.4} sx={{ mb: 2 }}>
        <MacroTile
          title="Protein"
          valueText={`${Math.round(bundle.totals.macros.protein_g)}g`}
          subText={`${Math.max(0, Math.round(bundle.targets.proteinTarget - bundle.totals.macros.protein_g))}g to target`}
          ringValue={bundle.derived.macroPct.pPct}
          accent={alpha("#A78BFA", 0.95)}
        />
        <MacroTile
          title="Carbs"
          valueText={`${Math.round(bundle.totals.macros.carbs_g)}g`}
          subText="targets soon"
          ringValue={bundle.derived.macroPct.cPct}
          accent={alpha("#22D3EE", 0.92)}
        />
        <MacroTile
          title="Fat"
          valueText={`${Math.round(bundle.totals.macros.fat_g)}g`}
          subText="targets soon"
          ringValue={bundle.derived.macroPct.fPct}
          accent={alpha("#FBBF24", 0.92)}
        />
      </Stack>

      {/* Tomorrow Plan (2 steps) — this is the “hope + clarity” hook */}
      <GlassCard sx={{ mb: 2 }}>
        <CardContent sx={{ p: 2.6 }}>
          <Stack spacing={1.4}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography sx={{ fontWeight: 980, letterSpacing: -0.4, fontSize: 18 }}>
                Tomorrow’s Plan (2 steps)
              </Typography>
              <Chip
                size="small"
                label="designed for consistency"
                sx={{
                  fontWeight: 900,
                  bgcolor: alpha("#111827", 0.55),
                  border: `1px solid ${alpha("#fff", 0.10)}`,
                  color: alpha("#fff", 0.85),
                }}
              />
            </Stack>

            <Stack spacing={1.2}>
              {tomorrowPlan.slice(0, 2).map((a, idx) => (
                <Box
                  key={idx}
                  sx={{
                    p: 1.6,
                    borderRadius: 3,
                    border: `1px solid ${alpha("#fff", 0.10)}`,
                    background: alpha("#0B1220", 0.45),
                  }}
                >
                  <Stack direction="row" spacing={1.2} alignItems="center" sx={{ mb: 0.6 }}>
                    <PlanBadge type={a.badge} />
                    <Typography sx={{ fontWeight: 980, letterSpacing: -0.2 }}>
                      {a.title}
                    </Typography>
                  </Stack>
                  <Typography variant="body2" sx={{ opacity: 0.78 }}>
                    {a.detail}
                  </Typography>
                </Box>
              ))}
            </Stack>

            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              This plan is auto-built from your goal + today’s data (meals/workouts/targets).
            </Typography>
          </Stack>
        </CardContent>
      </GlassCard>

      {/* AI Coach Verdict — quota gated */}
      <GlassCard sx={{ mb: 2 }}>
        <CardContent sx={{ p: 2.6 }}>
          <Stack spacing={1.4}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography sx={{ fontWeight: 980, letterSpacing: -0.4, fontSize: 18 }}>
                AI Coach Verdict
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <FeatureUseBadge
                  featureKey={AI_FEATURE_KEY}
                  isPro={pro}
                  labelPrefix="AI"
                />
                {!pro && (
                  <Typography variant="caption" sx={{ opacity: 0.65 }}>
                    {remainingAi}/{limitAi} left today
                  </Typography>
                )}
              </Stack>
            </Stack>

            <Typography sx={{ opacity: 0.78 }}>
              Want the “Cal AI / Avocado-style” punchline? Generate a short verdict that uses your numbers + your goal.
            </Typography>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} alignItems={{ sm: "center" }}>
              <Button
                disabled={aiLoading}
                onClick={() => handleGenerateAiVerdict(bundle, tomorrowPlan)}
                variant="contained"
                sx={{
                  borderRadius: 999,
                  fontWeight: 950,
                  px: 2.2,
                  py: 1.1,
                  textTransform: "none",
                  bgcolor: alpha("#22D3EE", 0.95),
                  color: "#0B1220",
                  "&:hover": { bgcolor: alpha("#22D3EE", 0.85) },
                }}
              >
                {aiLoading ? "Generating..." : "Generate verdict"}
              </Button>

              {!pro && (
                <Button
                  variant="text"
                  onClick={openUpgrade}
                  sx={{
                    fontWeight: 950,
                    textTransform: "none",
                    color: alpha("#fff", 0.85),
                  }}
                >
                  Go Pro (unlimited AI)
                </Button>
              )}

              <Tooltip title="Designed for Reels/TikTok: short, punchy, numbers-first.">
                <Typography variant="caption" sx={{ opacity: 0.6, ml: { sm: "auto" } }}>
                  demo-ready
                </Typography>
              </Tooltip>
            </Stack>

            {aiError ? (
              <Typography variant="body2" sx={{ color: alpha("#FCA5A5", 0.95), fontWeight: 800 }}>
                {aiError}
              </Typography>
            ) : null}

            {aiVerdict ? (
              <Box
                sx={{
                  p: 1.8,
                  borderRadius: 3,
                  border: `1px solid ${alpha("#fff", 0.10)}`,
                  background: alpha("#0B1220", 0.45),
                }}
              >
                <Typography sx={{ whiteSpace: "pre-line", fontWeight: 800, opacity: 0.92 }}>
                  {aiVerdict}
                </Typography>
              </Box>
            ) : null}
          </Stack>
        </CardContent>
      </GlassCard>

      {/* #1 Limiter (conversion crown jewel) */}
      <GlassCard
        sx={{
          borderColor: unlockedLimiter ? alpha("#A78BFA", 0.28) : alpha("#fff", 0.10),
          boxShadow: unlockedLimiter ? `0 14px 40px ${alpha("#A78BFA", 0.16)}` : "none",
        }}
      >
        <CardContent sx={{ p: 2.6 }}>
          <Stack spacing={1.2}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography sx={{ fontWeight: 950, letterSpacing: -0.3, fontSize: 18 }}>
                Your #1 limiter
              </Typography>
              <Box>
                <FeatureUseBadge
                  featureKey="daily_recap"
                  isPro={pro}
                  labelPrefix="Unlocks"
                  sx={{ mr: 1 }}
                />
                {!pro && (
                  <Typography variant="caption" sx={{ opacity: 0.65 }}>
                    {remainingLimiter}/{limitLimiter} left today
                  </Typography>
                )}
              </Box>
            </Stack>

            <Typography sx={{ fontWeight: 980, letterSpacing: -0.6, fontSize: 24, lineHeight: 1.1 }}>
              {limiter.title}
            </Typography>

            <Typography sx={{ opacity: 0.78 }}>
              {unlockedLimiter
                ? limiter.body
                : "Unlock this insight to see exactly what to fix first."}
            </Typography>

            <Divider sx={{ borderColor: alpha("#fff", 0.08), my: 1 }} />

            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2} alignItems={{ sm: "center" }}>
              <Button
                variant={unlockedLimiter ? "outlined" : "contained"}
                onClick={unlockedLimiter ? () => {} : handleUnlockLimiter}
                sx={{
                  borderRadius: 999,
                  fontWeight: 950,
                  px: 2.2,
                  py: 1.1,
                  textTransform: "none",
                  ...(unlockedLimiter
                    ? {
                        borderColor: alpha("#A78BFA", 0.4),
                        color: alpha("#A78BFA", 0.95),
                      }
                    : {
                        bgcolor: alpha("#A78BFA", 0.95),
                        color: "#0B1220",
                        "&:hover": { bgcolor: alpha("#A78BFA", 0.85) },
                      }),
                }}
              >
                {unlockedLimiter ? "Unlocked" : "Unlock limiter"}
              </Button>

              {!pro && (
                <Button
                  variant="text"
                  onClick={openUpgrade}
                  sx={{
                    fontWeight: 950,
                    textTransform: "none",
                    color: alpha("#fff", 0.85),
                  }}
                >
                  Go Pro (unlimited)
                </Button>
              )}
            </Stack>

            {/* Locked teaser */}
            {!unlockedLimiter && (
              <Box
                sx={{
                  mt: 1.4,
                  p: 1.6,
                  borderRadius: 3,
                  border: `1px solid ${alpha("#fff", 0.10)}`,
                  background: alpha("#0B1220", 0.45),
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <Box
                  sx={{
                    position: "absolute",
                    inset: 0,
                    background: `linear-gradient(90deg, transparent, ${alpha("#A78BFA", 0.12)}, transparent)`,
                    filter: "blur(10px)",
                    opacity: 0.8,
                  }}
                />
                <Typography sx={{ fontWeight: 950, position: "relative" }}>
                  Locked: “Fix the limiter” plan depth
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.7, position: "relative" }}>
                  More steps, tighter targets, and the exact adjustment logic for your goal.
                </Typography>
              </Box>
            )}
          </Stack>
        </CardContent>
      </GlassCard>

      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
    </Box>
  );
}
