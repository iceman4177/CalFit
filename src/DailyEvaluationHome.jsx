// src/DailyEvaluationHome.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useHistory } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
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
 * DailyEvaluationHome (simplified + BMR/TDEE aware)
 *  1) Scoreboard
 *  2) Your #1 Fix
 *  3) Tomorrow Plan + gated AI Coach Verdict (3/day free)
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
  const okHeight = (ft > 0) || (inch > 0);
  return age > 0 && okGender && w > 0 && okHeight && !!act;
}

function pickPrimaryLimiter({ profileComplete, hasMeals, hasWorkout, score, proteinDelta, calorieDelta }) {
  if (!profileComplete) return "missing_profile";
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
        title: "Your targets aren’t personalized yet.",
        body: "Finish Health Setup so I can judge the day using your BMR/TDEE baseline.",
      };
    case "missing_meals":
      return {
        title: "You didn’t log enough food.",
        body: "Log even 1–2 meals and your evaluation becomes real.",
      };
    case "missing_training":
      return {
        title: "You didn’t log training.",
        body: "Log a workout and your day becomes measurable.",
      };
    case "protein":
      return {
        title: "Protein was the leak.",
        body: "Protein is the lever that makes progress repeatable.",
      };
    case "energy_balance":
      return {
        title: "Calories swung too hard.",
        body: "Tighten your range and results become predictable.",
      };
    case "execution":
      return {
        title: "Consistency is the leak.",
        body: "The goal is a repeatable day you can run again tomorrow.",
      };
    default:
      return {
        title: "One small leak.",
        body: "You’re close — fix one thing and tomorrow feels easy.",
      };
  }
}

function verdictFromSignals({ hasLogs, confidenceLabel, score }) {
  if (!hasLogs) return { headline: "No signal yet.", sub: "Log meals + a workout. Then I’ll judge the day.", tag: "no data" };
  if (confidenceLabel === "Low") return { headline: "Directionally true…", sub: "Add a bit more logging for a sharper verdict.", tag: "low signal" };
  if (confidenceLabel === "Medium") return { headline: "Pretty clear day.", sub: "You’re close — tighten one lever.", tag: "medium signal" };
  if (score >= 88) return { headline: "This day compounds.", sub: "Repeat this pattern.", tag: "elite" };
  if (score >= 74) return { headline: "Good day — one leak.", sub: "Fix the limiter.", tag: "close" };
  return { headline: "Loose pattern.", sub: "Tighten signal → tighten plan.", tag: "needs work" };
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

  // directional penalty:
  // cut: over is worse; bulk: under is worse
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

// ----------------------------- tomorrow plan ----------------------------------
function buildTomorrowPlan({ goalType, limiterKey, proteinTarget, proteinG, profile, hasMeals, hasWorkout }) {
  const g = normalizeGoalType(goalType);
  const pt = Number(proteinTarget) || (g === "cut" ? 140 : 120);
  const pShort = Math.max(0, Math.round(pt - (Number(proteinG) || 0)));

  const dietPref = String(profile?.dietPreference || "").toLowerCase();
  const trainingIntent = String(profile?.trainingIntent || "").toLowerCase();

  const proteinFix =
    dietPref.includes("veg") || dietPref.includes("plant")
      ? "Add 1–2 protein servings: tofu/tempeh + a protein shake."
      : "Add 1–2 protein anchors: greek yogurt + whey OR chicken/lean beef.";

  const calFix =
    g === "bulk"
      ? "Add a controlled +300–400 kcal block (clean carbs + protein)."
      : g === "cut"
      ? "Remove one hidden calorie item (oil/sauce/snack) and keep dinner simple."
      : "Keep calories within ±250 by planning one meal ahead.";

  const trainFix =
    trainingIntent.includes("strength")
      ? "Train: 45–60 min compound focus + 8–12 min incline walk."
      : "Train: 30–45 min + 10 min incline walk (easy repeatable).";

  const signalFix = hasMeals
    ? "Log dinner + 1 snack if you have them. More signal = sharper coaching."
    : "Log 2 meals tomorrow (breakfast + dinner). That’s enough for a real verdict.";

  if (limiterKey === "missing_profile") {
    return [
      { title: "Finish Health Setup (60 sec).", detail: "Add age, gender, height, weight, activity, and goal." },
      { title: "Log 2 meals + 1 workout.", detail: "Minimum signal for a real verdict." },
    ];
  }

  if (limiterKey === "missing_meals") {
    return [
      { title: "Log 2 meals tomorrow.", detail: "No signal = no verdict. Your score sharpens instantly." },
      { title: `Close protein gap (+${pShort}g).`, detail: proteinFix },
    ];
  }

  if (limiterKey === "missing_training") {
    return [
      { title: "Log a workout tomorrow.", detail: trainFix },
      { title: "Keep calories tighter.", detail: calFix },
    ];
  }

  if (limiterKey === "protein") {
    return [
      { title: `Close protein gap (+${pShort}g).`, detail: proteinFix },
      { title: "Tighten calories.", detail: calFix },
    ];
  }

  if (limiterKey === "energy_balance") {
    return [
      { title: "Tighten calories.", detail: calFix },
      { title: "Anchor protein early.", detail: proteinFix },
    ];
  }

  return [
    { title: "Pick ONE non-negotiable.", detail: hasWorkout ? "Protein target first. The rest follows." : "One workout + log dinner." },
    { title: "Improve signal by 20%.", detail: signalFix },
  ];
}

// ----------------------------- UI ---------------------------------------------
function CardShell({ title, subtitle, children, chip }) {
  return (
    <Card
      elevation={0}
      sx={{
        minWidth: { xs: 310, sm: 360 },
        maxWidth: 440,
        scrollSnapAlign: "start",
        borderRadius: 3,
        border: "1px solid rgba(2,6,23,0.10)",
        background: "white",
      }}
    >
      <CardContent sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 950, letterSpacing: -0.2 }}>{title}</Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
          {chip}
        </Stack>
        <Divider sx={{ my: 1.4 }} />
        {children}
      </CardContent>
    </Card>
  );
}

