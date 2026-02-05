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
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import TrackChangesIcon from "@mui/icons-material/TrackChanges";
import RestaurantIcon from "@mui/icons-material/Restaurant";
import FitnessCenterIcon from "@mui/icons-material/FitnessCenter";
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

// ---------- deterministic copy variants (avoid repetitive "lever" phrasing) ----------
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

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
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

function limiterCopy(key, dayKey) {
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
        title: pickVariant("limiter_title_protein", dayKey, [
          "Protein was the leak.",
          "Your protein floor is low.",
          "Protein is the limiter today.",
          "Your day is under-proteined.",
        ]),
        body: pickVariant("limiter_body_protein", dayKey, [
          "Bring protein up and the rest of the day becomes easier to win.",
          "Hit your protein target and cravings usually calm down.",
          "Raise protein first — it stabilizes appetite and recovery.",
          "Lock protein early and the rest of your macros fall into place.",
        ]),
      };
    case "energy_balance":
      return {
        title: pickVariant("limiter_title_cal", dayKey, [
          "Calories drifted off target.",
          "Your calories are the swing factor.",
          "Energy balance is the limiter.",
          "Your target window is open.",
        ]),
        body: pickVariant("limiter_body_cal", dayKey, [
          "Stay closer to target and progress becomes repeatable.",
          "Tighten the calorie window — you’ll feel the difference tomorrow.",
          "Pull calories into range and your score jumps fast.",
          "Narrow the swing: consistency beats intensity.",
        ]),
      };
    case "execution":
      return {
        title: pickVariant("limiter_title_exec", dayKey, [
          "The plan wasn’t consistent today.",
          "Execution was the limiter.",
          "Your routine had gaps.",
          "Data says: follow-through.",
        ]),
        body: pickVariant("limiter_body_exec", dayKey, [
          "One small action now beats a perfect plan later.",
          "Log one more input and the day becomes actionable.",
          "Keep it simple: do the next obvious step.",
          "Consistency today is momentum tomorrow.",
        ]),
      };
    default:
      return {
        title: pickVariant("limiter_title_default", dayKey, [
          "Tighten one lever.",
          "One tweak away.",
          "Small adjustment, big win.",
          "Close the loop.",
        ]),
        body: pickVariant("limiter_body_default", dayKey, [
          "You’re close — tighten one lever and ship the day.",
          "You’re in range. A small tweak makes it a win.",
          "Keep going — one adjustment flips the verdict.",
          "Solid day. Lock one lever and repeat.",
        ]),
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
    // Time-aware language: if it's still early enough, suggest logging a workout today.
    // This avoids odd copy like "log a workout tomorrow" at 3pm.
    const hour = new Date().getHours();
    const whenWord = hour < 20 ? "today" : "tomorrow";
    return [
      { title: `Log a workout ${whenWord}.`, detail: trainFix },
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


function buildSmartMealSuggestions({
  goalType,
  proteinDelta,
  calorieDelta,
  calorieTarget,
  consumed,
  burned,
}) {
  const needProteinG = Math.max(0, Math.round(-proteinDelta));
  const calOff = Math.round(Math.abs(calorieDelta || 0));
  const underTarget = (calorieDelta || 0) < 0;
  const overTarget = (calorieDelta || 0) > 0;

  // Simple, high-signal “blocks” that feel smart but stay deterministic (no extra API calls).
  const proteinBlocksCut = [
    { title: "Whey isolate (water)", macro: "+25g protein", meta: "~110 kcal", detail: "Fastest way to close the gap with minimal calories." },
    { title: "Egg whites + spinach", macro: "+30g protein", meta: "~170 kcal", detail: "High protein, low calorie, very repeatable." },
    { title: "Tuna packet + pickles", macro: "+20g protein", meta: "~100 kcal", detail: "Zero-cook protein anchor." },
  ];

  const proteinBlocksBulk = [
    { title: "Greek yogurt + whey", macro: "+45g protein", meta: "~320 kcal", detail: "Protein anchor + easy to hit daily." },
    { title: "Chicken + rice bowl", macro: "+50g protein", meta: "~550 kcal", detail: "Clean calories that support training." },
    { title: "Lean beef + potatoes", macro: "+45g protein", meta: "~600 kcal", detail: "Great for appetite + recovery." },
  ];

  const proteinBlocksMaintain = [
    { title: "Greek yogurt + berries", macro: "+25g protein", meta: "~220 kcal", detail: "Easy win without blowing calories." },
    { title: "Chicken salad (light dressing)", macro: "+35g protein", meta: "~350 kcal", detail: "High protein, controlled calories." },
    { title: "Cottage cheese bowl", macro: "+28g protein", meta: "~250 kcal", detail: "Slow digesting protein for satiety." },
  ];

  const blocks =
    goalType === "cut" ? proteinBlocksCut : goalType === "bulk" ? proteinBlocksBulk : proteinBlocksMaintain;

  // If the limiter isn’t protein, still give a “smart block” that matches the situation.
  const tightenCalBlock = underTarget
    ? { title: "Add a controlled +300–400 kcal block", macro: "carbs + protein", meta: "today", detail: "Bring calories closer to target without guesswork." }
    : overTarget
      ? { title: "Swap to a lean meal next", macro: "protein + veg", meta: "low oil", detail: "Keep protein high while tightening calories." }
      : { title: "Hold the line", macro: "repeatable meal", meta: "same timing", detail: "You’re close — repeat what’s working." };

  // Build the final suggestion set with a little bit of “brain” context.
  const suggestions = [];
  if (needProteinG >= 15) {
    suggestions.push(...blocks.slice(0, 3));
  } else {
    // If protein is close, prioritize calorie/consistency blocks.
    suggestions.push(tightenCalBlock, blocks[0], blocks[1]);
  }

  // Add a “why” line that references actual inputs (makes it feel intelligent).
  const whyParts = [];
  if (calorieTarget) whyParts.push(`Calories: ${Math.round(consumed)} / ${Math.round(calorieTarget)} kcal`);
  if (burned) whyParts.push(`Burned: ${Math.round(burned)} kcal`);
  if (needProteinG > 0) whyParts.push(`Protein gap: ${needProteinG}g`);

  const why = whyParts.length ? whyParts.join(" • ") : "";

  // Headline tuned to urgency without making medical claims.
  const headline =
    needProteinG >= 40
      ? "Close the protein gap fast."
      : needProteinG >= 15
        ? "Add one protein anchor."
        : underTarget && calOff >= 400
          ? "Add a controlled calorie block."
          : overTarget && calOff >= 400
            ? "Tighten calories with a lean swap."
            : "Keep it repeatable.";

  return { headline, why, suggestions: suggestions.slice(0, 3) };
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
        border: "1px solid rgba(148,163,184,0.18)",
        background: "linear-gradient(180deg, rgba(15,23,42,0.98) 0%, rgba(2,6,23,0.98) 100%)",
        color: "rgba(255,255,255,0.92)",
      }}
    >
      <CardContent sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 950, letterSpacing: -0.2 }}>{title}</Typography>
            {subtitle && (
              <Typography variant="caption" sx={{ color: "rgba(226,232,240,0.75)" }}>
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

  const macroChipSx = {
    bgcolor: "rgba(255,255,255,0.10)",
    color: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(255,255,255,0.18)",
    backdropFilter: "blur(6px)",
    "& .MuiChip-icon": { color: "rgba(255,255,255,0.92)" },
  };

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

    const mealHistoryScoped = safeJsonParse(localStorage.getItem(mealKey), []);
    const workoutHistoryScoped = safeJsonParse(localStorage.getItem(workoutKey), []);

    // Fallback: if scoped keys are temporarily empty during auth bootstrapping, use legacy keys
    const mealHistoryLegacy = safeJsonParse(localStorage.getItem("mealHistory"), []);
    const workoutHistoryLegacy = safeJsonParse(localStorage.getItem("workoutHistory"), []);

    const mealHistory = (uid && Array.isArray(mealHistoryScoped) && mealHistoryScoped.length === 0 && Array.isArray(mealHistoryLegacy) && mealHistoryLegacy.length > 0)
      ? mealHistoryLegacy
      : mealHistoryScoped;

    const workoutHistory = (uid && Array.isArray(workoutHistoryScoped) && workoutHistoryScoped.length === 0 && Array.isArray(workoutHistoryLegacy) && workoutHistoryLegacy.length > 0)
      ? workoutHistoryLegacy
      : workoutHistoryScoped;
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

  const baseVerdict = useMemo(
  () =>
    verdictFromSignals({
      hasLogs: bundle.derived.hasLogs,
      confidenceLabel: bundle.derived.confidenceLabel,
      score: bundle.derived.score,
    }),
  [bundle]
);

const limiter = useMemo(() => limiterCopy(bundle.derived.limiterKey, bundle.dayISO || bundle.dayUS), [bundle]);

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


  const smartFix = useMemo(
    () =>
      buildSmartMealSuggestions({
        goalType: bundle.targets.goalType,
        proteinDelta: bundle.derived.proteinDelta,
        calorieDelta: bundle.derived.calorieDelta,
        calorieTarget: bundle.targets.calorieTarget,
        consumed: bundle.totals.consumed,
        burned: bundle.totals.burned,
      }),
    [bundle]
  );
const verdict = useMemo(() => {
  const v = baseVerdict;

  // Give the arrow-copy actual meaning: point to the next action.
  const nextTitleRaw = tomorrowPlan?.[0]?.title || "";
  const nextTitle = String(nextTitleRaw || "").replace(/\.$/, "");

  if ((v?.tag === "needs work" || v?.tag === "medium signal") && nextTitle) {
    return { ...v, sub: `Next: ${nextTitle}.` };
  }

  return v;
}, [baseVerdict, tomorrowPlan]);


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

  // Calorie tightness: % close to target for *today*.
  // Use target itself as the scale so being under by (target - eaten + burned) doesn't collapse to 0 too early.
  // Example: target 3150, consumed 920, burned 0 => off 2230 => tightness ~29% (not 0%).
  const calTightnessScale = bundle.targets.calorieTarget
    ? Math.max(500, bundle.targets.calorieTarget)
    : 700;

  const calQuality = bundle.targets.calorieTarget
    ? clamp(100 - (calErr / calTightnessScale) * 100, 0, 100)
    : 0;

  
  
  // Extra targets (used for the “Personalized targets” rings)
  const normGoal = normalizeGoalType(bundle.targets.goalType);
  const carbsTarget = bundle.targets.carbsTarget
    ? Number(bundle.targets.carbsTarget)
    : normGoal === "bulk"
      ? 220
      : normGoal === "cut"
        ? 170
        : 200;

  const fatsTarget = bundle.targets.fatsTarget
    ? Number(bundle.targets.fatsTarget)
    : normGoal === "bulk"
      ? 64
      : normGoal === "cut"
        ? 55
        : 60;

  const caloriesTarget = bundle.targets.calorieTarget ? Number(bundle.targets.calorieTarget) : 0;

  const weightLbs = Number(bundle.profile?.weight_lbs || bundle.profile?.weight || 0) || 0;
  const waterTargetOz = weightLbs > 0 ? clamp(Math.round(weightLbs * 0.67), 80, 140) : 122;
  const electrolytesTargetMg = 818;

  // We don't currently track water/electrolytes consumption in-app; keep progress at 0 until we do.
  const waterOz = Number(bundle.totals?.water_oz || 0) || 0;
  const electrolytesMg = Number(bundle.totals?.electrolytes_mg || 0) || 0;

  const pctOf = (v, t) => (t > 0 ? clamp((Number(v || 0) / t) * 100, 0, 100) : 0);

  const carbsPct = pctOf(bundle.totals.macros.carbs_g, carbsTarget);
  const fatsPct = pctOf(bundle.totals.macros.fats_g, fatsTarget);
  const caloriesPct = pctOf(bundle.totals.consumed, caloriesTarget);
  const waterPct = pctOf(waterOz, waterTargetOz);
  const electrolytesPct = pctOf(electrolytesMg, electrolytesTargetMg);

const proteinGap = bundle.targets.proteinTarget
    ? Math.max(0, bundle.targets.proteinTarget - bundle.totals.macros.protein_g)
    : 0;

  const flag = useMemo(() => {
  const dayKey = bundle.dayISO || bundle.dayUS || "";

  const proteinPctLocal = bundle.targets.proteinTarget
    ? clamp((bundle.totals.macros.protein_g / Math.max(1, bundle.targets.proteinTarget)) * 100, 0, 200)
    : 0;

  const proteinGapLocal = bundle.targets.proteinTarget
    ? Math.max(0, bundle.targets.proteinTarget - bundle.totals.macros.protein_g)
    : 0;

  const hasWorkout = !!bundle.derived.hasWorkout;
  const hasCalTarget = !!bundle.targets.calorieTarget;

  // RED (bad)
  if (bundle.targets.proteinTarget && proteinPctLocal < 60 && proteinGapLocal >= 25) {
    return {
      label: pickVariant("flag_red_protein", dayKey, ["RED FLAG: LOW PROTEIN", "RED FLAG: PROTEIN GAP", "RED FLAG: PROTEIN LEAK"]),
      tone: "error",
    };
  }
  if (hasCalTarget && calQuality < 45 && calErr > 400) {
    return {
      label: pickVariant("flag_red_cal", dayKey, ["RED FLAG: CALORIE DRIFT", "RED FLAG: TARGET MISSED", "RED FLAG: CALORIE SWING"]),
      tone: "error",
    };
  }

  // ORANGE (meh)
  if (!bundle.derived.profileComplete || !bundle.derived.hasMeals) {
    return {
      label: pickVariant("flag_orange_data", dayKey, ["ORANGE FLAG: NEEDS MORE DATA", "ORANGE FLAG: LOG 2 MEALS", "ORANGE FLAG: FINISH SETUP"]),
      tone: "warning",
    };
  }
  if (bundle.targets.proteinTarget && proteinPctLocal < 85 && proteinGapLocal >= 10) {
    return {
      label: pickVariant("flag_orange_protein", dayKey, ["ORANGE FLAG: PROTEIN LOW", "ORANGE FLAG: CLOSE PROTEIN GAP", "ORANGE FLAG: PROTEIN LAG"]),
      tone: "warning",
    };
  }
  if (hasCalTarget && calQuality < 70 && calErr > 250) {
    return {
      label: pickVariant("flag_orange_cal", dayKey, ["ORANGE FLAG: CALORIES OFF", "ORANGE FLAG: TIGHTEN TARGET", "ORANGE FLAG: CALORIE WOBBLE"]),
      tone: "warning",
    };
  }
  if (!hasWorkout && bundle.totals.consumed > 0) {
    return {
      label: pickVariant("flag_orange_move", dayKey, ["ORANGE FLAG: NO WORKOUT LOGGED", "ORANGE FLAG: MOVE TODAY", "ORANGE FLAG: TRAINING MISSING"]),
      tone: "warning",
    };
  }

  // GREEN (best)
  return {
    label: pickVariant("flag_green", dayKey, ["GREEN FLAG: ON TRACK", "GREEN FLAG: SOLID DAY", "GREEN FLAG: KEEP IT GOING"]),
    tone: "success",
  };
}, [
  bundle.dayISO,
  bundle.dayUS,
  bundle.targets.proteinTarget,
  bundle.targets.calorieTarget,
  bundle.totals.macros.protein_g,
  bundle.totals.consumed,
  bundle.derived.profileComplete,
  bundle.derived.hasMeals,
  bundle.derived.hasWorkout,
  calQuality,
  calErr,
]);

const hasEstimates = !!bundle.est.bmr_est && !!bundle.est.tdee_est;

  const metabolismLine = hasEstimates
    ? `BMR ${Math.round(bundle.est.bmr_est)} • TDEE ${Math.round(bundle.est.tdee_est)}`
    : "Set up Health Data to unlock BMR/TDEE";

  const targetLine = bundle.targets.calorieTarget
    ? hasEstimates
      ? `Target ${Math.round(bundle.targets.calorieTarget)} (vs TDEE ${Math.round(bundle.est.tdee_delta)})`
      : `Target ${Math.round(bundle.targets.calorieTarget)}`
    : "Set a calorie target";

  
  const Ring = ({ pct, size, title, value, tone = "primary.main" }) => {
    const v = clamp(Number(pct || 0), 0, 100);
    return (
      <Box sx={{ position: "relative", width: size, height: size, flex: "0 0 auto" }}>
        <CircularProgress
          variant="determinate"
          value={100}
          size={size}
          thickness={5}
          sx={{ color: "rgba(226,232,240,0.14)" }}
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
            <Typography sx={{ fontWeight: 950, fontSize: size >= 86 ? 18 : size >= 66 ? 14 : 12, lineHeight: 1.05 }}>
              {value}
            </Typography>
            <Typography variant="caption" sx={{ color: "rgba(226,232,240,0.72)", fontSize: size >= 86 ? 12 : 11 }}>
              {title}
            </Typography>
          </Box>
        </Box>
      </Box>
    );
  };

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
          <Typography variant="caption" sx={{ color: "rgba(226,232,240,0.72)" }}>
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
              color={flag?.tone || (scoreAnim >= 88 ? "success" : scoreAnim >= 74 ? "primary" : "warning")}
            />
          }
        >
          <Typography sx={{ fontWeight: 950, lineHeight: 1.2 }}>{verdict.headline}</Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: "rgba(226,232,240,0.78)" }}>
            {verdict.sub}
          </Typography>

          {flag && (
            <Chip
              icon={<WarningAmberIcon sx={{ color: "inherit" }} />}
              label={flag.label}
              color={flag.tone}
              sx={{ mt: 1, fontWeight: 950, borderRadius: 999 }}
            />
          )}

          <Divider sx={{ my: 1.4 }} />

          <Stack spacing={1}>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Chip size="small" sx={macroChipSx} label={`🍽️ Eaten: ${Math.round(bundle.totals.consumed)} kcal`} />
              <Chip size="small" sx={macroChipSx} icon={<FitnessCenterIcon />} label={`Burned: ${Math.round(bundle.totals.burned)} kcal`} />
              <Chip size="small" sx={macroChipSx} label={`⚖️ Net: ${Math.round(bundle.totals.netKcal)} kcal`} />
              <Chip size="small" sx={macroChipSx} label={`🥩 Protein: ${Math.round(bundle.totals.macros.protein_g)} g`} />
            </Stack>

            {/* Rings */}
            <Box
              sx={{
                mt: 0.8,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 1.2,
                alignItems: "center",
              }}
            >
              {/* Big: Calorie tightness */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.2 }}>
                <Ring
                  pct={bundle.targets.calorieTarget ? calQuality : 0}
                  size={96}
                  title="Tightness"
                  value={bundle.targets.calorieTarget ? `${Math.round(calQuality)}%` : "—"}
                  tone="primary.main"
                />
                <Box>
                  <Stack direction="row" spacing={0.8} alignItems="center">
                    <TrackChangesIcon sx={{ fontSize: 18, color: "rgba(226,232,240,0.85)" }} />
                    <Typography variant="caption" sx={{ color: "rgba(226,232,240,0.72)" }}>
                      Calorie drift
                    </Typography>
                  </Stack>
                  <Typography sx={{ fontWeight: 950 }}>
                    {bundle.targets.calorieTarget ? `Off ${Math.round(calErr)} kcal` : "Set a target"}
                  </Typography>
                </Box>
              </Box>

              {/* Medium macros */}
              <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
                <Ring pct={pctOf(bundle.totals.macros.protein_g, bundle.targets.proteinTarget || 0)} size={72} title="Protein" value={`${Math.round(bundle.totals.macros.protein_g)}g`} />
                <Ring pct={carbsPct} size={72} title="Carbs" value={`${Math.round(bundle.totals.macros.carbs_g)}g`} />
                <Ring pct={fatsPct} size={72} title="Fats" value={`${Math.round(bundle.totals.macros.fats_g)}g`} />
              </Box>

              {/* Medium calories target (no duplicate tightness) */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.2 }}>
                <Ring
                  pct={caloriesPct}
                  size={72}
                  title="Calories"
                  value={caloriesTarget ? `${Math.round(bundle.totals.consumed)}` : "—"}
                  tone="primary.main"
                />
                <Typography variant="caption" sx={{ color: "rgba(226,232,240,0.72)" }}>
                  today vs target
                </Typography>
              </Box>

              {/* Small: water + electrolytes */}
              <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
                <Ring pct={waterPct} size={58} title="Water" value={`${Math.round(waterOz)}oz`} tone="primary.main" />
                <Ring pct={electrolytesPct} size={58} title="Electrolytes" value={`${Math.round(electrolytesMg)}mg`} tone="primary.main" />
              </Box>
            </Box>

            <Box
              sx={{
                p: 1.1,
                borderRadius: 2,
                border: "1px solid rgba(148,163,184,0.18)",
                background: "rgba(255,255,255,0.04)",
                mt: 0.8,
              }}
            >
              <Typography variant="caption" sx={{ display: "block", color: "rgba(226,232,240,0.72)" }}>
                Metabolism baseline
              </Typography>
              <Typography sx={{ fontWeight: 900 }}>{metabolismLine}</Typography>
              <Typography variant="caption" sx={{ display: "block", mt: 0.4, color: "rgba(226,232,240,0.72)" }}>
                {targetLine}
              </Typography>
            </Box>

            <Box>
              <Typography variant="caption" sx={{ color: "rgba(226,232,240,0.72)" }}>
                Protein progress
              </Typography>
              <LinearProgress
                variant="determinate"
                value={bundle.targets.proteinTarget ? clamp(proteinPct, 0, 100) : 0}
                sx={{ height: 10, borderRadius: 999, mt: 0.6 }}
              />
              <Typography variant="caption" sx={{ display: "block", mt: 0.6, color: "rgba(226,232,240,0.86)" }}>
                Target: {bundle.targets.proteinTarget ? `${Math.round(bundle.targets.proteinTarget)}g` : "not set"}
              </Typography>
            </Box>

            <Box>
              <Typography variant="caption" sx={{ color: "rgba(226,232,240,0.72)" }}>
                Calorie tightness
              </Typography>
              <LinearProgress
                variant="determinate"
                value={bundle.targets.calorieTarget ? calQuality : 0}
                sx={{ height: 10, borderRadius: 999, mt: 0.6 }}
              />
              <Typography variant="caption" sx={{ display: "block", mt: 0.6, color: "rgba(226,232,240,0.86)" }}>
                {bundle.targets.calorieTarget
                  ? `Target: ${Math.round(bundle.targets.calorieTarget)} kcal • Off by ${Math.round(calErr)} kcal`
                  : "Target: not set"}
              </Typography>
            </Box>
          </Stack>
        </CardShell>

        {/* Card 2: Limiter */}
        <CardShell
          title="Your #1 Fix"
          subtitle="what moves the needle fastest"
          chip={<Chip size="small" label="limiter" sx={{ fontWeight: 900 }} />}
        >
          <Typography sx={{ fontWeight: 950 }}>{limiter.title}</Typography>
          <Typography variant="body2" sx={{ mt: 0.7, color: "rgba(226,232,240,0.78)" }}>
            {limiter.body}
          </Typography>

          <Divider sx={{ my: 1.4 }} />

          <Stack spacing={1}>
            <Typography variant="caption" sx={{ color: "rgba(226,232,240,0.72)" }}>
              Quick read:
            </Typography>

            <Typography variant="body2" sx={{ color: "rgba(226,232,240,0.90)" }}>
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
                <>
                  You need at least <strong>2 meals</strong> logged for a real verdict.
                </>
              )}
              {bundle.derived.limiterKey === "missing_training" && (
                <>
                  Log <strong>one workout</strong> and your day becomes measurable.
                </>
              )}
              {bundle.derived.limiterKey === "missing_profile" && (
                <>
                  Finish setup so your target is grounded in <strong>BMR/TDEE</strong>.
                </>
              )}
              {bundle.derived.limiterKey === "execution" && <>Make tomorrow repeatable: pick one non-negotiable.</>}
              {bundle.derived.limiterKey === "tighten_one_leak" && <>You’re close — tighten one thing and repeat.</>}
            </Typography>

            <Box sx={{ mt: 1.2 }}>
              <Typography variant="caption" sx={{ color: "rgba(226,232,240,0.72)" }}>
                Smart fix (pick 1):
              </Typography>

              <Typography sx={{ fontWeight: 950, mt: 0.4 }}>{smartFix.headline}</Typography>

              {smartFix.why && (
                <Typography variant="caption" sx={{ display: "block", mt: 0.3, color: "rgba(226,232,240,0.62)" }}>
                  {smartFix.why}
                </Typography>
              )}

              <Stack spacing={1} sx={{ mt: 1.1 }}>
                {smartFix.suggestions.map((s, i) => (
                  <Box
                    key={`${s.title}-${i}`}
                    sx={{
                      p: 1.1,
                      borderRadius: 2,
                      border: "1px solid rgba(148,163,184,0.18)",
                      background: "rgba(2,6,23,0.10)",
                    }}
                  >
                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                      <Typography sx={{ fontWeight: 950 }}>{s.title}</Typography>
                      <Chip
                        size="small"
                        label={`${s.macro} • ${s.meta}`}
                        sx={{
                          fontWeight: 900,
                          bgcolor: "rgba(148,163,184,0.18)",
                          color: "rgba(226,232,240,0.92)",
                        }}
                      />
                    </Stack>

                    <Typography variant="body2" sx={{ mt: 0.5, color: "rgba(226,232,240,0.78)" }}>
                      {s.detail}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Box>

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

        {/* Card 3: AI Verdict + Actions */}
        <CardShell
          title="AI Coach Verdict"
          subtitle="your final report card"
          chip={<Chip size="small" label="verdict" sx={{ fontWeight: 900 }} />}
        >
          <Stack spacing={1.2}>
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
              <Box>
                <Typography sx={{ fontWeight: 950 }}>AI Coach Verdict</Typography>
                <Typography variant="caption" sx={{ color: "rgba(226,232,240,0.72)" }}>
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
              <Typography color="error" variant="body2" sx={{ mt: 0.5 }}>
                {aiError}
              </Typography>
            )}

            {aiVerdict ? (
              <Box
                sx={{
                  mt: 0.5,
                  p: 1.2,
                  borderRadius: 2,
                  border: "1px solid rgba(148,163,184,0.18)",
                  background: "rgba(2,6,23,0.10)",
                }}
              >
                <Typography sx={{ whiteSpace: "pre-wrap", color: "rgba(226,232,240,0.92)" }}>
                  {aiVerdict}
                </Typography>
              </Box>
            ) : (
              <Box
                sx={{
                  mt: 0.5,
                  p: 1.2,
                  borderRadius: 2,
                  border: "1px dashed rgba(148,163,184,0.22)",
                  background: "rgba(2,6,23,0.06)",
                }}
              >
                <Typography variant="body2" sx={{ color: "rgba(226,232,240,0.70)" }}>
                  Tap <strong>Get Verdict</strong> for a personalized breakdown based on your health profile, meals, and workouts.
                </Typography>
              </Box>
            )}

            <Divider sx={{ my: 0.6 }} />

            <Typography variant="caption" sx={{ color: "rgba(226,232,240,0.72)" }}>
              Actions (fix what’s missing):
            </Typography>

            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Button
                size="small"
                variant={bundle.derived.limiterKey === "missing_meals" || bundle.derived.limiterKey === "protein" ? "contained" : "outlined"}
                onClick={() => history.push("/meals")}
                sx={{ borderRadius: 999, fontWeight: 900 }}
              >
                Log Meal
              </Button>

              <Button
                size="small"
                variant={bundle.derived.limiterKey === "missing_training" ? "contained" : "outlined"}
                onClick={() => history.push("/workout")}
                sx={{ borderRadius: 999, fontWeight: 900 }}
              >
                Log Workout
              </Button>

              {!bundle.derived.profileComplete && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => history.push("/health")}
                  sx={{ borderRadius: 999, fontWeight: 900 }}
                >
                  Finish Health Setup
                </Button>
              )}
            </Stack>
          </Stack>
        </CardShell>
      </Box>

      <Typography variant="caption" sx={{ display: "block", mt: 1, color: "rgba(226,232,240,0.65)" }}>
        Tip: swipe/scroll the cards → this is meant to feel quick, not overwhelming.
      </Typography>

      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
    </Box>
  );
}
