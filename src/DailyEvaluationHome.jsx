// src/DailyEvaluationHome.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import IosShareIcon from "@mui/icons-material/IosShare";

import UpgradeModal from "./components/UpgradeModal";
import FeatureUseBadge, {
  canUseDailyFeature,
  registerDailyFeatureUse,
  getDailyRemaining,
  getFreeDailyLimit,
} from "./components/FeatureUseBadge.jsx";
import { useEntitlements } from "./context/EntitlementsContext.jsx";
import { useAuth } from "./context/AuthProvider.jsx";
import { supabase } from "./lib/supabaseClient.js";
import { buildDailyChecklistItems, buildChecklistWindows, buildChecklistSummary, pickDefaultWindowIndex, buildMicroQuestSummary } from "./lib/dailyChecklist.js";

/**
 * DailyEvaluationHome — Win-first + Action Steps v3
 * - Card 1: Scoreboard rings (no press/hold breakdown UX; rings already communicate)
 * - Card 2: Checklist + "Next 5 steps" panel (button no longer navigates)
 * - Card 3: Coach-only panel (curiosity CTA + helper text). No "Your numbers" block.
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

function isoDayInTZ(d = new Date(), tz = "America/Los_Angeles") {
  try {
    const dt = new Date(d);
    // en-CA yields YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(dt);
  } catch {
    return isoDay(d);
  }
}

function usDayInTZ(d = new Date(), tz = "America/Los_Angeles") {
  try {
    const dt = new Date(d);
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).format(dt);
  } catch {
    return usDay(d);
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
      acc.protein_g += Number(m?.protein_g ?? m?.macros?.protein_g ?? m?.macros?.protein ?? m?.macros?.p ?? 0) || 0;
      acc.carbs_g += Number(m?.carbs_g ?? m?.macros?.carbs_g ?? m?.macros?.carbs ?? m?.macros?.c ?? 0) || 0;
      acc.fat_g += Number(m?.fat_g ?? m?.macros?.fat_g ?? m?.macros?.fat ?? m?.macros?.f ?? 0) || 0;
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
  if (!profileComplete) return { state: "notyet", reason: "Set targets (30 sec) to personalize your win." };
  if (!hasLogs) return { state: "notyet", reason: "Log at least 1 meal or a workout." };
  if (confidenceLabel === "Low") return { state: "notyet", reason: "Log a bit more so it’s accurate." };
  if (score >= 74) return { state: "win", reason: "Solid day. Repeat this." };
  return { state: "notyet", reason: "Close. Do one more step to win." };
}

// ----------------------------- UI primitives ---------------------------------
function CardShell({ title, subtitle, children, right }) {
  return (
    <Card
      elevation={0}
      sx={{
        // Mobile-first: make each card feel like a full-screen page inside a swipeable carousel.
        // We subtract horizontal padding (16px * 2) so the card is perfectly centered and never overflows.
        minWidth: { xs: "calc(100vw - 32px)", sm: 360 },
        maxWidth: { xs: "calc(100vw - 32px)", sm: 440 },
        height: { xs: "100%", sm: "auto" },
        scrollSnapAlign: "start",
        borderRadius: 3,
        border: "1px solid rgba(148,163,184,0.18)",
        background: "linear-gradient(180deg, rgba(15,23,42,0.98) 0%, rgba(2,6,23,0.98) 100%)",
        color: "rgba(255,255,255,0.92)",
      }}
    >
      <CardContent
        sx={{
          p: 2,
          height: { xs: "100%", sm: "auto" },
          display: { xs: "flex", sm: "block" },
          flexDirection: { xs: "column", sm: "initial" },
          minHeight: 0,
        }}
      >
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
        {/* Mobile: allow the inside of the card to scroll without breaking the full-screen layout. */}
        <Box
          sx={{
            flex: { xs: 1, sm: "unset" },
            minHeight: 0,
            overflowY: { xs: "auto", sm: "visible" },
            WebkitOverflowScrolling: "touch",
          }}
        >
          {children}
        </Box>
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

function getHourInTimeZone(dateLike, timeZone) {
  try {
    const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
    const hourStr = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone }).format(d);
    const h = parseInt(hourStr, 10);
    return Number.isFinite(h) ? h : d.getHours();
  } catch {
    const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
    return d.getHours();
  }
}

function getMealLoggedHourPST(meal) {
  if (!meal || typeof meal !== "object") return null;
  const ts =
    meal.eaten_at ||
    meal.eatenAt ||
    meal.logged_at ||
    meal.loggedAt ||
    meal.created_at ||
    meal.createdAt ||
    meal.time ||
    meal.timestamp ||
    meal.ts ||
    null;
  if (!ts) return null;
  const h = getHourInTimeZone(ts, "America/Los_Angeles");
  return Number.isFinite(h) ? h : null;
}

