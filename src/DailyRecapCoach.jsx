// src/DailyRecapCoach.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Typography,
  Card,
  CardContent,
  Stack,
  Divider,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  LinearProgress,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import UpgradeModal from "./components/UpgradeModal";
import FeatureUseBadge, {
  canUseDailyFeature,
  registerDailyFeatureUse,
  getDailyRemaining,
  getFreeDailyLimit,
} from "./components/FeatureUseBadge.jsx";
import { useAuth } from "./context/AuthProvider.jsx";
import { useEntitlements } from "./context/EntitlementsContext.jsx";
import {
  getWorkouts,
  getWorkoutSetsFor,
  getDailyMetricsRange,
  getMeals,
  getMealItemsForMealIds,
} from "./lib/db";

// ---- Coach-first: XP (localStorage, no backend) -------------------------------
const XP_KEY = "slimcal:xp:v1";

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function safeNum(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function round(n) {
  return Math.round(safeNum(n, 0));
}

function readJsonLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function computeLevel(xp) {
  let level = 1;
  let remaining = Math.max(0, safeNum(xp, 0));
  let req = 100;
  while (remaining >= req) {
    remaining -= req;
    level += 1;
    req = Math.round(req * 1.35);
    if (level > 99) break;
  }
  return { level, progress: remaining, next: req };
}

function computeTodayXp({ mealsCount, workoutsCount, hitProtein, hitCalories }) {
  const base = 10;
  const mealXp = mealsCount * 25;
  const workoutXp = workoutsCount * 40;
  const proteinXp = hitProtein ? 60 : 0;
  const caloriesXp = hitCalories ? 40 : 0;
  return base + mealXp + workoutXp + proteinXp + caloriesXp;
}

// deterministic pseudo-random (mulberry32-ish)
function seededRng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

// -------------------- Date/time helpers ---------------------------------------
function usDay(d = new Date()) {
  try {
    return new Date(d).toLocaleDateString("en-US");
  } catch {
    return String(d);
  }
}

// Local calendar-day as YYYY-MM-DD (stable across timezones)
function localISODay(d = new Date()) {
  try {
    const dt = new Date(d);
    const localMidnight = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    return localMidnight.toISOString().slice(0, 10);
  } catch {
    return String(d);
  }
}

function toTimeLabel(ts) {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatClock(date) {
  try {
    return new Date(date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

// Convert a local calendar day (YYYY-MM-DD) into a UTC range [from, to] (inclusive)
function localDayToUtcRangeInclusive(dayISO) {
  try {
    const [y, m, d] = String(dayISO).split("-").map(Number);
    const startLocal = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
    const endLocalExclusive = new Date(y, (m || 1) - 1, (d || 1) + 1, 0, 0, 0, 0);
    const to = new Date(endLocalExclusive.getTime() - 1).toISOString();
    return { from: startLocal.toISOString(), to };
  } catch {
    return { from: `${dayISO}T00:00:00.000Z`, to: `${dayISO}T23:59:59.999Z` };
  }
}

// -------------------- Macro helpers -------------------------------------------
function parseQtyFromText(text) {
  const m = String(text || "").match(/\b(\d+(?:\.\d+)?)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function clampNonNeg(n) {
  const x = Number(n);
  return Number.isFinite(x) && x > 0 ? x : 0;
}

function estimateMacrosFallbackFromCalories(calories) {
  const cals = clampNonNeg(calories);
  if (cals <= 0) return { protein_g: 0, carbs_g: 0, fat_g: 0 };
  const p = Math.round((cals * 0.25) / 4);
  const c = Math.round((cals * 0.45) / 4);
  const f = Math.round((cals * 0.30) / 9);
  return { protein_g: clampNonNeg(p), carbs_g: clampNonNeg(c), fat_g: clampNonNeg(f) };
}

/**
 * Stronger macro estimation:
 * - It tries to find qty from:
 *    qty param OR any number inside name OR any number inside unit/serving/label text
 * - This fixes cases like:
 *    name: "Eggs" + unit/serving: "6 eggs (1 large egg)"
 *    displayName: "Eggs — 6 eggs (1 large egg)"
 */
function estimateMacrosForFood({ name, qty, unit, calories, extraText } = {}) {
  const n = String(name || "");
  const u = String(unit || "");
  const e = String(extraText || "");
  const hay = `${n} ${u} ${e}`.toLowerCase();

  const q =
    (Number.isFinite(Number(qty)) && Number(qty) > 0 ? Number(qty) : null) ??
    parseQtyFromText(hay) ??
    1;

  const cals = clampNonNeg(calories);

  if (hay.includes("egg")) {
    // per large egg: ~6g protein, ~0.5g carbs, ~5g fat, ~70 kcal
    const base = { protein_g: 6 * q, carbs_g: 0.5 * q, fat_g: 5 * q };
    const expectedCals = 70 * q;
    const scale = expectedCals > 0 && cals > 0 ? cals / expectedCals : 1;
    return {
      protein_g: clampNonNeg(Math.round(base.protein_g * scale)),
      carbs_g: clampNonNeg(Math.round(base.carbs_g * scale)),
      fat_g: clampNonNeg(Math.round(base.fat_g * scale)),
    };
  }

  if (hay.includes("oat")) {
    // ~150 cals per 1/2 cup dry: 5P 27C 3F
    const base = { protein_g: 5 * q, carbs_g: 27 * q, fat_g: 3 * q };
    const expectedCals = 150 * q;
    const scale = expectedCals > 0 && cals > 0 ? cals / expectedCals : 1;
    return {
      protein_g: clampNonNeg(Math.round(base.protein_g * scale)),
      carbs_g: clampNonNeg(Math.round(base.carbs_g * scale)),
      fat_g: clampNonNeg(Math.round(base.fat_g * scale)),
    };
  }

  if (hay.includes("peanut butter") || hay.includes(" pb")) {
    // ~95 cals per tbsp: 4P 3C 8F
    const base = { protein_g: 4 * q, carbs_g: 3 * q, fat_g: 8 * q };
    const expectedCals = 95 * q;
    const scale = expectedCals > 0 && cals > 0 ? cals / expectedCals : 1;
    return {
      protein_g: clampNonNeg(Math.round(base.protein_g * scale)),
      carbs_g: clampNonNeg(Math.round(base.carbs_g * scale)),
      fat_g: clampNonNeg(Math.round(base.fat_g * scale)),
    };
  }

  return estimateMacrosFallbackFromCalories(cals);
}

function sumMacros(items = []) {
  const totals = { protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const it of items) {
    totals.protein_g += safeNum(it.protein_g ?? it.protein ?? 0, 0);
    totals.carbs_g += safeNum(it.carbs_g ?? it.carbs ?? 0, 0);
    totals.fat_g += safeNum(it.fat_g ?? it.fat ?? 0, 0);
  }
  totals.protein_g = Math.round(totals.protein_g);
  totals.carbs_g = Math.round(totals.carbs_g);
  totals.fat_g = Math.round(totals.fat_g);
  return totals;
}

// -------------------- Quests (DO NOT persist functions) -----------------------
function buildQuestPool({ proteinTarget }) {
  const lunchProtein = Math.min(60, Math.max(30, Math.round((proteinTarget || 0) * 0.35 || 40)));

  return [
    {
      id: "breakfast_before_11",
      label: "Log breakfast before 11am",
      progress: ({ mealsCount }) => ({ value: Math.min(mealsCount, 1), goal: 1 }),
      complete: ({ mealsCount, now }) => mealsCount >= 1 && now.getHours() < 11,
    },
    {
      id: "protein_by_lunch",
      label: `Hit ${lunchProtein}g protein by lunch`,
      progress: ({ proteinSoFar }) => ({ value: proteinSoFar, goal: lunchProtein }),
      complete: ({ proteinSoFar }) => proteinSoFar >= lunchProtein,
    },
    {
      id: "log_3_meals",
      label: "Log 3 meals today",
      progress: ({ mealsCount }) => ({ value: mealsCount, goal: 3 }),
      complete: ({ mealsCount }) => mealsCount >= 3,
    },
    {
      id: "burn_150",
      label: "Burn 150+ cals",
      progress: ({ burned }) => ({ value: burned, goal: 150 }),
      complete: ({ burned }) => burned >= 150,
    },
    {
      id: "burn_300",
      label: "Burn 300+ cals",
      progress: ({ burned }) => ({ value: burned, goal: 300 }),
      complete: ({ burned }) => burned >= 300,
    },
    {
      id: "hit_protein_goal",
      label: `Hit protein goal (${proteinTarget || 170}g)`,
      progress: ({ proteinSoFar }) => ({ value: proteinSoFar, goal: proteinTarget || 170 }),
      complete: ({ proteinSoFar }) => proteinSoFar >= (proteinTarget || 170),
    },
  ];
}

function pickDailyQuests({ dayKey, proteinTarget }) {
  const rng = seededRng(`${dayKey}|quests`);
  const pool = buildQuestPool({ proteinTarget });
  const shuffled = [...pool].sort(() => rng() - 0.5);

  const maxShown = Math.min(6, shuffled.length);

  // All quests are free/unlocked.
  return shuffled.slice(0, maxShown).map((q) => ({
    ...q,
    locked: false,
  }));
}


// -------------------- Coach reaction line ------------------------------------
function missedBreakfastLine({
  now,
  meals = [],
  workoutsCount = 0,
  consumed = 0,
  proteinTotal = 0,
  calorieGoal = 0,
  proteinGoal = 0,
}) {
  const h = now.getHours();
  const mealsCount = Array.isArray(meals) ? meals.length : 0;

  const firstMeal =
    mealsCount > 0
      ? meals
          .slice()
          .sort((a, b) =>
            (a?.eatenAt || a?.createdAt || a?.eaten_at || 0) >
            (b?.eatenAt || b?.createdAt || b?.eaten_at || 0)
              ? 1
              : -1
          )[0]
      : null;

  const firstTime = firstMeal?.eatenAt || firstMeal?.createdAt || firstMeal?.eaten_at || null;
  const firstTimeStr = firstTime ? formatClock(firstTime) : null;

  const calRem = Math.max(0, (Number(calorieGoal) || 0) - (Number(consumed) || 0));
  const proRem = Math.max(0, (Number(proteinGoal) || 0) - (Number(proteinTotal) || 0));

  if (mealsCount === 0 && workoutsCount === 0) {
    if (h >= 12) {
      return "No logs yet and we’re past noon 😅. Do one small win: log a meal *or* knock out a quick lift. Momentum > motivation.";
    }
    return "Fresh day. Log your first meal early and you’ll cruise the rest of the day.";
  }

  if (mealsCount > 0 && firstTimeStr && h >= 18) {
    if (firstMeal && new Date(firstTime).getHours() >= 15) {
      return `First meal was at ${firstTimeStr}. Late start — not a problem, just go **protein-first** the rest of the night.`;
    }
  }

  if (proteinGoal > 0 && h >= 14) {
    const pct = proteinGoal ? proteinTotal / proteinGoal : 0;
    if (pct < 0.35) {
      return `Protein is low (${Math.round(proteinTotal)}g). You’ve got ~${Math.round(proRem)}g left — next meal should be **lean protein + carbs**.`;
    }
  }

  if (calorieGoal > 0 && h >= 16 && calRem > 800) {
    return `You’ve got ${Math.round(calRem)} calories left. Keep it simple: **2 meals** (protein + carbs) and you’re back on track.`;
  }

  if (workoutsCount === 0 && h >= 17) {
    return "Food is in ✅. Now earn it: even 20–30 minutes of lifting or a long walk keeps the day productive.";
  }

  return "Solid progress today. Keep stacking small wins.";
}

// -------------------- User targets -------------------------------------------
function getUserTargets() {
  try {
    const ud = JSON.parse(localStorage.getItem("userData") || "{}") || {};
    const dailyGoal = safeNum(ud.dailyGoal, 0);
    const goalType = ud.goalType || localStorage.getItem("fitness_goal") || "";
    const dietPreference = ud.dietPreference || localStorage.getItem("diet_preference") || "omnivore";

    const proteinDaily =
      safeNum(ud?.proteinTargets?.daily_g, 0) || safeNum(localStorage.getItem("protein_target_daily_g"), 0);

    const proteinMeal =
      safeNum(ud?.proteinTargets?.per_meal_g, 0) || safeNum(localStorage.getItem("protein_target_meal_g"), 0);

    const trainingIntent = ud.trainingIntent || localStorage.getItem("training_intent") || "general";
    const trainingSplit = ud.trainingSplit || localStorage.getItem("training_split") || "full_body";
    const lastFocus = ud.lastFocus || localStorage.getItem("last_focus") || "upper";

    return {
      dailyGoal,
      goalType,
      dietPreference,
      proteinDaily,
      proteinMeal,
      trainingIntent,
      trainingSplit,
      lastFocus,
      raw: ud,
    };
  } catch {
    return {
      dailyGoal: 0,
      goalType: "",
      dietPreference: "omnivore",
      proteinDaily: 0,
      proteinMeal: 0,
      trainingIntent: "general",
      trainingSplit: "full_body",
      lastFocus: "upper",
      raw: {},
    };
  }
}

// -------------------- Local context builder (offline) -------------------------
function buildLocalContext(todayISO) {
  const todayUS = usDay();
  const wh = JSON.parse(localStorage.getItem("workoutHistory") || "[]");
  const mh = JSON.parse(localStorage.getItem("mealHistory") || "[]");

  const todayWorkouts = wh.filter((w) => w.date === todayUS);
  const workouts = [];
  for (const w of todayWorkouts) {
    for (const ex of w.exercises || []) {
      workouts.push({
        exercise_name: ex.name,
        reps: ex.reps || 0,
        weight: ex.weight || 0,
        calories: round(ex.calories || 0),
      });
    }
  }

  const mealsRec = mh.find((m) => m.date === todayUS);
  const localMeals = mealsRec?.meals || [];

  const meals = localMeals.map((m, idx) => {
    // 🔥 robust name/qty extraction to fix the eggs/macros bug
    const name =
      m.food_name ||
      m.foodName ||
      m.displayName ||
      m.label ||
      m.title ||
      m.name ||
      "Meal";

    const unit =
      m.unit ||
      m.serving ||
      m.serving_size ||
      m.servingSize ||
      m.portion ||
      m.description ||
      "";

    const qty =
      (Number.isFinite(Number(m.qty)) ? Number(m.qty) : null) ??
      (Number.isFinite(Number(m.count)) ? Number(m.count) : null) ??
      (Number.isFinite(Number(m.servings)) ? Number(m.servings) : null) ??
      null;

    const eaten_at = m.createdAt || m.eaten_at || m.eatenAt || null;

    const est = estimateMacrosForFood({
      name,
      qty,
      unit,
      calories: m.calories || m.total_calories || 0,
      extraText: `${m.displayName || ""} ${m.serving || ""} ${m.description || ""}`,
    });

    const items = [
      {
        food_name: name,
        qty: qty ?? parseQtyFromText(`${name} ${unit}`) ?? 1,
        unit: unit || "serving",
        calories: round(m.calories || m.total_calories || 0),
        protein: safeNum(m.protein_g ?? m.protein ?? m.proteinG, est.protein_g),
        carbs: safeNum(m.carbs_g ?? m.carbs ?? m.carbsG, est.carbs_g),
        fat: safeNum(m.fat_g ?? m.fat ?? m.fatG, est.fat_g),
        _estimated_macros: !((m.protein_g ?? m.protein ?? m.proteinG) || (m.carbs_g ?? m.carbs ?? m.carbsG) || (m.fat_g ?? m.fat ?? m.fatG)),
      },
    ];

    const macros = sumMacros(items);

    return {
      id: `local_${todayISO}_${idx}`,
      eaten_at,
      time_label: eaten_at ? toTimeLabel(eaten_at) : "",
      title: m.title || m.name || name || "Meal",
      total_calories: round(m.calories || m.total_calories || 0),
      items,
      macros,
    };
  });

  const burned = todayWorkouts.reduce((s, w) => s + round(w.totalCalories || 0), 0);
  const consumed = meals.reduce((s, mm) => s + round(mm.total_calories || 0), 0);
  const macroTotals = sumMacros(meals.flatMap((mm) => mm.items || []));

  return { burned, consumed, meals, workouts, macroTotals, source: "local" };
}

// -------------------- Suggestions ---------------------------------------------
function suggestionSnippets({ goalType, dietPreference, calorieRemaining, proteinRemaining }) {
  const diet = (dietPreference || "omnivore").toLowerCase();
  const goal = (goalType || "").toLowerCase();

  const proteinFoods = {
    vegan: ["tofu", "tempeh", "lentils", "edamame", "vegan protein shake"],
    vegetarian: ["greek yogurt", "eggs", "cottage cheese", "lentils", "protein shake"],
    pescatarian: ["salmon", "tuna", "shrimp", "greek yogurt", "protein shake"],
    keto: ["steak", "chicken", "salmon", "eggs", "cheese"],
    mediterranean: ["fish", "chicken", "greek yogurt", "chickpeas", "lentils"],
    omnivore: ["chicken", "lean beef", "eggs", "greek yogurt", "protein shake"],
  };

  const carbFoods = {
    bulking: ["rice", "oats", "potatoes", "pasta", "fruit"],
    cutting: ["berries", "vegetables", "sweet potatoes", "beans", "oats"],
    maintenance: ["rice", "oats", "potatoes", "fruit", "whole grains"],
  };

  const fats = ["olive oil", "avocado", "nuts", "peanut butter"];

  const pList = proteinFoods[diet] || proteinFoods.omnivore;
  const cList = carbFoods[goal] || carbFoods.maintenance;

  const recs = [];

  if (proteinRemaining > 0) {
    recs.push(`Protein boost: ${pList.slice(0, 3).join(", ")}`);
  }

  if (calorieRemaining > 0) {
    if (goal === "cutting") {
      recs.push(`Stay full while cutting: ${cList.slice(0, 3).join(", ")}`);
    } else if (goal === "bulking") {
      recs.push(`Easy calories for bulking: ${cList.slice(0, 3).join(", ")}`);
      recs.push(`Add fats if you need quick calories: ${fats.slice(0, 3).join(", ")}`);
    } else {
      recs.push(`Balanced add-on: ${cList.slice(0, 3).join(", ")}`);
    }
  }

  return recs.slice(0, 4);
}

// -------------------- Workouts kcal proxy ------------------------------------
const SCALE = 0.1; // kcal per (lb * rep) proxy; tune later

function calcCaloriesFromSets(sets) {
  if (!Array.isArray(sets) || sets.length === 0) return 0;
  let vol = 0;
  for (const s of sets) {
    const w = safeNum(s.weight, 0);
    const r = safeNum(s.reps, 0);
    vol += w * r;
  }
  return Math.round(vol * SCALE);
}

// -----------------------------------------------------------------------------
// Component
export default function DailyRecapCoach({ embedded = false } = {}) {
  const { user } = useAuth();
  const ent = useEntitlements();

  const isPro =
    !!ent?.isProActive ||
    (typeof window !== "undefined" && localStorage.getItem("isPro") === "true");

  const [loading, setLoading] = useState(false);
  const [recap, setRecap] = useState("");
  const [error, setError] = useState("");
  const [count, setCount] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

  const [savedAt, setSavedAt] = useState(null);
  const [history, setHistory] = useState([]);

  const todayUS = useMemo(() => usDay(), []);
  const todayISO = useMemo(() => localISODay(), []);
  const recapKeyToday = useMemo(() => `dailyRecap:${todayISO}`, [todayISO]);
  const recapHistoryKey = "dailyRecapHistory";

  const targets = useMemo(() => getUserTargets(), []);

  const [dayCtx, setDayCtx] = useState(null);
  const [dayCtxLoading, setDayCtxLoading] = useState(true);

  const [xpState, setXpState] = useState(() =>
    readJsonLS(XP_KEY, { totalXp: 0, lastAwardDay: null, lastEarned: 0 })
  );

  // ✅ quests are regenerated deterministically; we do NOT persist functions
  const [quests, setQuests] = useState(() =>
    pickDailyQuests({
      dayKey: todayISO,
      isPro,
      proteinTarget: targets.proteinDaily || 170,
    })
  );

  useEffect(() => {
    setQuests(
      pickDailyQuests({
        dayKey: todayISO,
        isPro,
        proteinTarget: targets.proteinDaily || 170,
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPro, todayISO]);

  // Load saved recap + history
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(recapKeyToday) || "null");
      if (saved?.content) {
        setRecap(String(saved.content));
        setSavedAt(saved.createdAt || null);
      }
    } catch {}

    try {
      const hist = JSON.parse(localStorage.getItem(recapHistoryKey) || "[]");
      setHistory(Array.isArray(hist) ? hist : []);
    } catch {
      setHistory([]);
    }
  }, [recapKeyToday]);

  // Load day context
  useEffect(() => {
    let mounted = true;
    (async () => {
      setDayCtxLoading(true);
      try {
        const ctx = await buildContext();
        if (mounted) setDayCtx(ctx);
      } catch {
        if (mounted) setDayCtx(null);
      } finally {
        if (mounted) setDayCtxLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, todayISO]);

  // Daily recap is a high-value feature, so it is strongly paywalled:
  // Free users get a small number of uses per day.
  const freeDailyRecapLimit = getFreeDailyLimit("daily_recap");

  // Sync display counter from our shared daily tracker
  useEffect(() => {
    if (isPro) {
      setCount(0);
      return;
    }
    const used = Math.max(0, freeDailyRecapLimit - getDailyRemaining("daily_recap"));
    setCount(used);
  }, [isPro, todayUS, freeDailyRecapLimit]);

  const incrementCount = () => {
    if (isPro) return 0;
    registerDailyFeatureUse("daily_recap");
    const usedNow = Math.max(0, freeDailyRecapLimit - getDailyRemaining("daily_recap"));
    setCount(usedNow);
    return usedNow;
  };

  const saveRecapLocal = (content) => {
    const entry = {
      dateISO: todayISO,
      dateUS: todayUS,
      content: String(content || ""),
      createdAt: new Date().toISOString(),
    };

    try {
      localStorage.setItem(recapKeyToday, JSON.stringify(entry));
    } catch {}

    try {
      const prev = JSON.parse(localStorage.getItem(recapHistoryKey) || "[]");
      const arr = Array.isArray(prev) ? prev : [];
      const filtered = arr.filter((e) => e?.dateISO !== todayISO);
      const next = [entry, ...filtered].slice(0, 30);
      localStorage.setItem(recapHistoryKey, JSON.stringify(next));
      setHistory(next);
    } catch {}

    setSavedAt(entry.createdAt);
  };

  // Build recap context (Supabase if signed in; otherwise local)
  async function buildContext() {
    if (!user) {
      return buildLocalContext(todayISO);
    }

    let burned = 0;
    let consumed = 0;

    try {
      const dm = await getDailyMetricsRange(user.id, todayISO, todayISO);
      const row = dm?.[0];
      burned = round(row?.burned ?? row?.cals_burned ?? 0);
      consumed = round(row?.eaten ?? row?.cals_eaten ?? 0);
    } catch (e) {
      console.warn("[DailyRecapCoach] getDailyMetricsRange failed, continuing", e);
    }

    const workouts = [];
    try {
      const ws = await getWorkouts(user.id, { limit: 30 });
      const todays = ws.filter((w) => (w.started_at || "").slice(0, 10) === todayISO);

      for (const w of todays) {
        const sets = await getWorkoutSetsFor(w.id, user.id);
        const kcal = calcCaloriesFromSets(sets);

        if (Array.isArray(sets) && sets.length > 0) {
          const byEx = new Map();
          for (const s of sets) {
            const k = s.exercise_name || "Exercise";
            const prev = byEx.get(k) || { exercise_name: k, sets: 0, reps: 0, weight_max: 0 };
            prev.sets += 1;
            prev.reps += safeNum(s.reps, 0);
            prev.weight_max = Math.max(prev.weight_max, safeNum(s.weight, 0));
            byEx.set(k, prev);
          }
          for (const v of byEx.values()) {
            workouts.push({
              exercise_name: v.exercise_name,
              sets: v.sets,
              reps: v.reps,
              weight: v.weight_max,
              calories: kcal,
            });
          }
        } else {
          workouts.push({
            exercise_name: "Workout session",
            sets: 0,
            reps: 0,
            weight: 0,
            calories: kcal,
          });
        }
      }
    } catch (e) {
      console.warn("[DailyRecapCoach] workouts fetch failed, continuing", e);
    }

    const meals = [];
    let macroTotals = { protein_g: 0, carbs_g: 0, fat_g: 0 };

    try {
      const { from: mealsFrom, to: mealsTo } = localDayToUtcRangeInclusive(todayISO);

      const mealsAll = await getMeals(user.id, { from: mealsFrom, to: mealsTo, limit: 200 });
      const ids = mealsAll.map((m) => m.id);
      const itemsMap = await getMealItemsForMealIds(user.id, ids);

      for (const m of mealsAll) {
        const itemsRaw = (itemsMap?.[m.id] || []).filter(Boolean);

        const baseItems = itemsRaw.length
          ? itemsRaw
          : [
              {
                food_name: m.title || "Meal",
                qty: 1,
                unit: "serving",
                calories: m.total_calories,
                protein: null,
                carbs: null,
                fat: null,
              },
            ];

        const items = baseItems.map((it) => {
          const est = estimateMacrosForFood({
            name: it.food_name,
            qty: it.qty,
            unit: it.unit,
            calories: it.calories,
            extraText: "",
          });

          return {
            food_name: it.food_name,
            qty: it.qty || 1,
            unit: it.unit || "serving",
            calories: round(it.calories),
            protein: safeNum(it.protein, est.protein_g),
            carbs: safeNum(it.carbs, est.carbs_g),
            fat: safeNum(it.fat, est.fat_g),
          };
        });

        const macros = sumMacros(items);

        meals.push({
          id: m.id,
          eaten_at: m.eaten_at,
          time_label: toTimeLabel(m.eaten_at),
          title: m.title || "Meal",
          total_calories: round(m.total_calories || 0),
          items,
          macros,
        });
      }

      macroTotals = sumMacros(meals.flatMap((mm) => mm.items || []));

      if (!consumed) {
        consumed = meals.reduce((s, mm) => s + round(mm.total_calories || 0), 0);
      }
    } catch (e) {
      console.warn("[DailyRecapCoach] meals fetch failed, continuing", e);
    }

    // Merge local unsynced meals
    try {
      const localCtx = buildLocalContext(todayISO);
      const localMeals = localCtx?.meals || [];
      if (localMeals.length) {
        const keyOf = (m) => `${m.title}|${round(m.total_calories || 0)}|${m.time_label || ""}`;
        const existing = new Set(meals.map(keyOf));

        for (const lm of localMeals) {
          const key = keyOf(lm);
          if (!existing.has(key)) {
            existing.add(key);
            meals.push({ ...lm, id: lm.id || `local-${btoa(key).slice(0, 10)}` });
          }
        }

        consumed = Math.max(consumed || 0, localCtx?.consumed || 0);
        burned = Math.max(burned || 0, localCtx?.burned || 0);
        macroTotals = sumMacros(meals.flatMap((mm) => mm.items || []));
      }
    } catch {}

    return { burned, consumed, meals, workouts, macroTotals, source: "cloud" };
  }

  function computeTimingNotes(meals = []) {
    const withTime = meals
      .map((m) => {
        const t = m.eaten_at ? new Date(m.eaten_at).getTime() : NaN;
        return { ...m, _t: t };
      })
      .filter((m) => Number.isFinite(m._t))
      .sort((a, b) => a._t - b._t);

    if (withTime.length < 2) return { first: null, last: null, gaps: [] };

    const gaps = [];
    for (let i = 1; i < withTime.length; i++) {
      const prev = withTime[i - 1];
      const cur = withTime[i];
      const mins = Math.round((cur._t - prev._t) / 60000);
      gaps.push({ from: prev.time_label, to: cur.time_label, minutes: mins });
    }

    return { first: withTime[0].time_label, last: withTime[withTime.length - 1].time_label, gaps };
  }

  // Award XP once per day
  useEffect(() => {
    if (xpState?.lastAwardDay === todayISO) return;

    const mealsCount = (dayCtx?.meals || []).length;
    const workoutsCount = (dayCtx?.workouts || []).length;

    const goal = targets.dailyGoal || 0;
    const eaten = round(dayCtx?.consumed || 0);
    const proteinSoFar = round(dayCtx?.macroTotals?.protein_g || 0);

    const hitProtein = (targets.proteinDaily || 0) ? proteinSoFar >= (targets.proteinDaily || 0) : false;
    const hitCalories = goal ? eaten >= Math.round(goal * 0.95) : false;

    const earned = computeTodayXp({ mealsCount, workoutsCount, hitProtein, hitCalories });
    const next = {
      totalXp: Math.max(0, safeNum(xpState?.totalXp, 0) + earned),
      lastAwardDay: todayISO,
      lastEarned: earned,
      updatedAt: Date.now(),
    };
    setXpState(next);
    writeJsonLS(XP_KEY, next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayISO, dayCtxLoading]);

  // Auto-generate recap on open (Pro only)
  useEffect(() => {
    if (!isPro) return;
    try {
      const saved = JSON.parse(localStorage.getItem(recapKeyToday) || "null");
      if (saved?.content) return;
    } catch {}
    if (!loading && !recap && !dayCtxLoading) {
      handleGetRecap();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPro, recapKeyToday, dayCtxLoading]);

  const handleGetRecap = async () => {
    // NOTE: the limit constant is `freeDailyRecapLimit` (defined above)
    if (!isPro && count >= freeDailyRecapLimit) {
      setModalOpen(true);
      return;
    }
    incrementCount();

    setLoading(true);
    setError("");
    setRecap("");

    try {
      const ctx = await buildContext();

      const goal = targets.dailyGoal || 0;
      const net = round((ctx.consumed || 0) - (ctx.burned || 0));
      const caloriesRemaining = goal ? round(goal - (ctx.consumed || 0)) : 0;

      const proteinTarget = targets.proteinDaily || 0;
      const proteinSoFar = round(ctx.macroTotals?.protein_g || 0);
      const proteinRemaining = proteinTarget ? round(proteinTarget - proteinSoFar) : 0;

      const timing = computeTimingNotes(ctx.meals || []);

      const coachFacts = {
        day: todayISO,
        goals: {
          daily_calorie_goal: goal || null,
          fitness_goal: targets.goalType || null,
          diet_preference: targets.dietPreference || null,
          training_intent: targets.trainingIntent || null,
          training_split: targets.trainingSplit || null,
          last_focus: targets.lastFocus || null,
          protein_target_g: proteinTarget || null,
          protein_per_meal_g: targets.proteinMeal || null,
        },
        totals: {
          eaten: round(ctx.consumed || 0),
          burned: round(ctx.burned || 0),
          net,
          protein_g: round(ctx.macroTotals?.protein_g || 0),
          carbs_g: round(ctx.macroTotals?.carbs_g || 0),
          fat_g: round(ctx.macroTotals?.fat_g || 0),
          calories_remaining: goal ? caloriesRemaining : null,
          protein_remaining_g: proteinTarget ? proteinRemaining : null,
        },
        meals: (ctx.meals || []).map((m) => ({
          time: m.time_label || null,
          title: m.title,
          total_calories: round(m.total_calories || 0),
          macros: {
            protein_g: round(m.macros?.protein_g || 0),
            carbs_g: round(m.macros?.carbs_g || 0),
            fat_g: round(m.macros?.fat_g || 0),
          },
          items: (m.items || []).slice(0, 20).map((it) => ({
            food: it.food_name,
            qty: it.qty ?? null,
            unit: it.unit ?? null,
            calories: round(it.calories || 0),
            protein_g: it.protein ?? null,
            carbs_g: it.carbs ?? null,
            fat_g: it.fat ?? null,
          })),
        })),
        workouts: (ctx.workouts || []).map((w) => ({
          exercise: w.exercise_name,
          sets: w.sets ?? null,
          reps: w.reps ?? null,
          weight: w.weight ?? null,
          calories_est: round(w.calories || 0),
        })),
        timing: {
          first_meal_time: timing.first,
          last_meal_time: timing.last,
          gaps_minutes: (timing.gaps || []).slice(0, 8),
        },
        client_context: { app: "slimcal.ai", source: ctx.source },
      };

      const autoSuggestions = suggestionSnippets({
        goalType: targets.goalType,
        dietPreference: targets.dietPreference,
        calorieRemaining: Math.max(0, caloriesRemaining),
        proteinRemaining: Math.max(0, proteinRemaining),
      });

      const system = `You are Slimcal Coach — an authentically fun, motivating, psychologically addicting fitness coach.

Rules:
- Be specific and grounded in today's data.
- If any data is missing, say what is missing and give a best-effort alternative.
- Use short punchy sections, emojis (tastefully), and coach-like energy.
- Do NOT invent foods or workouts that are not in the provided data.

Output format (use these headings):
1) "Today’s Scoreboard" (calories eaten/burned/net + macro totals)
2) "What You Ate" (list each meal with time + items + macros)
3) "Training Check-In" (what was trained + quick note)
4) "Goal Progress" (daily kcal goal + how far off + protein target progress)
5) "Timing & Consistency" (comments on meal timing & gaps; practical fix)
6) "Next Move" (2–4 actionable steps + 2–3 foods to hit targets)
7) "Coach Challenge" (a fun micro-challenge for tomorrow)
`;

      const userMsg = `Here is my structured day data as JSON. Use it exactly:\n\n${JSON.stringify(
        coachFacts,
        null,
        2
      )}\n\nAlso, here are 2–4 non-AI suggestions you may weave in if relevant (only if they fit the data):\n- ${autoSuggestions.join("\n- ")}`;

      const res = await fetch("/api/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: system },
            { role: "user", content: userMsg },
          ],
          context: coachFacts,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API error (${res.status}): ${text}`);
      }

      const data = await res.json();
      const msg = data.choices?.[0]?.message?.content;
      if (!msg) throw new Error("No message returned from OpenAI.");
      setRecap(msg);
      saveRecapLocal(msg);
    } catch (err) {
      console.error("Recap error:", err);
      setError(err.message || "Sorry, I couldn’t generate your daily recap right now.");
    } finally {
      setLoading(false);
    }
  };

  // ---- UI --------------------------------------------------------------------
  const FreeUsageBanner = !isPro ? (
    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
      Free recaps used today: <strong>{count}</strong>/{freeDailyRecapLimit}
    </Typography>
  ) : null;

  const UpsellCard = !isPro ? (
    <Card
      elevation={0}
      sx={{
        mb: 2.5,
        border: "1px solid rgba(2,6,23,0.08)",
        background: "linear-gradient(180deg, #ffffff, #fbfdff)",
        borderRadius: 2,
      }}
    >
      <CardContent sx={{ position: 'relative' }}>
        {!isPro && (
          <FeatureUseBadge
            featureKey="daily_recap"
            isPro={false}
            sx={{ position: 'absolute', top: 12, right: 12 }}
          />
        )}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="center" justifyContent="space-between">
          <Box sx={{ textAlign: { xs: "center", sm: "left" } }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 1 }}>
              Unlock AI Daily Recaps <Chip label="PRO" size="small" color="primary" sx={{ ml: 0.5 }} />
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Detailed breakdowns, goals tracking, meal timing tips, and better recommendations.
            </Typography>
          </Box>

          <Stack direction="row" spacing={1} justifyContent={{ xs: "center", sm: "flex-end" }}>
            <Button
              variant="contained"
              sx={{ fontWeight: 800 }}
              onClick={async () => {
                if (!user) {
                  window.dispatchEvent(new CustomEvent("slimcal:open-signin"));
                } else {
                  setModalOpen(true);
                }
              }}
            >
              Start Free Trial
            </Button>
          </Stack>
        </Stack>

        <Divider sx={{ my: 1.5 }} />

        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="center" justifyContent={{ xs: "center", sm: "flex-start" }}>
          <Feature text="Macros + meal timing coaching" />
          <Feature text="Saved recap history" />
          <Feature text="Smarter food suggestions" />
        </Stack>
      </CardContent>
    </Card>
  ) : null;

  const buttonText = recap ? "Regenerate Today’s Recap" : "Get Daily Recap";

  const RecapHeader = (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} alignItems={{ xs: "stretch", sm: "center" }} justifyContent="space-between">
      <Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant={embedded ? "h6" : "h5"} sx={{ fontWeight: 900 }}>
            Daily Recap Coach
          </Typography>
          <Chip label="AI" size="small" color="primary" sx={{ fontWeight: 800 }} />
          {!embedded && !isPro && <Chip label="3/day Free" size="small" variant="outlined" sx={{ fontWeight: 700 }} />}
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Get a detailed recap of today’s calories, macros, training, timing, and next steps.
        </Typography>

        {savedAt && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
            Saved: {new Date(savedAt).toLocaleString()}
          </Typography>
        )}
      </Box>

      <Button variant="contained" onClick={handleGetRecap} disabled={loading} sx={{ fontWeight: 900, borderRadius: 999, px: 3 }}>
        {loading ? <CircularProgress size={24} /> : buttonText}
      </Button>
    </Stack>
  );

  const History = history?.length ? (
    <Accordion sx={{ mt: 2 }} disableGutters>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography sx={{ fontWeight: 800 }}>Recap History</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.25}>
          {history.slice(0, 7).map((h, idx) => (
            <Box
              key={`${h?.dateISO || idx}-${idx}`}
              sx={{ p: 1, border: "1px solid rgba(2,6,23,0.08)", borderRadius: 2 }}
            >
              <Typography variant="caption" color="text.secondary">
                {h?.dateUS || h?.dateISO || ""}
              </Typography>
              <Typography sx={{ mt: 0.5, whiteSpace: "pre-wrap" }} variant="body2">
                {h?.content || ""}
              </Typography>
            </Box>
          ))}
        </Stack>
      </AccordionDetails>
    </Accordion>
  ) : null;

  const Inner = (
    <>
      {!embedded && UpsellCard}
      {RecapHeader}
      {FreeUsageBanner}

      {error && (
        <Typography color="error" sx={{ mt: 2 }}>
          {error}
        </Typography>
      )}

      {recap && (
        <Box sx={{ mt: 2 }}>
          <Typography sx={{ whiteSpace: "pre-wrap" }}>{recap}</Typography>
        </Box>
      )}

      {!embedded && History}
      <UpgradeModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );

  if (embedded) {
    return (
      <Card
        elevation={0}
        sx={{
          borderRadius: 3,
          border: "1px solid rgba(2,6,23,0.08)",
          background: "linear-gradient(180deg, #ffffff, #fbfdff)",
        }}
      >
        <CardContent sx={{ p: 2.25 }}>{Inner}</CardContent>
      </Card>
    );
  }

  const now = useMemo(() => new Date(), []);
  const mealsCount = (dayCtx?.meals || []).length;
  const burned = round(dayCtx?.burned || 0);
  const eaten = round(dayCtx?.consumed || 0);
  const net = round(eaten - burned);
  const proteinSoFar = round(dayCtx?.macroTotals?.protein_g || 0);
  const lvl = useMemo(() => computeLevel(xpState.totalXp || 0), [xpState.totalXp]);

  const goalCalories = targets.dailyGoal || 0;
  const goalProtein = targets.proteinDaily || 0;

  const roastLine = missedBreakfastLine({
    now,
    meals: dayCtx?.meals || [],
    workoutsCount: dayCtx?.workouts?.length || 0,
    consumed: dayCtx?.consumed || 0,
    proteinTotal: dayCtx?.macroTotals?.protein_g || 0,
    calorieGoal: goalCalories,
    proteinGoal: goalProtein,
  });

  return (
    <Box sx={{ p: 2, maxWidth: 900, mx: "auto" }}>
      <Box sx={{ mb: 2.2 }}>
        <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: "-0.02em" }}>
          🧠 Coach
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.3 }}>
          Open app → Coach reacts to your day → you log meals/workouts → come back for the recap.
        </Typography>
      </Box>

      {roastLine && (
        <Card
          elevation={0}
          sx={{
            mb: 2.0,
            border: "1px solid rgba(2,6,23,0.10)",
            borderRadius: 2,
            background: "rgba(2,6,23,0.03)",
          }}
        >
          <CardContent>
            <Typography sx={{ fontWeight: 900, lineHeight: 1.35 }}>{roastLine}</Typography>
          </CardContent>
        </Card>
      )}

      <Card data-testid="coach-xp" elevation={0} sx={{ mb: 2.0, border: "1px solid rgba(2,6,23,0.10)", borderRadius: 2 }}>
        <CardContent>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ xs: "stretch", sm: "center" }} justifyContent="space-between">
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
                Level {lvl.level}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                +{xpState.lastEarned || 0} XP earned today
              </Typography>
            </Box>
            <Box sx={{ flex: 1, minWidth: 220 }}>
              <LinearProgress
                variant="determinate"
                value={lvl.next ? clamp((lvl.progress / lvl.next) * 100, 0, 100) : 0}
                sx={{ height: 10, borderRadius: 999, backgroundColor: "rgba(2,6,23,0.06)" }}
              />
              <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: "wrap" }}>
                <Chip size="small" label={`🍽️ Meals: ${mealsCount}`} />
                <Chip size="small" label={`🔥 Burned: ${burned}`} />
                <Chip size="small" label={`🥩 Protein: ${proteinSoFar}g`} />
                <Chip size="small" label={`⚖️ Net: ${net > 0 ? `+${net}` : net}`} />
              </Stack>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Card elevation={0} sx={{ mb: 2.0, border: "1px solid rgba(2,6,23,0.10)", borderRadius: 2 }}>
        <CardContent>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "flex-start", sm: "center" }} justifyContent="space-between" sx={{ mb: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
              🎯 Daily Quests
            </Typography>
            {!isPro && (
              <Button size="small" variant="outlined" sx={{ fontWeight: 900 }} onClick={() => setModalOpen(true)}>
                🔥 Unlock 5 Quests + smarter coaching
              </Button>
            )}
          </Stack>

          <Stack spacing={1.1}>
            {quests.map((q) => {
              const prog = q.progress({ mealsCount, burned, proteinSoFar, now });
              const done = q.complete({ mealsCount, burned, proteinSoFar, now });
              const pct = prog.goal ? clamp((prog.value / prog.goal) * 100, 0, 100) : 0;
              return (
                <Box
                  key={q.id}
                  sx={{
                    p: 1.2,
                    borderRadius: 1.5,
                    border: "1px solid rgba(2,6,23,0.08)",
                    background: done ? "rgba(2,6,23,0.04)" : "white",
                  }}
                >
                  <Stack direction="row" spacing={1.2} alignItems="center">
                    <Box sx={{ width: 26, textAlign: "center", fontSize: 18 }}>
                      {done ? "✅" : "🎯"}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 800, opacity: 1 }}>{q.label}</Typography>
                      <LinearProgress
                        variant="determinate"
                        value={pct}
                        sx={{ mt: 0.9, height: 8, borderRadius: 999, backgroundColor: "rgba(2,6,23,0.06)" }}
                      />
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.6 }}>
                        {`${Math.min(prog.value, prog.goal)} / ${prog.goal}`}
                      </Typography>
                    </Box>
                    
                  </Stack>
                </Box>
              );
            })}
          </Stack>

          {!isPro && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.2 }}>
              Free gets 1–2 quests. Pro gets 5–7 quests + streak multipliers + card export.
            </Typography>
          )}
        </CardContent>
      </Card>

      {Inner}
    </Box>
  );
}

function Feature({ text }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Chip label="✓" size="small" variant="outlined" />
      <Typography variant="caption">{text}</Typography>
    </Stack>
  );
}
