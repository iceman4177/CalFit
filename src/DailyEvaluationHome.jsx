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
  LinearProgress,
  Stack,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Slider,
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
        title: "Targets aren’t personalized yet.",
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
          "Calories are the swing factor.",
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
          "Execution was the limiter.",
          "Your routine had gaps.",
          "Data says: follow-through.",
          "The plan wasn’t consistent today.",
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
          "One tweak away.",
          "Small adjustment, big win.",
          "Close the loop.",
          "Tighten one thing.",
        ]),
        body: pickVariant("limiter_body_default", dayKey, [
          "You’re close — tighten one thing and ship the day.",
          "You’re in range. A small tweak makes it a win.",
          "Keep going — one adjustment flips the verdict.",
          "Solid day. Lock one thing and repeat.",
        ]),
      };
  }
}

function verdictFromSignals({ hasLogs, confidenceLabel, score }) {
  if (!hasLogs) return { headline: "No signal yet.", sub: "Log meals + a workout. Then I’ll judge the day.", tag: "no data" };
  if (confidenceLabel === "Low") return { headline: "Directionally true…", sub: "Add a bit more logging for a sharper verdict.", tag: "low signal" };
  if (confidenceLabel === "Medium") return { headline: "Pretty clear day.", sub: "You’re close — tighten one thing.", tag: "medium signal" };
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

  // --- Option B interaction state (UI-only; no logic/sync writes) ---
  const [activeRing, setActiveRing] = useState(null); // "calories" | "protein" | "training" | null
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

  // Simulator state (UI-only projections)
  const [selectedFix, setSelectedFix] = useState("tighten_calories");
  const [calAdj, setCalAdj] = useState(-250); // negative = reduce calories
  const [proteinAdj, setProteinAdj] = useState(20);
  const [walkOn, setWalkOn] = useState(false);

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

    const mealHistory =
      uid &&
      Array.isArray(mealHistoryScoped) &&
      mealHistoryScoped.length === 0 &&
      Array.isArray(mealHistoryLegacy) &&
      mealHistoryLegacy.length > 0
        ? mealHistoryLegacy
        : mealHistoryScoped;

    const workoutHistory =
      uid &&
      Array.isArray(workoutHistoryScoped) &&
      workoutHistoryScoped.length === 0 &&
      Array.isArray(workoutHistoryLegacy) &&
      workoutHistoryLegacy.length > 0
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

    const calorieTarget =
      Number(userData?.dailyGoal) || Number(localStorage.getItem("dailyGoal") || 0) || 0;

    const proteinTarget =
      Number(userData?.proteinTargets?.daily_g) ||
      Number(localStorage.getItem("protein_target_daily_g") || 0) ||
      0;

    const goalType = normalizeGoalType(userData?.goalType);

    // NEW: BMR/TDEE from HealthDataForm (persisted)
    const bmrEst = Number(userData?.bmr_est) || Number(localStorage.getItem("bmr_est") || 0) || 0;

    const tdeeEst = Number(userData?.tdee_est) || Number(localStorage.getItem("tdee_est") || 0) || 0;

    const profileComplete = hasBmrInputs(userData) && !!userData?.goalType;

    const hasMeals = consumedFinal > 0 || (dayMealsRec?.meals?.length || 0) > 0;
    const hasWorkout = burnedFinal > 0;
    const hasLogs = hasMeals || hasWorkout;

    const calorieDelta = calorieTarget ? consumedFinal - calorieTarget : netKcal;
    const fallbackProteinTarget = goalType === "cut" ? 140 : 120;
    const pTarget = Number(proteinTarget) || fallbackProteinTarget;
    const proteinDelta = macros.protein_g - pTarget;

    // Confidence now explicitly rewards: profile complete + meals + workout
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

  const limiter = useMemo(
    () => limiterCopy(bundle.derived.limiterKey, bundle.dayISO || bundle.dayUS),
    [bundle]
  );

  const verdict = useMemo(() => baseVerdict, [baseVerdict]);

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
- If BMR/TDEE are provided, mention that the target is grounded in metabolism.
- End with 2 bullet points for tomorrow.

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
- Target vs TDEE: ${
          hasEst && bundle.targets.calorieTarget ? `${Math.round(bundle.est.tdee_delta)} kcal` : "n/a"
        }

Confidence: ${bundle.derived.confidenceLabel}
Limiter: ${bundle.derived.limiterKey}
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

  const calErr = bundle.targets.calorieTarget
    ? Math.abs(bundle.totals.consumed - bundle.targets.calorieTarget)
    : Math.abs(bundle.totals.netKcal);

  // On-track % (scaled by target so it doesn't collapse to 0 when under)
  const calTightnessScale = bundle.targets.calorieTarget
    ? Math.max(500, bundle.targets.calorieTarget)
    : 700;

  const calQuality = bundle.targets.calorieTarget
    ? clamp(100 - (calErr / calTightnessScale) * 100, 0, 100)
    : 0;

  const safeNum = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
  const safeInt = (n) => Math.round(safeNum(n));

  const pctOf = (v, t) => (t > 0 ? clamp((Number(v || 0) / t) * 100, 0, 100) : 0);

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

    if (bundle.targets.proteinTarget && proteinPctLocal < 60 && proteinGapLocal >= 25) {
      return {
        label: pickVariant("flag_red_protein", dayKey, [
          "RED FLAG: LOW PROTEIN",
          "RED FLAG: PROTEIN GAP",
          "RED FLAG: PROTEIN LEAK",
        ]),
        tone: "error",
      };
    }
    if (hasCalTarget && calQuality < 45 && calErr > 400) {
      return {
        label: pickVariant("flag_red_cal", dayKey, [
          "RED FLAG: CALORIE DRIFT",
          "RED FLAG: TARGET MISSED",
          "RED FLAG: CALORIE SWING",
        ]),
        tone: "error",
      };
    }

    if (!bundle.derived.profileComplete || !bundle.derived.hasMeals) {
      return {
        label: pickVariant("flag_orange_data", dayKey, [
          "ORANGE FLAG: NEEDS MORE DATA",
          "ORANGE FLAG: LOG 2 MEALS",
          "ORANGE FLAG: FINISH SETUP",
        ]),
        tone: "warning",
      };
    }
    if (bundle.targets.proteinTarget && proteinPctLocal < 85 && proteinGapLocal >= 10) {
      return {
        label: pickVariant("flag_orange_protein", dayKey, [
          "ORANGE FLAG: PROTEIN LOW",
          "ORANGE FLAG: CLOSE PROTEIN GAP",
          "ORANGE FLAG: PROTEIN LAG",
        ]),
        tone: "warning",
      };
    }
    if (hasCalTarget && calQuality < 70 && calErr > 250) {
      return {
        label: pickVariant("flag_orange_cal", dayKey, [
          "ORANGE FLAG: CALORIES OFF",
          "ORANGE FLAG: TIGHTEN TARGET",
          "ORANGE FLAG: CALORIE WOBBLE",
        ]),
        tone: "warning",
      };
    }
    if (!hasWorkout && bundle.totals.consumed > 0) {
      return {
        label: pickVariant("flag_orange_move", dayKey, [
          "ORANGE FLAG: NO WORKOUT LOGGED",
          "ORANGE FLAG: MOVE TODAY",
          "ORANGE FLAG: TRAINING MISSING",
        ]),
        tone: "warning",
      };
    }

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

  // --- Interactive layer helpers (UI only) ---
  const gradeFromScore = (s) => {
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
  };

  const projectedGradeLabel = (s) => gradeFromScore(s);

  const fixChips = useMemo(() => {
    const chips = [];

    if (!bundle.derived.profileComplete) {
      chips.push({ key: "finish_setup", label: "Finish setup" });
      chips.push({ key: "log_meal", label: "Log 1 meal" });
      return chips;
    }

    if (!bundle.derived.hasMeals) {
      chips.push({ key: "log_meal", label: "Log a meal" });
      chips.push({ key: "add_protein", label: "Add protein" });
      return chips;
    }

    if (!bundle.derived.hasWorkout) {
      chips.push({ key: "log_workout", label: "Log workout" });
      chips.push({ key: "walk", label: "10-min walk" });
      chips.push({ key: "tighten_calories", label: "Tighten calories" });
      return chips;
    }

    if (bundle.targets.proteinTarget && proteinGap >= 10) {
      chips.push({ key: "add_protein", label: "Add protein" });
      chips.push({ key: "protein_anchor", label: "+1 protein anchor" });
    }

    chips.push({ key: "tighten_calories", label: "Tighten calories" });
    chips.push({ key: "remove_snack", label: "Remove snack" });
    chips.push({ key: "swap_dinner", label: "Swap dinner" });

    return chips.slice(0, 4);
  }, [
    bundle.derived.profileComplete,
    bundle.derived.hasMeals,
    bundle.derived.hasWorkout,
    bundle.targets.proteinTarget,
    proteinGap,
  ]);

  useEffect(() => {
    if (!fixChips.some((c) => c.key === selectedFix)) {
      setSelectedFix(fixChips?.[0]?.key || "tighten_calories");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixChips]);

  const projected = useMemo(() => {
    const WALK_KCAL = 60;

    let consumedAdj = bundle.totals.consumed;
    let burnedAdj = bundle.totals.burned;
    let proteinAdjG = bundle.totals.macros.protein_g;

    if (selectedFix === "swap_dinner" || selectedFix === "remove_snack" || selectedFix === "tighten_calories") {
      consumedAdj = Math.max(0, consumedAdj + Number(calAdj || 0));
    }

    if (selectedFix === "add_protein" || selectedFix === "protein_anchor") {
      proteinAdjG = Math.max(0, proteinAdjG + Number(proteinAdj || 0));
    }

    if (selectedFix === "walk") burnedAdj = burnedAdj + WALK_KCAL;
    if (walkOn) burnedAdj = burnedAdj + WALK_KCAL;

    const netAdj = consumedAdj - burnedAdj;

    const { score } = computeScore({
      goalType: bundle.targets.goalType,
      calorieTarget: bundle.targets.calorieTarget,
      consumed: consumedAdj,
      burned: burnedAdj,
      netKcal: netAdj,
      proteinTarget: bundle.targets.proteinTarget,
      proteinG: proteinAdjG,
      hasWorkout: burnedAdj > 0,
    });

    const deltaTxt = (() => {
      if (!bundle.targets.calorieTarget) return "Set a calorie target to make the projection precise.";
      const left = Math.round(bundle.targets.calorieTarget - consumedAdj);
      if (left > 0) return `After this, you’d have ~${left} kcal left for the day.`;
      return `After this, you’d be ~${Math.abs(left)} kcal over target.`;
    })();

    return { score: Number(score || 0), deltaTxt };
  }, [
    bundle.targets.goalType,
    bundle.targets.calorieTarget,
    bundle.targets.proteinTarget,
    bundle.totals.consumed,
    bundle.totals.burned,
    bundle.totals.macros.protein_g,
    calAdj,
    proteinAdj,
    selectedFix,
    walkOn,
  ]);

  const projectedScore = projected.score;
  const projectedDeltaLine = projected.deltaTxt;

  const handleShare = async () => {
    const grade = gradeFromScore(bundle.derived.score);
    const headline = aiVerdict ? "Coach verdict inside." : verdict.headline;
    const msg = aiVerdict
      ? `I got a ${grade} today.\n\n${aiVerdict}\n\nWhat’s your grade today?`
      : `I got a ${grade} today. ${headline}\nCalories: ${Math.round(bundle.totals.consumed)} • Burned: ${Math.round(bundle.totals.burned)} • Protein: ${Math.round(bundle.totals.macros.protein_g)}g\n\nWhat’s your grade today?`;

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

  const Ring = ({ pct, size, title, value, tone = "primary.main" }) => {
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
                fontSize: size >= 86 ? 18 : size >= 66 ? 14 : 12,
                lineHeight: 1.05,
                color: "rgba(255,255,255,0.92)",
              }}
            >
              {value}
            </Typography>
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.70)", fontSize: size >= 86 ? 12 : 11 }}>
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
          <Typography sx={{ fontWeight: 950, letterSpacing: -0.4, fontSize: 22, color: "rgba(255,255,255,0.92)" }}>
            Daily Evaluation
          </Typography>
          <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.70)" }}>
            {bundle.dayUS} • swipe → fix → grade
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
          {goalChip}
          {confidenceChip}
          {!pro && <FeatureUseBadge featureKey={FEATURE_KEY} isPro={false} labelPrefix="AI" />}
          {pro && <FeatureUseBadge featureKey={FEATURE_KEY} isPro={true} labelPrefix="AI" />}
        </Stack>
      </Stack>

      {/* lightweight breakdown sheet (power users) */}
      <Dialog open={showBreakdown} onClose={() => setShowBreakdown(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 950, color: "rgba(255,255,255,0.92)", bgcolor: "rgba(2,6,23,0.98)" }}>
          Breakdown
        </DialogTitle>
        <DialogContent sx={{ bgcolor: "rgba(2,6,23,0.98)", color: "rgba(255,255,255,0.80)" }}>
          <Stack spacing={1.2} sx={{ mt: 0.5 }}>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.72)" }}>Consumed</Typography>
              <Typography sx={{ fontWeight: 900 }}>{Math.round(bundle.totals.consumed)} kcal</Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.72)" }}>Burned</Typography>
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
              <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.72)" }}>Target (cal)</Typography>
              <Typography sx={{ fontWeight: 900 }}>
                {bundle.targets.calorieTarget ? Math.round(bundle.targets.calorieTarget) : "—"}
              </Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.72)" }}>Target (protein)</Typography>
              <Typography sx={{ fontWeight: 900 }}>
                {bundle.targets.proteinTarget ? Math.round(bundle.targets.proteinTarget) : "—"}
              </Typography>
            </Stack>

            <Box sx={{ mt: 0.5, p: 1, borderRadius: 2, border: "1px solid rgba(148,163,184,0.18)" }}>
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
        {/* Card 1: ultra-minimal */}
        <CardShell
          title="Today"
          subtitle="Tap a ring for details"
          chip={
            <Chip
              label={`${scoreAnim}/100`}
              sx={{ fontWeight: 950, borderRadius: 999 }}
              color={flag?.tone || (scoreAnim >= 88 ? "success" : scoreAnim >= 74 ? "primary" : "warning")}
            />
          }
        >
          <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.60)" }}>
            1/3 • Scoreboard
          </Typography>

          <Stack spacing={1.25} sx={{ mt: 1.2 }} alignItems="center">
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
                  title="On track"
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
                  pct={pctOf(bundle.totals.macros.protein_g, bundle.targets.proteinTarget || 0)}
                  size={112}
                  title="Protein"
                  value={`${safeInt(bundle.totals.macros.protein_g)}g`}
                  tone="success.main"
                />
              </Box>

              <Box
                onPointerDown={() => startHold("training")}
                onPointerUp={endHold}
                onPointerLeave={endHold}
                onClick={() => setActiveRing((v) => (v === "training" ? null : "training"))}
                sx={{ cursor: "pointer" }}
              >
                <Ring
                  pct={bundle.derived.hasWorkout ? clamp((bundle.totals.burned / 220) * 100, 0, 100) : 0}
                  size={112}
                  title="Move"
                  value={bundle.derived.hasWorkout ? `${Math.round(bundle.totals.burned)} kcal` : "—"}
                  tone="warning.main"
                />
              </Box>
            </Stack>

            <Typography sx={{ fontWeight: 900, color: "rgba(255,255,255,0.86)", textAlign: "center" }}>
              {verdict.headline}
            </Typography>
            <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.68)", textAlign: "center" }}>
              {verdict.sub}
            </Typography>

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
                          ? `You have about ${Math.round(bundle.targets.calorieTarget - bundle.totals.consumed)} kcal left.`
                          : `You’re about ${Math.round(bundle.totals.consumed - bundle.targets.calorieTarget)} kcal over.`)
                        : "Set a calorie target to unlock accurate scoring."}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.55)", textAlign: "center" }}>
                      Tip: press & hold any ring for breakdown.
                    </Typography>
                  </Stack>
                )}

                {activeRing === "protein" && (
                  <Stack spacing={0.6} alignItems="center">
                    <Typography sx={{ fontWeight: 950 }}>Protein</Typography>
                    <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.74)", textAlign: "center" }}>
                      {bundle.targets.proteinTarget
                        ? (proteinGap > 0 ? `You’re short about ${Math.round(proteinGap)}g today.` : "You hit your protein target. Great.")
                        : "Set a protein target to make this meaningful."}
                    </Typography>
                    <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.55)", textAlign: "center" }}>
                      Higher protein usually makes the rest easier.
                    </Typography>
                  </Stack>
                )}

                {activeRing === "training" && (
                  <Stack spacing={0.6} alignItems="center">
                    <Typography sx={{ fontWeight: 950 }}>Movement</Typography>
                    <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.74)", textAlign: "center" }}>
                      {bundle.derived.hasWorkout
                        ? "Workout logged — great. That makes your evaluation more accurate."
                        : "No workout logged yet. Even a short session improves the signal."}
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
                Tap a ring • Swipe for fixes • Press & hold for details
              </Typography>
            </Stack>
          </Stack>
        </CardShell>

        {/* Card 2: mostly simulator */}
        <CardShell
          title="Fix"
          subtitle="One move changes the grade"
          chip={<Chip size="small" label="2/3" sx={{ fontWeight: 950, borderRadius: 999, ...macroChipSx }} />}
        >
          <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.60)" }}>
            2/3 • The fastest win
          </Typography>

          <Stack spacing={1.2} sx={{ mt: 1.1 }} alignItems="center">
            <Typography sx={{ fontWeight: 950, textAlign: "center" }}>
              Your limiter: {limiter.title}
            </Typography>
            <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.72)", textAlign: "center" }}>
              {limiter.body}
            </Typography>

            <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap" sx={{ width: "100%" }}>
              {fixChips.map((c) => (
                <Chip
                  key={c.key}
                  label={c.label}
                  onClick={() => setSelectedFix(c.key)}
                  color={selectedFix === c.key ? "primary" : "default"}
                  sx={{
                    borderRadius: 999,
                    fontWeight: 900,
                    ...(selectedFix === c.key
                      ? {}
                      : {
                          bgcolor: "rgba(255,255,255,0.08)",
                          color: "rgba(255,255,255,0.86)",
                          border: "1px solid rgba(255,255,255,0.16)",
                        }),
                  }}
                />
              ))}
            </Stack>

            <Box sx={{ width: "100%", p: 1.2, borderRadius: 2, border: "1px solid rgba(148,163,184,0.18)", background: "rgba(15,23,42,0.6)" }}>
              <Stack spacing={1.2}>
                {(selectedFix === "swap_dinner" || selectedFix === "remove_snack" || selectedFix === "tighten_calories") && (
                  <Box>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.62)" }}>Calories change</Typography>
                      <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.84)", fontWeight: 900 }}>{calAdj} kcal</Typography>
                    </Stack>
                    <Slider value={calAdj} min={-600} max={0} step={25} onChange={(_, v) => setCalAdj(Array.isArray(v) ? v[0] : v)} />
                  </Box>
                )}

                {(selectedFix === "add_protein" || selectedFix === "protein_anchor") && (
                  <Box>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.62)" }}>Add protein</Typography>
                      <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.84)", fontWeight: 900 }}>+{proteinAdj} g</Typography>
                    </Stack>
                    <Slider value={proteinAdj} min={0} max={50} step={5} onChange={(_, v) => setProteinAdj(Array.isArray(v) ? v[0] : v)} />
                  </Box>
                )}

                <Stack direction="row" alignItems="center" justifyContent="space-between">
                  <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.62)" }}>
                    Add a 10-min walk
                  </Typography>
                  <Chip
                    label={walkOn ? "ON" : "OFF"}
                    onClick={() => setWalkOn((v) => !v)}
                    color={walkOn ? "success" : "default"}
                    sx={{
                      borderRadius: 999,
                      fontWeight: 950,
                      ...(walkOn
                        ? {}
                        : {
                            bgcolor: "rgba(255,255,255,0.08)",
                            color: "rgba(255,255,255,0.86)",
                            border: "1px solid rgba(255,255,255,0.16)",
                          }),
                    }}
                  />
                </Stack>

                <Divider sx={{ borderColor: "rgba(148,163,184,0.18)" }} />

                <Stack spacing={0.6} alignItems="center">
                  <Typography sx={{ fontWeight: 950, color: "rgba(255,255,255,0.90)" }}>
                    Projected: {projectedGradeLabel(projectedScore)} ({Math.round(projectedScore)}/100)
                  </Typography>
                  <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.70)", textAlign: "center" }}>
                    {projectedDeltaLine}
                  </Typography>

                  <Button
                    variant="contained"
                    onClick={() => {
                      if (selectedFix === "log_workout") history.push("/workout");
                      else if (selectedFix === "finish_setup") history.push("/health");
                      else history.push("/meals");
                    }}
                    sx={{ mt: 0.6, borderRadius: 999, fontWeight: 950, px: 2.6 }}
                  >
                    Do this now
                  </Button>

                  <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.55)", textAlign: "center" }}>
                    Preview only — nothing changes until you log.
                  </Typography>
                </Stack>
              </Stack>
            </Box>
          </Stack>
        </CardShell>

        {/* Card 3: grade + AI + actions + share */}
        <CardShell
          title="Grade"
          subtitle="Submit your day"
          chip={<Chip size="small" label="3/3" sx={{ fontWeight: 950, borderRadius: 999, ...macroChipSx }} />}
        >
          <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.60)" }}>
            3/3 • Report card
          </Typography>

          <Stack spacing={1.2} sx={{ mt: 1.1 }} alignItems="center">
            <Box
              sx={{
                width: 120,
                height: 120,
                borderRadius: 999,
                border: "1px solid rgba(148,163,184,0.22)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(15,23,42,0.55)",
              }}
            >
              <Typography sx={{ fontWeight: 950, fontSize: 48, letterSpacing: -1, color: "rgba(255,255,255,0.92)" }}>
                {gradeFromScore(bundle.derived.score)}
              </Typography>
            </Box>

            <Typography sx={{ fontWeight: 950, textAlign: "center" }}>
              Your grade (instant)
            </Typography>
            <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.70)", textAlign: "center" }}>
              Tap “Get My Grade” for the coach version.
            </Typography>

            <Button
              onClick={handleGenerateAiVerdict}
              variant="contained"
              disabled={aiLoading}
              sx={{ borderRadius: 999, fontWeight: 950, px: 3.2, py: 1.1 }}
            >
              {aiLoading ? "Grading…" : "Get My Grade"}
            </Button>

            {aiLoading && <LinearProgress sx={{ width: "100%", borderRadius: 999 }} />}

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
                <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.78)", whiteSpace: "pre-wrap" }}>
                  {aiVerdict}
                </Typography>
              </Box>
            )}

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
              Viral hook: “What’s your grade today?”
            </Typography>

            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.45)", textAlign: "center" }}>
              Remaining AI today: {Math.max(0, remainingAi)} / {limitAi}
            </Typography>
          </Stack>
        </CardShell>
      </Box>

      <Typography variant="caption" sx={{ display: "block", mt: 1, color: "rgba(255,255,255,0.55)" }}>
        Tip: swipe/scroll → it should feel quick, not like a spreadsheet.
      </Typography>

      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
    </Box>
  );
}