function getMealTsMs(meal) {
  const ts =
    meal?.eaten_at ||
    meal?.eatenAt ||
    meal?.createdAt ||
    meal?.created_at ||
    meal?.loggedAt ||
    meal?.time ||
    meal?.timestamp ||
    meal?.ts ||
    null;
  if (!ts) return null;
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function getMealText(meal) {
  const t = meal?.title || meal?.name || meal?.label || "";
  return typeof t === "string" ? t : String(t || "");
}

function isBreakfastLikeText(t) {
  if (!t) return false;
  const s = String(t).toLowerCase();
  // lightweight keywords; time-of-day still dominates
  return /(egg|eggs|oat|oats|oatmeal|cereal|yogurt|toast|bagel|pancake|waffle|bacon|sausage|coffee|banana|berries|granola|protein shake|shake)/.test(s);
}

function groupMealsIntoEventsPST(mealsArr) {
  const MIN_GAP_MS = 45 * 60 * 1000; // 45 minutes = one "meal event"
  const rows = (Array.isArray(mealsArr) ? mealsArr : [])
    .map((m) => ({ ms: getMealTsMs(m), text: getMealText(m) }))
    .filter((r) => Number.isFinite(r.ms))
    .sort((a, b) => a.ms - b.ms);

  const events = [];
  for (const r of rows) {
    const last = events[events.length - 1];
    if (last && r.ms - last.ms <= MIN_GAP_MS) {
      last.texts.push(r.text);
      last.msEnd = r.ms;
    } else {
      events.push({ msStart: r.ms, msEnd: r.ms, texts: [r.text] });
    }
  }

  return events.map((e) => {
    const hourPST = getHourInTimeZone(new Date(e.msStart), "America/Los_Angeles");
    return {
      hourPST: Number.isFinite(hourPST) ? hourPST : null,
      text: e.texts.filter(Boolean).join(" "),
      msStart: e.msStart,
      msEnd: e.msEnd,
    };
  });
}

function bucketMealWindowPST(hour) {
  if (hour == null) return null;
  // breakfast: 4-10, lunch: 11-15, dinner: 16-21, late: 22-3
  if (hour >= 4 && hour <= 10) return "breakfast";
  if (hour >= 11 && hour <= 15) return "lunch";
  if (hour >= 16 && hour <= 21) return "dinner";
  return "late";
}

function getMealStep({ nowHourPST, mealBuckets }) {
  const hasBreakfast = !!mealBuckets?.breakfast;
  const hasLunch = !!mealBuckets?.lunch;
  const hasDinner = !!mealBuckets?.dinner;

  // If we can infer meal timing, prefer accuracy over simple counts.
  if (!hasBreakfast && nowHourPST < 11) return { step: "breakfast", title: "Log breakfast" };
  if (!hasBreakfast) return { step: "first", title: "Log your first meal" };

  if (!hasLunch && nowHourPST < 16) return { step: "lunch", title: "Log lunch" };
  if (!hasLunch) return { step: "next", title: "Log your next meal" };

  if (!hasDinner && nowHourPST >= 16) return { step: "dinner", title: "Log dinner" };
  if (!hasDinner) return { step: "next", title: "Log your next meal" };

  return { step: "snack", title: "Log a snack (optional)" };
}

function buildChecklist({
  goalType,
  profileComplete,
  mealsCount,
  mealBuckets,
  nowHourPST,
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
  const hour = Number.isFinite(nowHourPST) ? nowHourPST : getHourInTimeZone(new Date(), "America/Los_Angeles");

  const items = [];
  const push = (it) => items.push(it);

  // Morning
  push({
    key: "setup",
    window: "morning",
    title: "Set targets (30 sec)",
    subtitle: "Rings + coach stay accurate",
    done: !!profileComplete,
    action: "/workout",
    priority: 0,
    hiddenWhenDone: true,
    manual: false,
  });

  // Manual hydration checkbox (morning routine)
  push({
    key: "rehydrate",
    window: "morning",
    title: "Hydrate",
    subtitle: hour < 12 ? "Water + electrolytes" : "Water (quick reset)",
    done: !!dayHydrationDone,
    action: null,
    priority: 1,
    hiddenWhenDone: false,
    manual: true,
  });

  // Meals as chronological checkpoints (time-aware in Pacific time)
  const hasB = mealBuckets?.breakfast === true;
  const hasL = mealBuckets?.lunch === true;
  const hasD = mealBuckets?.dinner === true;

  push({
    key: "meal_morning",
    window: "morning",
    title: "Log breakfast (2 min)",
    subtitle: goalType === "bulk" ? "Protein + carbs (yogurt + oats)" : "Protein-first (25–35g)",
    done: hasB || ((Number(mealsCount) || 0) >= 1 && hour <= 10),
    action: "/meals",
    priority: 2,
    hiddenWhenDone: false,
    manual: false,
  });

  push({
    key: "meal_afternoon",
    window: "afternoon",
    title: "Log lunch (2 min)",
    subtitle: goalType === "bulk" ? "Protein + carbs (chicken + rice)" : "Protein + fiber (chicken + salad)",
    done: hasL || ((Number(mealsCount) || 0) >= 2 && hour >= 11 && hour <= 15),
    action: "/meals",
    priority: 3,
    hiddenWhenDone: false,
    manual: false,
  });

  push({
    key: "meal_night",
    window: "night",
    title: "Log dinner",
    subtitle: "Close the day (protein-focused)",
    done: hasD || ((Number(mealsCount) || 0) >= 3 && hour >= 16),
    action: "/meals",
    priority: 4,
    hiddenWhenDone: false,
    manual: false,
  });
// Protein checkpoint (afternoon) + finish target (night)
  const pT = Number(proteinTarget) || 0;
  const pNow = Number(proteinG) || 0;
  if (pT > 0) {
    const half = Math.round(pT * 0.5);
    const needHalf = Math.max(0, half - pNow);
    push({
      key: "protein_half",
      window: "afternoon",
      title: pNow >= half ? "Protein checkpoint" : "Hit protein checkpoint",
      subtitle: pNow >= half ? "Nice — keep going" : `Get to ~${half}g (add ~${Math.round(Math.min(45, needHalf))}g)`,
      done: pNow >= half,
      action: "/meals",
      priority: 5,
      hiddenWhenDone: false,
      manual: false,
    });

    const pGap = Math.max(0, pT - pNow);
    push({
      key: "protein_full",
      window: "night",
      title: pGap > 0 ? "Hit protein target" : "Protein target hit",
      subtitle: pGap > 0 ? `Add ~${Math.round(Math.min(60, pGap))}g protein` : "Done ✅",
      done: pGap <= 0,
      action: "/meals",
      priority: 6,
      hiddenWhenDone: false,
      manual: false,
    });
  }

  // Goal-aware fuel / movement steps
  if (g === "bulk") {
    const cT = Number(carbsTarget) || 0;
    const cNow = Number(carbsG) || 0;
    if (cT > 0) {
      const cGap = Math.max(0, cT - cNow);
      push({
        key: "fuel",
        window: "night",
        title: cGap > 0 ? "Fuel training (carbs)" : "Carbs on track",
        subtitle: cGap > 0 ? `Add ~${Math.round(Math.min(110, cGap))}g carbs` : "Nice",
        done: cGap <= 0,
        action: "/meals",
        priority: 7,
        hiddenWhenDone: false,
        manual: false,
      });
    }
  } else if (g === "cut") {
    push({
      key: "walk",
      window: "afternoon",
      title: "10‑min walk",
      subtitle: "Easy deficit win",
      done: !!hasWorkout,
      action: "/workout",
      priority: 7,
      hiddenWhenDone: false,
      manual: false,
    });
  } else {
    push({
      key: "move",
      window: "afternoon",
      title: "Move 10 minutes",
      subtitle: "Keeps your day clean",
      done: !!hasWorkout,
      action: "/workout",
      priority: 7,
      hiddenWhenDone: false,
      manual: false,
    });
  }

  // Workout (best in afternoon/evening)
  push({
    key: "workout",
    window: hour < 15 ? "afternoon" : "night",
    title: hasWorkout ? "Workout logged" : "Log workout (2 min)",
    subtitle: hasWorkout ? "Exercise counted ✅" : "Even 1 exercise — log it",
    done: !!hasWorkout,
    action: "/workout",
    priority: 8,
    hiddenWhenDone: false,
    manual: false,
  });

  return items
    .filter((it) => !(it.hiddenWhenDone && it.done))
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 18);
}

// ----------------------------- main ------------------------------------------

function SparkBurst({ tick = 0 }) {
  const parts = [
    { dx: 0, dy: -18 },
    { dx: 13, dy: -13 },
    { dx: 18, dy: 0 },
    { dx: 13, dy: 13 },
    { dx: 0, dy: 18 },
    { dx: -13, dy: 13 },
    { dx: -18, dy: 0 },
    { dx: -13, dy: -13 },
  ];
  return (
    <Box
      key={tick}
      sx={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        pointerEvents: "none",
        zIndex: 6,
        "@keyframes slimcalParticle": {
          "0%": { transform: "translate(0px,0px) scale(1)", opacity: 0.0 },
          "10%": { opacity: 1.0 },
          "85%": { opacity: 0.0 },
          "100%": { transform: "translate(var(--dx), var(--dy)) scale(0.15)", opacity: 0.0 },
        },
        "@keyframes slimcalRing": {
          "0%": { transform: "scale(0.7)", opacity: 0.0 },
          "30%": { opacity: 0.9 },
          "100%": { transform: "scale(1.25)", opacity: 0.0 },
        },
      }}
    >
      {parts.map((p, i) => (
        <Box
          key={i}
          component="span"
          sx={{
            position: "absolute",
            width: 6,
            height: 6,
            borderRadius: 999,
            bgcolor: "rgba(120,180,255,0.95)",
            boxShadow: "0 0 14px rgba(120,180,255,0.55)",
            "--dx": `${p.dx}px`,
            "--dy": `${p.dy}px`,
            animation: "slimcalParticle 520ms ease-out forwards",
          }}
        />
      ))}
      <Box
        component="span"
        sx={{
          position: "absolute",
          width: 18,
          height: 18,
          borderRadius: 999,
          border: "2px solid rgba(120,180,255,0.55)",
          animation: "slimcalRing 520ms ease-out forwards",
        }}
      />
    </Box>
  );
}