export default function DailyEvaluationHome() {
  const history = useHistory();
  const { isProActive } = useEntitlements();
  const pro = !!isProActive || localStorage.getItem("isPro") === "true";

  const { user } = useAuth();
  const userId = user?.id || null;

  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // AI verdict state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiVerdict, setAiVerdict] = useState("");
  const [aiError, setAiError] = useState("");

  // Score animation
  const [scoreAnim, setScoreAnim] = useState(0);

  const FEATURE_KEY = "daily_eval_verdict";

  const bundle = useMemo(() => {
    const dayUS = usDay();
    const dayISO = isoDay();

    const userData = safeJsonParse(localStorage.getItem("userData"), {}) || {};

    // IMPORTANT: logged-in users use scoped history keys (prevents "0 protein"/"0 burned" flicker)
    const uid = userId || userData?.id || userData?.user_id || null;
    const mealKey = uid ? `mealHistory:${uid}` : "mealHistory";
    const workoutKey = uid ? `workoutHistory:${uid}` : "workoutHistory";
    const dailyCacheKey = uid ? `dailyMetricsCache:${uid}` : "dailyMetricsCache";

    const mealHistory = safeJsonParse(localStorage.getItem(mealKey), []);
    const workoutHistory = safeJsonParse(localStorage.getItem(workoutKey), []);
    const dailyCache = safeJsonParse(localStorage.getItem(dailyCacheKey), {});

    const dayMealsRec =
      Array.isArray(mealHistory) ? mealHistory.find((d) => d?.date === dayUS) || null : null;

    const consumed = sumMealsCalories(dayMealsRec);
    const macros = sumMealsMacros(dayMealsRec);
    const burned = sumWorkoutsCalories(workoutHistory, dayUS);

    const cacheRow = dailyCache?.[dayISO] || null;
    const consumedFinal = consumed || Number(cacheRow?.consumed || 0) || 0;
    const burnedFinal = burned || Number(cacheRow?.burned || 0) || 0;

    const netKcal = consumedFinal - burnedFinal;

    const calorieTarget =
      Number(userData?.dailyGoal) || Number(localStorage.getItem("dailyGoal") || 0) || 0;

    const proteinTarget =
      Number(userData?.proteinTargets?.daily_g) ||
      Number(localStorage.getItem("protein_target_daily_g") || 0) ||
      0;

    const goalType = normalizeGoalType(userData?.goalType);

    // NEW: BMR/TDEE from HealthDataForm (persisted)
    const bmrEst =
      Number(userData?.bmr_est) ||
      Number(localStorage.getItem("bmr_est") || 0) ||
      0;

    const tdeeEst =
      Number(userData?.tdee_est) ||
      Number(localStorage.getItem("tdee_est") || 0) ||
      0;

    const profileComplete = hasBmrInputs(userData) && !!userData?.goalType;

    const hasMeals = consumedFinal > 0 || (dayMealsRec?.meals?.length || 0) > 0;
    const hasWorkout = burnedFinal > 0;
    const hasLogs = hasMeals || hasWorkout;

    const calorieDelta = calorieTarget ? consumedFinal - calorieTarget : netKcal;
    const fallbackProteinTarget = goalType === "cut" ? 140 : 120;
    const pTarget = Number(proteinTarget) || fallbackProteinTarget;
    const proteinDelta = macros.protein_g - pTarget;

    // Confidence now explicitly rewards: profile complete + meals + workout
    const confidenceScore =
      (profileComplete ? 0.50 : 0) +
      (hasMeals ? 0.32 : 0) +
      (hasWorkout ? 0.18 : 0);

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

    const limiterKey = pickPrimaryLimiter({
      profileComplete,
      hasMeals,
      hasWorkout,
      score,
      proteinDelta,
      calorieDelta,
    });

    // How close the chosen target is to estimated TDEE (+/- bias)
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
        calorieDelta,
        proteinDelta,
        limiterKey,
        components,
      },
    };
  }, [userId]);

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

  const tomorrowPlan = useMemo(
    () =>
      buildTomorrowPlan({
        goalType: bundle.targets.goalType,
        limiterKey: bundle.derived.limiterKey,
        proteinTarget: bundle.targets.proteinTarget,
        proteinG: bundle.totals.macros.protein_g,
        profile: bundle.profile,
        hasMeals: bundle.derived.hasMeals,
        hasWorkout: bundle.derived.hasWorkout,
      }),
    [bundle]
  );

  // Animate score
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
      const p1 = tomorrowPlan?.[0];
      const p2 = tomorrowPlan?.[1];

      const hasEst = !!bundle.est.tdee_est && !!bundle.est.bmr_est;

      const payload = {
        feature: "daily_eval_verdict",
        prompt: `
You are SlimCal Coach. Write a short, punchy verdict for today's day.

Rules:
- 2–4 sentences max.
- confident, slightly confrontational but supportive.
- MUST use numbers: calories consumed, burned, net, protein grams, and targets if available.
- Mention the user's goal type (${goalType}) and the #1 limiter.
- If BMR/TDEE are provided, mention that the target is grounded in metabolism (authority).
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

Metabolism (if available):
- BMR: ${hasEst ? Math.round(bundle.est.bmr_est) : "n/a"} kcal/day
- TDEE: ${hasEst ? Math.round(bundle.est.tdee_est) : "n/a"} kcal/day
- Target vs TDEE: ${hasEst && bundle.targets.calorieTarget ? `${Math.round(bundle.est.tdee_delta)} kcal` : "n/a"}

Confidence: ${bundle.derived.confidenceLabel}
Limiter: ${bundle.derived.limiterKey}

Tomorrow Plan:
1) ${p1?.title || ""} — ${p1?.detail || ""}
2) ${p2?.title || ""} — ${p2?.detail || ""}
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

  const proteinPct = bundle.targets.proteinTarget
    ? clamp((bundle.totals.macros.protein_g / Math.max(1, bundle.targets.proteinTarget)) * 100, 0, 130)
    : 0;

  const calErr = bundle.targets.calorieTarget
    ? Math.abs(bundle.totals.consumed - bundle.targets.calorieTarget)
    : Math.abs(bundle.totals.netKcal);

  // Calorie tightness: show *some* signal even when you're far off target.
  // Scale is proportional to the target so the bar doesn't sit at 0 all day on bulk/cut swings.
  const calTightnessScale = bundle.targets.calorieTarget
    ? Math.max(900, bundle.targets.calorieTarget * 0.7)
    : 700;

  const calQuality = bundle.targets.calorieTarget
    ? clamp(100 - (calErr / calTightnessScale) * 100, 0, 100)
    : 0;

  const hasEstimates = !!bundle.est.bmr_est && !!bundle.est.tdee_est;

  const metabolismLine = hasEstimates
    ? `BMR ${Math.round(bundle.est.bmr_est)} • TDEE ${Math.round(bundle.est.tdee_est)}`
    : "Set up Health Data to unlock BMR/TDEE";

  const targetLine = bundle.targets.calorieTarget
    ? hasEstimates
      ? `Target ${Math.round(bundle.targets.calorieTarget)} (vs TDEE ${Math.round(bundle.est.tdee_delta)})`
      : `Target ${Math.round(bundle.targets.calorieTarget)}`
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
          <Typography sx={{ fontWeight: 950, letterSpacing: -0.4, fontSize: 22 }}>
            Daily Evaluation
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {bundle.dayUS} • quick verdict on your day
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
          {goalChip}
          {confidenceChip}
          {!pro && <FeatureUseBadge featureKey={FEATURE_KEY} isPro={false} labelPrefix="AI Verdict" />}
          {pro && <FeatureUseBadge featureKey={FEATURE_KEY} isPro={true} labelPrefix="AI Verdict" />}
        </Stack>
      </Stack>

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
          title="Today’s Scoreboard"
          subtitle={verdict.tag}
          chip={
            <Chip
              label={`${scoreAnim}/100`}
              sx={{ fontWeight: 950, borderRadius: 999 }}
              color={scoreAnim >= 88 ? "success" : scoreAnim >= 74 ? "primary" : "warning"}
            />
          }
        >
          <Typography sx={{ fontWeight: 950, lineHeight: 1.2 }}>
            {verdict.headline}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {verdict.sub}
          </Typography>

          <Divider sx={{ my: 1.4 }} />

          <Stack spacing={1}>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Chip size="small" label={`🍽️ Eaten: ${Math.round(bundle.totals.consumed)} kcal`} />
              <Chip size="small" label={`🔥 Burned: ${Math.round(bundle.totals.burned)} kcal`} />
              <Chip size="small" label={`⚖️ Net: ${Math.round(bundle.totals.netKcal)} kcal`} />
              <Chip size="small" label={`🥩 Protein: ${Math.round(bundle.totals.macros.protein_g)} g`} />
            </Stack>

            <Box
              sx={{
                p: 1.1,
                borderRadius: 2,
                border: "1px solid rgba(2,6,23,0.08)",
                background: "rgba(2,6,23,0.02)",
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                Metabolism baseline
              </Typography>
              <Typography sx={{ fontWeight: 900 }}>{metabolismLine}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.4 }}>
                {targetLine}
              </Typography>

              {!bundle.derived.profileComplete && (
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => history.push("/health")}
                  sx={{ mt: 1, fontWeight: 900, borderRadius: 999 }}
                >
                  Finish Health Setup
                </Button>
              )}
            </Box>

            <Box>
              <Typography variant="caption" color="text.secondary">
                Protein progress
              </Typography>
              <LinearProgress
                variant="determinate"
                value={bundle.targets.proteinTarget ? clamp(proteinPct, 0, 100) : 0}
                sx={{ height: 10, borderRadius: 999, mt: 0.6 }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.6 }}>
                Target: {bundle.targets.proteinTarget ? `${Math.round(bundle.targets.proteinTarget)}g` : "not set"}
              </Typography>
            </Box>

            <Box>
              <Typography variant="caption" color="text.secondary">
                Calorie tightness
              </Typography>
              <LinearProgress
                variant="determinate"
                value={bundle.targets.calorieTarget ? calQuality : 0}
                sx={{ height: 10, borderRadius: 999, mt: 0.6 }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.6 }}>
                {bundle.targets.calorieTarget
                  ? `Target: ${Math.round(bundle.targets.calorieTarget)} kcal • Off by ${Math.round(calErr)}`
                  : "Target: not set"}
              </Typography>
            </Box>

            <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
              <Button size="small" variant="outlined" onClick={() => history.push("/meal")}>
                Log Meal
              </Button>
              <Button size="small" variant="outlined" onClick={() => history.push("/workout")}>
                Log Workout
              </Button>
            </Stack>
          </Stack>
        </CardShell>

        {/* Card 2: Limiter */}
        <CardShell
          title="Your #1 Fix"
          subtitle="what moves the needle fastest"
          chip={<Chip size="small" label="limiter" sx={{ fontWeight: 900 }} />}
        >
          <Typography sx={{ fontWeight: 950 }}>{limiter.title}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.7 }}>
            {limiter.body}
          </Typography>

          <Divider sx={{ my: 1.4 }} />

          <Stack spacing={1}>
            <Typography variant="caption" color="text.secondary">
              Quick read:
            </Typography>

            <Typography variant="body2">
              {bundle.derived.limiterKey === "protein" && (
                <>
                  Your protein is <strong>{Math.round(bundle.derived.proteinDelta)}</strong>g under target.
                </>
              )}
              {bundle.derived.limiterKey === "energy_balance" && bundle.targets.calorieTarget > 0 && (
                <>
                  You’re <strong>{Math.round(bundle.derived.calorieDelta)}</strong> kcal vs target.
                </>
              )}
              {bundle.derived.limiterKey === "missing_meals" && (
                <>You need at least <strong>2 meals</strong> logged for a real verdict.</>
              )}
              {bundle.derived.limiterKey === "missing_training" && (
                <>Log <strong>one workout</strong> and your day becomes measurable.</>
              )}
              {bundle.derived.limiterKey === "missing_profile" && (
                <>Finish setup so your target is grounded in <strong>BMR/TDEE</strong>.</>
              )}
              {bundle.derived.limiterKey === "execution" && (
                <>Make tomorrow <strong>repeatable</strong>: pick one non-negotiable.</>
              )}
              {bundle.derived.limiterKey === "tighten_one_leak" && <>You’re close — tighten one thing and repeat.</>}
            </Typography>

            {!bundle.derived.profileComplete && (
              <Button
                variant="contained"
                onClick={() => history.push("/health")}
                sx={{ fontWeight: 950, borderRadius: 999, mt: 0.5 }}
              >
                Finish Health Setup
              </Button>
            )}
          </Stack>
        </CardShell>

        {/* Card 3: Tomorrow plan + AI */}
        <CardShell
          title="Tomorrow Plan"
          subtitle="2 steps, no overthinking"
          chip={<Chip size="small" label="plan" sx={{ fontWeight: 900 }} />}
        >
          <Stack spacing={1}>
            <Box sx={{ p: 1.1, borderRadius: 2, border: "1px solid rgba(2,6,23,0.08)", background: "rgba(2,6,23,0.02)" }}>
              <Typography sx={{ fontWeight: 950 }}>{tomorrowPlan?.[0]?.title || "Step 1"}</Typography>
              <Typography variant="body2" color="text.secondary">
                {tomorrowPlan?.[0]?.detail || ""}
              </Typography>
            </Box>

            <Box sx={{ p: 1.1, borderRadius: 2, border: "1px solid rgba(2,6,23,0.08)", background: "rgba(2,6,23,0.02)" }}>
              <Typography sx={{ fontWeight: 950 }}>{tomorrowPlan?.[1]?.title || "Step 2"}</Typography>
              <Typography variant="body2" color="text.secondary">
                {tomorrowPlan?.[1]?.detail || ""}
              </Typography>
            </Box>

            <Divider sx={{ my: 1.2 }} />

            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
              <Box>
                <Typography sx={{ fontWeight: 950 }}>AI Coach Verdict</Typography>
                <Typography variant="caption" color="text.secondary">
                  {pro ? "PRO: unlimited" : `Free: ${remainingAi}/${limitAi} left today`}
                </Typography>
              </Box>

              <Button
                variant="contained"
                onClick={handleGenerateAiVerdict}
                disabled={aiLoading}
                sx={{ fontWeight: 950, borderRadius: 999 }}
              >
                {aiLoading ? <CircularProgress size={22} /> : "Get Verdict"}
              </Button>
            </Stack>

            {aiError && (
              <Typography color="error" variant="body2" sx={{ mt: 1 }}>
                {aiError}
              </Typography>
            )}

            {aiVerdict && (
              <Box sx={{ mt: 1.2, p: 1.2, borderRadius: 2, border: "1px solid rgba(2,6,23,0.10)", background: "rgba(2,6,23,0.02)" }}>
                <Typography sx={{ whiteSpace: "pre-wrap" }}>{aiVerdict}</Typography>
              </Box>
            )}
          </Stack>
        </CardShell>
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        Tip: swipe/scroll the cards → this is meant to feel quick, not overwhelming.
      </Typography>

      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
    </Box>
  );
}