export default function DailyEvaluationHome() {
  const history = useHistory();
  const { isProActive } = useEntitlements();
  const pro = !!isProActive || localStorage.getItem("isPro") === "true";

  const { user } = useAuth();
  const userId = user?.id || null;

const [dataTick, setDataTick] = useState(0);

// Recompute derived Daily Eval data when meals/workouts update (local-first + cross-device hydrations)
useEffect(() => {
  const bump = () => setDataTick((t) => t + 1);

  window.addEventListener("storage", bump);
  window.addEventListener("slimcal:consumed:update", bump);
  window.addEventListener("slimcal:burned:update", bump);
  window.addEventListener("slimcal:workoutHistory:update", bump);

  return () => {
    window.removeEventListener("storage", bump);
    window.removeEventListener("slimcal:consumed:update", bump);
    window.removeEventListener("slimcal:burned:update", bump);
    window.removeEventListener("slimcal:workoutHistory:update", bump);
  };
}, []);

  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // AI verdict state (gating unchanged)
  const [aiLoading, setAiLoading] = useState(false);
  const [aiVerdict, setAiVerdict] = useState("");
  const [aiError, setAiError] = useState("");

  // per-device per-day cache for AI verdict text
  const dayISOForRecap = isoDay();
  const recapCacheKey = userId ? `dailyEvalRecap:${userId}:${dayISOForRecap}` : null;

  useEffect(() => {
    if (!recapCacheKey) return;
    try {
      const cached = localStorage.getItem(recapCacheKey);
      if (cached && !String(aiVerdict || "").trim()) {
        setAiVerdict(cached);
      }
    } catch {
      // ignore cache errors
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recapCacheKey]);

// Ensure Daily Eval has TODAY meals/workouts on this device (read-only cloud pull → local merge).
// This makes DailyEval look consistent across devices without changing the write/sync pipeline.
const hydrateRef = useRef({ lastMs: 0, inflight: false });

async function hydrateTodayFromCloudIfNeeded(trigger = "mount") {
  if (!userId || !supabase) return;
  const tz = "America/Los_Angeles";
  const now = new Date();
  const dayISO = isoDayInTZ(now, tz);
  const dayUS = usDayInTZ(now, tz);

  const ref = hydrateRef.current;
  const nowMs = Date.now();
  // Cooldown to avoid spam (focus, mount, etc.)
  if (ref.inflight) return;
  if (nowMs - (ref.lastMs || 0) < 20_000) return; // 20s

  ref.inflight = true;
  try {
    const uid = userId;
    const mealKey = uid ? `mealHistory:${uid}` : "mealHistory";
    const workoutKey = uid ? `workoutHistory:${uid}` : "workoutHistory";

    const lookbackIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    // ---------------- meals ----------------
    try {
      const mealsRes = await supabase
        .from("meals")
        .select("client_id,title,total_calories,eaten_at,protein_g,carbs_g,fat_g,food_id,portion_id,portion_label,qty,unit")
        .eq("user_id", uid)
        .gte("eaten_at", lookbackIso)
        .order("eaten_at", { ascending: true })
        .limit(500);

      const cloudRaw = Array.isArray(mealsRes?.data) ? mealsRes.data : [];
      const cloudToday = cloudRaw.filter((m) => {
        const dt = new Date(m?.eaten_at || "");
        if (Number.isNaN(dt.getTime())) return false;
        return isoDayInTZ(dt, tz) === dayISO;
      });

      const cloudMeals = cloudToday.map((m) => {
        const cid =
          m?.client_id ||
          `cloud_${String(m?.eaten_at || "")}_${String(m?.title || "")}_${String(m?.total_calories || "")}`;
        return {
          client_id: cid,
          name: m?.title || "Meal",
          calories: Number(m?.total_calories) || 0,

          // ✅ pull macros/meta so mobile rings don't show 0 when meals exist
          protein_g: Number(m?.protein_g) || 0,
          carbs_g: Number(m?.carbs_g) || 0,
          fat_g: Number(m?.fat_g) || 0,

          food_id: m?.food_id ?? null,
          portion_id: m?.portion_id ?? null,
          portion_label: m?.portion_label ?? null,
          qty: m?.qty ?? 1,
          unit: m?.unit ?? "serving",

          createdAt: m?.eaten_at || new Date().toISOString(),
        };
      });

      if (cloudMeals.length > 0) {
        const localHist = safeJsonParse(localStorage.getItem(mealKey), []);
        const hist = Array.isArray(localHist) ? localHist : [];
        const existingToday = hist.find((d) => d?.date === dayUS) || null;
        const existingMeals = Array.isArray(existingToday?.meals) ? existingToday.meals : [];

        const mergedMap = new Map();
        for (const lm of existingMeals) {
          const cid =
            lm?.client_id ||
            `local_${String(lm?.name || "")}_${String(lm?.createdAt || "")}_${String(lm?.calories || 0)}`;
          mergedMap.set(cid, { ...lm, client_id: cid });
        }
        for (const cm of cloudMeals) {
          if (!mergedMap.has(cm.client_id)) mergedMap.set(cm.client_id, cm);
        }

        const merged = Array.from(mergedMap.values()).sort((a, b) => {
          const ta = new Date(a?.createdAt || 0).getTime();
          const tb = new Date(b?.createdAt || 0).getTime();
          return ta - tb;
        });

        const rest = hist.filter((d) => d?.date !== dayUS);
        rest.push({ date: dayUS, meals: merged });

        localStorage.setItem(mealKey, JSON.stringify(rest));
      }
    } catch (e) {
      // ignore cloud pull issues on DailyEval
    }

    // ---------------- workouts ----------------
    try {
      let rows = [];
      let wError = null;

      // Prefer local_day equality (same as WorkoutPage)
      const wRes = await supabase
        .from("workouts")
        .select("id,client_id,total_calories,started_at,ended_at,created_at,local_day,items")
        .eq("user_id", uid)
        .eq("local_day", dayISO)
        .order("started_at", { ascending: false });

      if (wRes?.error) {
        wError = wRes.error;
      } else {
        rows = Array.isArray(wRes?.data) ? wRes.data : [];
      }

      // Fallback: started_at lookback filter if local_day isn't available
      if (wError && /column .*local_day.* does not exist/i.test(String(wError?.message || ""))) {
        const wRes2 = await supabase
          .from("workouts")
          .select("id,client_id,total_calories,started_at,ended_at,created_at,items")
          .eq("user_id", uid)
          .gte("started_at", lookbackIso)
          .order("started_at", { ascending: false });

        const raw2 = Array.isArray(wRes2?.data) ? wRes2.data : [];
        rows = raw2.filter((w) => {
          const dt = new Date(w?.started_at || w?.created_at || "");
          if (Number.isNaN(dt.getTime())) return false;
          return isoDayInTZ(dt, tz) === dayISO;
        });
      }

      if (rows.length > 0) {
        const localHist = safeJsonParse(localStorage.getItem(workoutKey), []);
        const hist = Array.isArray(localHist) ? localHist : [];

        const mergedMap = new Map();
        for (const lw of hist) {
          const cid = lw?.client_id || lw?.id || `local_${String(lw?.createdAt || "")}`;
          mergedMap.set(cid, lw);
        }

        for (const w of rows) {
          const cid = w?.client_id || w?.id || `cloud_${String(w?.started_at || w?.created_at || "")}`;
          if (!mergedMap.has(cid)) {
            const total = Number(w?.total_calories) || 0;
            const started = w?.started_at || w?.created_at || new Date().toISOString();
            mergedMap.set(cid, {
              id: cid,
              client_id: cid,
              date: dayUS,
              __local_day: w?.local_day || dayISO,
              started_at: started,
              ended_at: w?.ended_at || null,
              createdAt: started,
              totalCalories: total,
              total_calories: total,
              name: (Array.isArray(w?.items) && w.items?.[0]?.name) || "Workout",
              exercises: Array.isArray(w?.items) ? w.items : [],
            });
          }
        }

        const merged = Array.from(mergedMap.values());
        localStorage.setItem(workoutKey, JSON.stringify(merged));
      }
    } catch (e) {
      // ignore cloud pull issues on DailyEval
    }

    // Recompute derived data on this device
    setDataTick((t) => t + 1);
    ref.lastMs = Date.now();
  } finally {
    hydrateRef.current.inflight = false;
  }
}

useEffect(() => {
  hydrateTodayFromCloudIfNeeded("mount");
  const onFocus = () => hydrateTodayFromCloudIfNeeded("focus");
  const onVis = () => {
    if (document.visibilityState === "visible") hydrateTodayFromCloudIfNeeded("visible");
  };

  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVis);

  return () => {
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVis);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [userId]);

  // score badge animation
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
    const mealsArr = Array.isArray(dayMealsRec?.meals) ? dayMealsRec.meals : [];
    const mealEvents = groupMealsIntoEventsPST(mealsArr);
    const mealHoursPST = mealEvents.map((e) => e.hourPST).filter((h) => typeof h === "number");

    // Count meals by time window (PST) so we can do smarter inference.
    const bucketCounts = mealHoursPST.reduce(
      (acc, h) => {
        const b = bucketMealWindowPST(h);
        if (b) acc[b] = (acc[b] || 0) + 1;
        return acc;
      },
      { breakfast: 0, lunch: 0, dinner: 0, late: 0 }
    );

    const nowHourPST = getHourInTimeZone(new Date(), "America/Los_Angeles");

    // UX rule: If it's past breakfast time (>= 12pm) and the user logged *a* meal but none were in the breakfast window,
    // treat their first logged meal as "breakfast" so the checklist stays intuitive.
    if (nowHourPST >= 12 && nowHourPST < 16 && bucketCounts.breakfast === 0 && mealEvents.length > 0) {
      const firstEvt = mealEvents[0];
      const firstHour = Number(firstEvt?.hourPST);
      const firstLooksBreakfast = isBreakfastLikeText(firstEvt?.text);
      // Only apply the "first meal counts as breakfast" UX rule when it's plausibly breakfast/early-day.
      if (firstLooksBreakfast || (Number.isFinite(firstHour) && firstHour <= 15)) {
      if (bucketCounts.lunch > 0) bucketCounts.lunch -= 1;
      else if (bucketCounts.dinner > 0) bucketCounts.dinner -= 1;
      else if (bucketCounts.late > 0) bucketCounts.late -= 1;
      bucketCounts.breakfast = 1;
      }
    }

    const mealBuckets = {
      breakfast: bucketCounts.breakfast > 0,
      lunch: bucketCounts.lunch > 0,
      dinner: bucketCounts.dinner > 0,
      late: bucketCounts.late > 0,
    };

    

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
      totals: { consumed: consumedFinal, burned: burnedFinal, netKcal, macros, mealsCount, mealsArr },
      est: { bmr_est: bmrEst || 0, tdee_est: tdeeEst || 0 },
      derived: {
        profileComplete,
        hasMeals,
        hasWorkout,
        hasLogs,
        confidenceLabel,
        score,
        components,
        mealBuckets,
        nowHourPST,
      },
    };
  }, [userId, dataTick]);

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
    const dur = 650;
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
      return { label: "NEEDS MORE LOGS", tone: "warning" };
    }
    if (bundle.targets.proteinTarget && proteinGap >= 25) {
      return { label: "PROTEIN LOW", tone: "error" };
    }
    if (bundle.targets.calorieTarget && calErr > 450) {
      return { label: "CALORIES OFF", tone: "warning" };
    }
    return { label: "ON TRACK", tone: "success" };
  }, [bundle.derived.profileComplete, bundle.derived.hasMeals, bundle.targets.proteinTarget, proteinGap, bundle.targets.calorieTarget, calErr]);

  const fixTags = useMemo(() => {
    const tags = [];
    const hour = getHourInTimeZone(new Date(), "America/Los_Angeles");
    const mealsCount = Number(bundle?.totals?.mealsCount) || 0;
    const hasWorkout = !!bundle?.derived?.hasWorkout;

    // Setup + hydration
    if (!bundle?.derived?.profileComplete) tags.push({ label: "SETUP", tone: "warning" });
    if (!hydrationDone) tags.push({ label: "HYDRATION", tone: "info" });

    // Meal windows (PST)
    if (hour >= 16 && !(bundle?.derived?.mealBuckets?.dinner)) tags.push({ label: "DINNER NEEDED", tone: "primary" });
    if (mealsCount < 3 && hour >= 14) tags.push({ label: "MEALS LOW", tone: "primary" });

    // Macros (avoid duplicating the main flag)
    const pT = Number(bundle?.targets?.proteinTarget) || 0;
    const pNow = Number(bundle?.totals?.macros?.protein_g) || 0;
    if (flag?.label !== "PROTEIN LOW" && pT > 0 && (pT - pNow) >= 25) {
      tags.push({ label: "PROTEIN LOW", tone: "error" });
    }

    const cT = Number(bundle?.targets?.carbTarget) || 0;
    const cNow = Number(bundle?.totals?.macros?.carb_g) || 0;
    if (cT > 0 && cNow / Math.max(1, cT) < 0.45) tags.push({ label: "CARBS LOW", tone: "warning" });

    // Burn status (context)
    const burned = Number(bundle?.totals?.burned) || 0;
    if (hasWorkout) {
      if (burned < 150 && hour >= 15) tags.push({ label: "BURN LOW", tone: "warning" });
      else if (burned < 350) tags.push({ label: "BURN MODERATE", tone: "info" });
      else tags.push({ label: "BURN HIGH", tone: "success" });
    } else if (hour >= 13) {
      tags.push({ label: "WORKOUT NEEDED", tone: "info" });
    }

    // Keep it clean: show up to 3 extra tags (main flag already covers one key issue)
    return tags.slice(0, 3);
  }, [bundle, hydrationDone, flag]);

  // checklist (uses manual hydrationDone)
  const checklist = useMemo(() => {
    return buildChecklist({
      goalType: bundle.targets.goalType,
      profileComplete: bundle.derived.profileComplete,
      mealsCount: bundle.totals.mealsCount,
      mealBuckets: bundle.derived.mealBuckets,
      nowHourPST: bundle.derived.nowHourPST,
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

  const remainingSteps = useMemo(() => checklist.filter((i) => !i.done), [checklist]);

  // Shared summaries used across Card 2 + Recap + Frame Check preview
  const checklistSummaryTop = useMemo(() => {
    return buildChecklistSummary(checklist, bundle?.derived?.nowHourPST);
  }, [checklist, bundle?.derived?.nowHourPST]);

  const microQuestSummary = useMemo(() => {
    return buildMicroQuestSummary({ items: checklist, nowHourPST: bundle?.derived?.nowHourPST });
  }, [checklist, bundle?.derived?.nowHourPST]);

  // Card 2: quests (time-windowed, paged)
  // We show 5 items per page to keep it uncluttered, but allow a fuller day plan.
  const [questPage, setQuestPage] = useState(0);

// --- Celebration (Duolingo-style pop) when items become DONE ---
const [burstTicks, setBurstTicks] = useState({});
const [toast, setToast] = useState(null);
const toastTimerRef = useRef(null);
const prevDoneRef = useRef({}); // key -> boolean

const triggerCelebrate = useCallback((key, msg) => {
  setBurstTicks((prev) => ({ ...prev, [key]: (prev[key] || 0) + 1 }));
  if (msg) {
    setToast({ msg, id: Date.now() });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 900);
  }
}, []);

useEffect(() => {
  return () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  };
}, []);

useEffect(() => {
  // When checklist updates, celebrate newly completed items
  const prev = prevDoneRef.current || {};
  const now = {};
  (Array.isArray(checklist) ? checklist : []).forEach((it) => {
    now[it.key] = !!it.done;
    if (!!it.done && !prev[it.key]) {
      const msg = it.key === "rehydrate" ? "💧 Hydration!" : "✅ Nice!";
      triggerCelebrate(it.key, msg);
    }
  });
  prevDoneRef.current = now;
}, [checklist, triggerCelebrate]); // slimcalChecklistCelebrate

  const touchStartXRef = useRef(null);
  const touchDeltaXRef = useRef(0);

  const onQuestTouchStart = (e) => {
    const x = e?.touches?.[0]?.clientX;
    touchStartXRef.current = typeof x === "number" ? x : null;
    touchDeltaXRef.current = 0;
  };

  const onQuestTouchMove = (e) => {
    const startX = touchStartXRef.current;
    const x = e?.touches?.[0]?.clientX;
    if (typeof startX === "number" && typeof x === "number") {
      touchDeltaXRef.current = x - startX;
    }
  };

  const onQuestTouchEnd = () => {
    const dx = touchDeltaXRef.current || 0;
    const THRESH = 55;
    if (dx > THRESH && canPrevQuest) setQuestPage((p) => Math.max(0, p - 1));
    else if (dx < -THRESH && canNextQuest) setQuestPage((p) => Math.min(2, p + 1));
    touchStartXRef.current = null;
    touchDeltaXRef.current = 0;
  };

  const questWindows = useMemo(() => {
    const src = Array.isArray(checklist) ? checklist : [];
    const buckets = { morning: [], afternoon: [], night: [] };
    for (const it of src) {
      const w = it?.window;
      if (w === 'morning' || w === 'afternoon' || w === 'night') buckets[w].push(it);
      else buckets.afternoon.push(it);
    }
    return buckets;
  }, [checklist]);

    // Window-based paging: Morning / Afternoon / Night (separate pages)
  const QUEST_WINDOWS = useMemo(() => ["morning", "afternoon", "night"], []);

  const questMaxPages = QUEST_WINDOWS.length;

  // Default to the most relevant window for the current time (PST)
  useEffect(() => {
    const idx = pickDefaultWindowIndex(bundle?.derived?.nowHourPST);
    setQuestPage((p) => {
      // only auto-set on first mount / if still at 0 and it's not morning
      if (p === 0 && idx !== 0) return idx;
      return p;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clamp page
  useEffect(() => {
    setQuestPage((p) => Math.min(Math.max(0, p), questMaxPages - 1));
  }, [questMaxPages]);

  const questWindowKey = QUEST_WINDOWS[Math.max(0, Math.min(questPage, questMaxPages - 1))] || "morning";

  const questWindowSlices = useMemo(() => {
    // For the active page, show ALL items for that window (keeps it simple + user-friendly).
    // Still uses the same underlying checklist (no data changes).
    const out = { morning: [], afternoon: [], night: [] };
    for (const w of QUEST_WINDOWS) out[w] = questWindows[w] || [];
    return out;
  }, [questWindows, QUEST_WINDOWS]);

  const canPrevQuest = questPage > 0;
  const canNextQuest = questPage < (questMaxPages - 1);
const nextStep = useMemo(() => remainingSteps[0] || null, [remainingSteps]);

// AI gating
  const remainingAi = getDailyRemaining("daily_eval_verdict");
  const limitAi = getFreeDailyLimit("daily_eval_verdict");

  const openUpgrade = () => setUpgradeOpen(true);

  const handleGenerateAiVerdict = async () => {
    setAiError("");
    // keep cached verdict visible while generating a new one

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

            const dietPreference = (bundle.profile?.dietPreference || localStorage.getItem("diet_preference") || "omnivore");
      const trainingIntent = (bundle.profile?.trainingIntent || localStorage.getItem("training_intent") || "general");
      const trainingSplit = (bundle.profile?.trainingSplit || localStorage.getItem("training_split") || "");
      const lastFocus = (bundle.profile?.lastFocus || localStorage.getItem("last_focus") || "");
      const equipmentList = bundle.profile?.equipment || safeJsonParse(localStorage.getItem("equipment_list"), []);
      const calorieBias = Number(bundle.profile?.calorieBias || localStorage.getItem("calorie_bias") || 0) || 0;

      const calorieTargetSafe = Number(bundle.targets.calorieTarget) || 0;
      const calDelta = calorieTargetSafe ? (bundle.totals.consumed - calorieTargetSafe) : 0;
      const calorieRemaining = calorieTargetSafe ? Math.max(0, calorieTargetSafe - bundle.totals.consumed) : 0;

      const proteinRemaining = Math.max(0, (Number(bundle.targets.proteinTarget) || 0) - (Number(bundle.totals.macros.protein_g) || 0));
      const carbsRemaining = Math.max(0, (Number(bundle.targets.carbsTarget) || 0) - (Number(bundle.totals.macros.carbs_g) || 0));
      const fatRemaining = Math.max(0, (Number(bundle.targets.fatTarget) || 0) - (Number(bundle.totals.macros.fat_g) || 0));

      const checklistSummary = buildChecklistSummary(checklist, bundle?.derived?.nowHourPST);

      const formatPST = (ts) => {
        try {
          const d = ts ? new Date(ts) : null;
          if (!d || !Number.isFinite(d.getTime())) return "";
          return new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Los_Angeles",
            hour: "numeric",
            minute: "2-digit",
          }).format(d);
        } catch {
          return "";
        }
      };

      const mealsCompact = (Array.isArray(bundle?.totals?.mealsArr) ? bundle.totals.mealsArr : [])
        .slice()
        .sort((a, b) => {
          const ta = new Date(a?.eaten_at || a?.eatenAt || a?.created_at || a?.createdAt || 0).getTime();
          const tb = new Date(b?.eaten_at || b?.eatenAt || b?.created_at || b?.createdAt || 0).getTime();
          return (ta || 0) - (tb || 0);
        })
        .slice(0, 8)
        .map((m) => ({
          time: formatPST(m?.eaten_at || m?.eatenAt || m?.created_at || m?.createdAt || null),
          title: String(m?.title || m?.name || "Meal").slice(0, 80),
          calories: Math.round(Number(m?.total_calories || m?.totalCalories || m?.calories || 0) || 0),
          p: Math.round(Number(m?.protein_g || m?.proteinG || m?.protein || 0) || 0),
          c: Math.round(Number(m?.carbs_g || m?.carbsG || m?.carbs || 0) || 0),
          f: Math.round(Number(m?.fat_g || m?.fatG || m?.fat || 0) || 0),
        }));

      // Today's workouts (scoped local history)
      const uid = userId || bundle?.profile?.id || bundle?.profile?.user_id || null;
      const workoutKey = uid ? `workoutHistory:${uid}` : "workoutHistory";
      const workoutHistoryRaw = safeJsonParse(localStorage.getItem(workoutKey), []);
      const dayUS = bundle.dayUS;

      const workoutsToday = (Array.isArray(workoutHistoryRaw) ? workoutHistoryRaw : [])
        .filter((w) => (w?.date || w?.day || "") === dayUS)
        .slice(0, 4)
        .map((w) => {
          const ex = Array.isArray(w?.exercises) ? w.exercises : Array.isArray(w?.items) ? w.items : [];
          const exNames = ex.map((e) => e?.name).filter(Boolean).slice(0, 6);
          return {
            time: formatPST(w?.started_at || w?.createdAt || w?.created_at || null),
            name: String(w?.name || "Workout").slice(0, 70),
            calories: Math.round(Number(w?.totalCalories || w?.total_calories || 0) || 0),
            exercises: exNames,
          };
        });

      const payload = {
        feature: "daily_eval_verdict",
        prompt: `
You are SlimCal Coach — the daily BRAIN of the app.
Generate a highly detailed, personalized "Daily Verdict" that makes the user feel understood.

OUTPUT FORMAT (plain text, easy to skim):
1) Status line (WIN / CLOSE / NEEDS LOGS) + 1 sentence why.
2) Numbers snapshot (bullets): Consumed, Burned, Net, Calories vs Target (delta), Protein/Carbs/Fat vs targets.
3) Checklist status: completion %, active window, and the next 3 missing micro-quests.
4) Insights (2–5 bullets): the biggest levers today based on goal type + what they logged.
5) Next actions (very specific):
   - Next meal: tailored to dietPreference + macro gaps + calories remaining (give 2 options).
   - Next training/movement: tailored to trainingIntent/split + what they already did today (if none, propose 1 short session).
6) Tomorrow setup (3 bullets): simple plan to win earlier.
END WITH: "Win move: ___" (one single action for the next 2 hours).

Rules:
- Use the provided data aggressively; if something is missing, say what to log/fill to improve accuracy.
- Use real numbers everywhere (no vague advice).
- Be supportive + confident, but not corny.
- Keep it detailed but not endless (aim ~350–650 words).

Data:
Day: ${bundle.dayUS}
Goal: ${goalType}
Diet preference: ${dietPreference}
Training intent: ${trainingIntent}
Training split: ${trainingSplit || "n/a"}
Last focus: ${lastFocus || "n/a"}
Equipment: ${Array.isArray(equipmentList) && equipmentList.length ? equipmentList.slice(0, 12).join(", ") : "n/a"}
Profile complete: ${bundle.derived.profileComplete ? "yes" : "no"}
Metabolism: ${hasEst ? `BMR ${Math.round(bundle.est.bmr_est)}, TDEE ${Math.round(bundle.est.tdee_est)}` : "n/a"}
Calorie bias: ${calorieBias}

Consumed: ${Math.round(bundle.totals.consumed)}
Burned: ${Math.round(bundle.totals.burned)}
Net: ${Math.round(bundle.totals.netKcal)}
Calorie target: ${bundle.targets.calorieTarget ? Math.round(bundle.targets.calorieTarget) : "—"}
Calorie delta (consumed - target): ${bundle.targets.calorieTarget ? Math.round(calDelta) : "—"}
Calories remaining: ${bundle.targets.calorieTarget ? Math.round(calorieRemaining) : "—"}

Protein: ${Math.round(bundle.totals.macros.protein_g)} / ${Math.round(bundle.targets.proteinTarget)} g (remaining ~${Math.round(proteinRemaining)}g)
Carbs: ${Math.round(bundle.totals.macros.carbs_g)} / ${Math.round(bundle.targets.carbsTarget)} g (remaining ~${Math.round(carbsRemaining)}g)
Fats: ${Math.round(bundle.totals.macros.fat_g)} / ${Math.round(bundle.targets.fatTarget)} g (remaining ~${Math.round(fatRemaining)}g)

Meals logged today: ${bundle.totals.mealsCount}
Meal windows: breakfast=${bundle.derived.mealBuckets?.breakfast ? "yes" : "no"}, lunch=${bundle.derived.mealBuckets?.lunch ? "yes" : "no"}, dinner=${bundle.derived.mealBuckets?.dinner ? "yes" : "no"}, late=${bundle.derived.mealBuckets?.late ? "yes" : "no"}
Meals detail (time PST, calories, macros): ${JSON.stringify(mealsCompact)}

Workouts logged today: ${workoutsToday.length}
Workouts detail (time PST, calories, exercises): ${JSON.stringify(workoutsToday)}

Checklist summary: ${JSON.stringify(checklistSummary)}
Confidence: ${bundle.derived.confidenceLabel}
Score: ${bundle.derived.score}/100
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
      try {
        if (recapCacheKey) localStorage.setItem(recapCacheKey, String(text).trim());
      } catch {
        // ignore
      }
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

  const topSubtitle = `${bundle.dayUS} • swipe → do steps → win`;

  const coachHelper = pro
    ? "Generate your daily verdict (ultra-detailed) for today."
    : `Generate your daily verdict (ultra-detailed) (free: ${Math.max(0, remainingAi)}/${limitAi} today).`;

  return (
    <Box
      sx={{
        // Mobile-first: let the carousel own the viewport height.
        p: { xs: 0, sm: 3 },
        maxWidth: { xs: "100%", sm: 1150 },
        mx: "auto",
      }}
    >
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1}
        alignItems={{ xs: "flex-start", sm: "center" }}
        justifyContent="space-between"
        sx={{ display: { xs: "none", sm: "flex" } }}
      >
        <Box>
          <Typography sx={{ fontWeight: 950, letterSpacing: -0.4, fontSize: 22, color: "rgba(2,6,23,0.98)" }}>
            Daily Evaluation
          </Typography>
          <Typography variant="caption" sx={{ color: "rgba(2,6,23,0.70)" }}>
            {topSubtitle}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap" }}>
          <FeatureUseBadge featureKey={FEATURE_KEY} isPro={pro} labelPrefix="Coach" />
        </Stack>
      </Stack>
{/* Cards */}
        <Box
        sx={{
          mt: { xs: 0, sm: 2 },
          px: { xs: 2, sm: 0 },
          // Full-screen carousel on mobile (accounts for app header + bottom nav + iOS safe area).
          height: {
            xs: "calc(100dvh - 56px - 72px - env(safe-area-inset-bottom))",
            sm: "auto",
          },
          display: "flex",
          gap: 1.5,
          overflowX: "auto",
          overflowY: { xs: "hidden", sm: "visible" },
          pb: { xs: 0, sm: 1 },
          scrollSnapType: "x mandatory",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {/* Card 1 */}
        <CardShell
          title="Today"
          subtitle="Your scoreboard"
        >
          <Stack spacing={1.2} alignItems="center">
            {/* Top row: Calories + Exercise */}
            <Stack direction="row" spacing={2.0} justifyContent="center" alignItems="center" sx={{ width: "100%", flexWrap: "wrap" }}>
              <Ring
                pct={bundle.targets.calorieTarget ? calQuality : 0}
                size={148}
                title="Calories"
                primary={`${Math.round(calQuality)}%`}
                secondary={`${Math.round(bundle.totals.consumed)} / ${bundle.targets.calorieTarget ? Math.round(bundle.targets.calorieTarget) : "—"} kcal`}
                tone="primary.main"
              />

              <Ring
                pct={exercisePct}
                size={148}
                title="Exercise"
                primary={`${Math.round(bundle.totals.burned)} kcal`}
                secondary={bundle.derived.hasWorkout ? "logged" : "not logged"}
                tone="warning.main"
              />
            </Stack>

            {/* Macros row */}
            <Stack direction="row" spacing={1.2} justifyContent="center" alignItems="center" sx={{ width: "100%", flexWrap: "wrap" }}>
              <Ring pct={proteinPct} size={96} title="Protein" primary={`${Math.round(bundle.totals.macros.protein_g)}g`} secondary={`of ${Math.round(bundle.targets.proteinTarget)}g`} tone="success.main" />
              <Ring pct={carbsPct} size={96} title="Carbs" primary={`${Math.round(bundle.totals.macros.carbs_g)}g`} secondary={`of ${Math.round(bundle.targets.carbsTarget)}g`} tone="info.main" />
              <Ring pct={fatsPct} size={96} title="Fats" primary={`${Math.round(bundle.totals.macros.fat_g)}g`} secondary={`of ${Math.round(bundle.targets.fatTarget)}g`} tone="secondary.main" />
            </Stack>

            <Chip icon={<WarningAmberIcon sx={{ color: "inherit" }} />} label={flag.label} color={flag.tone} sx={{ mt: 0.2, fontWeight: 950, borderRadius: 999 }} />
            {fixTags.length ? (
              <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="center" sx={{ mt: 0.8, flexWrap: "wrap" }}>
                {fixTags.map((t) => (
                  <Chip
                    key={t.label}
                    size="small"
                    label={t.label}
                    color={t.tone}
                    sx={{ borderRadius: 999, fontWeight: 950 }}
                  />
                ))}
              </Stack>
            ) : null}
          </Stack>
        </CardShell>

        {/* Card 2 */}
        <CardShell title="Progress" subtitle="Your quests (5 at a time)">
          <Stack spacing={1.1} alignItems="center">
            <Stack spacing={0.6} alignItems="center" sx={{ width: "100%" }}>
              <Typography sx={{ fontWeight: 950 }}>What to fix next</Typography>
              <Stack direction="row" spacing={1.2} alignItems="center" justifyContent="center" sx={{ width: "100%", flexWrap: "wrap" }}>
                <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.78)", textAlign: "center" }}>
                  {nextStep ? `${nextStep.title} — ${nextStep.subtitle}` : "You’re done for now ✅"}
                </Typography>
                {nextStep?.action ? (
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => history.push(nextStep.action)}
                    sx={{ borderRadius: 999, fontWeight: 950, px: 2.2, textTransform: "none" }}
                  >
                    {nextStep.action === "/meals" ? "Meals" : nextStep.action === "/workout" ? "Workout" : "Go"}
                  </Button>
                ) : null}
              </Stack>
            </Stack>

            <Box sx={{ width: "100%", borderRadius: 2, border: "1px solid rgba(148,163,184,0.18)", background: "rgba(15,23,42,0.55)" }}>
              <List disablePadding>
                {/* Window pager (Morning / Afternoon / Night) */}
                <Box sx={{ width: "100%", px: 1.2, py: 1.1 }}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.8 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!canPrevQuest}
                      onClick={() => setQuestPage((p) => Math.max(0, p - 1))}
                      sx={{ borderRadius: 999, textTransform: "none", fontWeight: 900, px: 1.8 }}
                    >
                      Back
                    </Button>

                    <Stack alignItems="center" spacing={0.2}>
                      <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.72)", fontWeight: 950, letterSpacing: 0.4, textTransform: "uppercase" }}>
                        {questWindowKey === "morning" ? "Morning" : questWindowKey === "afternoon" ? "Afternoon" : "Night"}
                      </Typography>

                      <Stack direction="row" spacing={0.6} alignItems="center">
                        {["morning", "afternoon", "night"].map((w, i) => (
                          <Box
                            key={w}
                            sx={{
                              width: 7,
                              height: 7,
                              borderRadius: 999,
                              background: i === questPage ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.25)",
                            }}
                          />
                        ))}
                      </Stack>
                    </Stack>

                    <Button
                      size="small"
                      variant="contained"
                      disabled={!canNextQuest}
                      onClick={() => setQuestPage((p) => Math.min(2, p + 1))}
                      sx={{ borderRadius: 999, textTransform: "none", fontWeight: 950, px: 2.1 }}
                    >
                      Next
                    </Button>
                  </Stack>

                  <Box
                    onTouchStart={onQuestTouchStart}
                    onTouchMove={onQuestTouchMove}
                    onTouchEnd={onQuestTouchEnd}
                    sx={{
                      width: "100%",
                      overflow: "hidden",
                      borderRadius: 2,
                      border: "1px solid rgba(148,163,184,0.14)",
                      background: "rgba(2,6,23,0.35)",
                    }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        width: "300%",
                        transform: `translateX(-${questPage * 100}%)`,
                        transition: "transform 260ms ease",
                      }}
                    >
                      {["morning", "afternoon", "night"].map((winKey) => {
                        const group = (questWindowSlices?.[winKey] || []).filter(Boolean);
                        const doneCount = group.filter((g) => g?.done).length;
                        const totalCount = group.length;
                        return (
                          <Box key={winKey} sx={{ width: "100%", flex: "0 0 100%", p: 1.0 }}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 0.4, pb: 0.6 }}>
                              <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.70)", fontWeight: 950, letterSpacing: 0.4, textTransform: "uppercase" }}>
                                {winKey === "morning" ? "Morning" : winKey === "afternoon" ? "Afternoon" : "Night"}
                              </Typography>
                              <Chip
                                size="small"
                                label={`${doneCount}/${totalCount}`}
                                sx={{ height: 22, fontWeight: 900, borderRadius: 999, background: "rgba(148,163,184,0.18)", color: "rgba(255,255,255,0.85)" }}
                              />
                            </Stack>

                            {group.length ? (
                              group.map((it, gIdx) => {
                                const Icon = it.done ? CheckCircleIcon : RadioButtonUncheckedIcon;
                                const iconColor = it.done ? "rgba(34,197,94,0.92)" : "rgba(255,255,255,0.55)";
                                return (
                                  <ListItemButton
                                    key={`${winKey}-${it.key}-${gIdx}`}
                                    onClick={() => {
                                      if (it.manual) {
                                        if (it.key === "rehydrate") toggleHydration();
                                      } else if (it.action) {
                                        history.push(it.action);
                                      }
                                    }}
                                    sx={{
                                      mx: 0.2,
                                      my: 0.35,
                                      borderRadius: 2,
                                      alignItems: "flex-start",
                                      background: it.done ? "rgba(34,197,94,0.07)" : "rgba(148,163,184,0.06)",
                                      border: "1px solid rgba(148,163,184,0.12)",
                                    }}
                                  >
                                    <ListItemIcon sx={{ minWidth: 34, mt: 0.3 }}>
                                      <Icon style={{ color: iconColor, fontSize: 20 }} />
                                    </ListItemIcon>
                                    <ListItemText
                                      primary={
                                        <Typography sx={{ fontWeight: 950, color: "rgba(255,255,255,0.92)", lineHeight: 1.15 }}>
                                          {it.title}
                                        </Typography>
                                      }
                                      secondary={
                                        <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.70)", mt: 0.35, lineHeight: 1.25 }}>
                                          {it.subtitle}
                                        </Typography>
                                      }
                                    />
                                  </ListItemButton>
                                );
                              })
                            ) : (
                              <ListItem sx={{ px: 0, py: 1 }}>
                                <ListItemText
                                  primary="All set"
                                  secondary="Nothing else needed in this window right now."
                                  primaryTypographyProps={{ sx: { fontWeight: 950, color: "rgba(255,255,255,0.86)" } }}
                                  secondaryTypographyProps={{ sx: { color: "rgba(255,255,255,0.65)" } }}
                                />
                              </ListItem>
                            )}
                          </Box>
                        );
                      })}
                    </Box>
                  </Box>
                </Box>              </List>
            </Box>

            {/* Paging */}
            {questMaxPages > 1 ? (
              <Stack direction="row" spacing={1.2} alignItems="center" justifyContent="center" sx={{ pt: 1.2 }}>
                <Button
                  variant="outlined"
                  disabled={!canPrevQuest}
                  onClick={() => setQuestPage((p) => Math.max(0, p - 1))}
                  sx={{ borderRadius: 999, px: 2.6, fontWeight: 950, textTransform: "none" }}
                >
                  Prev
                </Button>
                <Chip
                  size="small"
                  label={`${questPage + 1}/${questMaxPages}`}
                  sx={{ borderRadius: 999, fontWeight: 950 }}
                />
                <Button
                  variant="outlined"
                  disabled={!canNextQuest}
                  onClick={() => setQuestPage((p) => Math.min(questMaxPages - 1, p + 1))}
                  sx={{ borderRadius: 999, px: 2.6, fontWeight: 950, textTransform: "none" }}
                >
                  Next
                </Button>
              </Stack>
            ) : null}

          </Stack>
        </CardShell>

{/* Card 3 */}
        <CardShell title="Coach" subtitle="Your daily verdict">
          <Stack spacing={1.1} alignItems="center">
            <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.78)", textAlign: "center" }}>
              {coachHelper}
            </Typography>

            <Button
              variant="contained"
              fullWidth
              onClick={handleGenerateAiVerdict}
              disabled={aiLoading}
              sx={{ borderRadius: 999, fontWeight: 950, py: 1.15, mt: 0.4 }}
            >
              {aiLoading ? "Generating…" : "Get daily verdict"}
            </Button>

            {!!aiError && (
              <Typography variant="body2" sx={{ color: "rgba(248,113,113,0.95)", textAlign: "center" }}>
                {aiError}
              </Typography>
            )}

            {!aiVerdict && !aiLoading && !aiError && (
              <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.60)", textAlign: "center" }}>
                Uses what you logged today and gives you the fastest path to a win.
              </Typography>
            )}

            {!!aiVerdict && (
              <Box sx={{ width: "100%", p: 1.2, borderRadius: 2, border: "1px solid rgba(148,163,184,0.18)", background: "rgba(15,23,42,0.6)", maxHeight: { xs: "52dvh", sm: "none" }, overflowY: { xs: "auto", sm: "visible" }, WebkitOverflowScrolling: "touch", pr: { xs: 0.5, sm: 0 } }}>
                <Typography sx={{ fontWeight: 950, mb: 0.6 }}>Your verdict</Typography>
                <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.80)", whiteSpace: "pre-wrap" }}>
                  {aiVerdict}
                </Typography>
              </Box>
            )}

            <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="center" alignItems="center" sx={{ width: "100%" }}>
              <Button variant="outlined" startIcon={<IosShareIcon />} disabled={!aiVerdict && !bundle.derived.hasLogs} onClick={handleShare} sx={{ borderRadius: 999, fontWeight: 950 }}>
                Share
              </Button>
            </Stack>
          </Stack>
        </CardShell>

        {/* Card 4 */}
<CardShell title="Body Scan" subtitle="Beta">
  <Stack spacing={1.1}>
    <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.78)" }}>
      Upload a full-body photo to generate your <b>Build Arc</b> score and your fastest upgrade levers.
    </Typography>

    <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
      <Chip label="Neutral/positive only" variant="outlined" sx={{ borderRadius: 999, borderColor: "rgba(148,163,184,0.32)", color: "rgba(255,255,255,0.78)" }} />
      <Chip label="Shareable results" variant="outlined" sx={{ borderRadius: 999, borderColor: "rgba(148,163,184,0.32)", color: "rgba(255,255,255,0.78)" }} />
    </Stack>

    <Button
      variant="contained"
      fullWidth
      onClick={() => history.push("/body-scan")}
      sx={{ borderRadius: 999, fontWeight: 950, py: 1.15, mt: 0.6 }}
    >
      Open Body Scan
    </Button>

    <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.6)", textAlign: "center" }}>
      Private by default • We don’t share your photo, only the scan summary you choose to share
    </Typography>
  </Stack>
</CardShell>

      </Box>

      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
    </Box>
  );
}