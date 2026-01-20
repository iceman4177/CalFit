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
  Tooltip,
  LinearProgress,
  IconButton,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ShareIcon from "@mui/icons-material/Share";
import UpgradeModal from "./components/UpgradeModal";
import { useAuth } from "./context/AuthProvider.jsx";
import { useEntitlements } from "./context/EntitlementsContext.jsx";
import {
  getWorkouts,
  getWorkoutSetsFor,
  getDailyMetricsRange,
  getMeals,
  getMealItemsForMealIds,
} from "./lib/db";

// ---- Helpers ----------------------------------------------------------------

// ---- Coach-first: XP + Quests (localStorage, no backend) ----------------------
const XP_KEY = 'slimcal:xp:v1';
const QUESTS_KEY = 'slimcal:quests:v1';

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
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

function seededRng(seedStr) {
  // deterministic pseudo-random (mulberry32)
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

function buildQuestPool({ proteinTarget }) {
  const lunchProtein = Math.min(60, Math.max(30, Math.round(proteinTarget * 0.35 || 40)));
  return [
    {
      id: 'breakfast_before_11',
      label: 'Log breakfast before 11am',
      progress: ({ mealsCount }) => ({ value: Math.min(mealsCount, 1), goal: 1 }),
      complete: ({ mealsCount, now }) => mealsCount >= 1 && now.getHours() < 11,
    },
    {
      id: 'protein_by_lunch',
      label: `Hit ${lunchProtein}g protein by lunch`,
      progress: ({ proteinSoFar }) => ({ value: proteinSoFar, goal: lunchProtein }),
      complete: ({ proteinSoFar }) => proteinSoFar >= lunchProtein,
    },
    {
      id: 'log_3_meals',
      label: 'Log 3 meals today',
      progress: ({ mealsCount }) => ({ value: mealsCount, goal: 3 }),
      complete: ({ mealsCount }) => mealsCount >= 3,
    },
    {
      id: 'burn_150',
      label: 'Burn 150+ cals',
      progress: ({ burned }) => ({ value: burned, goal: 150 }),
      complete: ({ burned }) => burned >= 150,
    },
    {
      id: 'burn_300',
      label: 'Burn 300+ cals',
      progress: ({ burned }) => ({ value: burned, goal: 300 }),
      complete: ({ burned }) => burned >= 300,
    },
    {
      id: 'hit_protein_goal',
      label: `Hit protein goal (${proteinTarget || 170}g)`,
      progress: ({ proteinSoFar }) => ({ value: proteinSoFar, goal: proteinTarget || 170 }),
      complete: ({ proteinSoFar }) => proteinSoFar >= (proteinTarget || 170),
    },
  ];
}

function pickDailyQuests({ dayKey, isPro, proteinTarget }) {
  const rng = seededRng(`${dayKey}|quests`);
  const pool = buildQuestPool({ proteinTarget });
  const shuffled = [...pool].sort(() => rng() - 0.5);
  const freeUnlocked = 2;
  const maxShown = Math.min(6, shuffled.length);

  return shuffled.slice(0, maxShown).map((q, idx) => ({
    ...q,
    locked: !isPro && idx >= freeUnlocked,
  }));
}

function computeTodayXp({ mealsCount, workoutsCount, hitProtein, hitCalories }) {
  const base = 10;
  const mealXp = mealsCount * 25;
  const workoutXp = workoutsCount * 40;
  const proteinXp = hitProtein ? 60 : 0;
  const caloriesXp = hitCalories ? 40 : 0;
  return base + mealXp + workoutXp + proteinXp + caloriesXp;
}

function missedBreakfastLine({ now, mealsCount, consumedCalories }) {
  // Fun + funny, but psychologically effective (less corny / less "zesty")
  // Only warn if there is *actually* no food logged.
  const h = now.getHours();
  const t = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  // If calories exist but meals list is missing (cache mismatch), don't claim they didn't eat.
  const hasAnyFood = mealsCount > 0 || consumedCalories > 0;
  if (!hasAnyFood && h >= 11 && h < 16) {
    return `It’s ${t}. Quick win: log a real meal now (protein first) so your day doesn’t drift.`;
  }

  if (hasAnyFood && mealsCount <= 1 && h >= 15 && h < 22) {
    return `It’s ${t}. You’ve got momentum—lock in one more protein-heavy meal or a short workout and finish strong.`;
  }

  if (!hasAnyFood && h >= 16) {
    return `It’s ${t}. If today got away from you, do a 10–20 min session or log a high-protein meal right now. One move changes the day.`;
  }

  return null;
}

const SCALE = 0.1; // kcal per (lb * rep) proxy; tune/replace with MET later

function isoDay(d = new Date()) {
  // Local-day safe ISO string (prevents UTC day-rollover showing the wrong date in PST evenings)
  try {
    const dd = new Date(d);
    const localMidnight = new Date(dd.getFullYear(), dd.getMonth(), dd.getDate());
    return localMidnight.toISOString().slice(0, 10);
  } catch {
    return d;
  }
}

function estimateMacrosForLocalMeal(m) {
  // Many local MealTracker entries store calories + display name but not macros.
  // We estimate a few common foods to make Coach accurate.
  const existingProtein = safeNum(m?.protein_g ?? m?.protein, 0);
  const existingCarbs = safeNum(m?.carbs_g ?? m?.carbs, 0);
  const existingFat = safeNum(m?.fat_g ?? m?.fat, 0);
  if (existingProtein > 0 || existingCarbs > 0 || existingFat > 0) {
    return { protein_g: existingProtein, carbs_g: existingCarbs, fat_g: existingFat };
  }

  const name = String(m?.name || '').toLowerCase();
  const qty = safeNum(m?.qty, 0);

  // Eggs: ~6g protein, ~5g fat per large egg
  if (name.startsWith('eggs')) {
    let eggs = qty;
    if (!eggs) {
      // Try parse "Eggs — 6 eggs (1 large egg)"
      const match = String(m?.name || '').match(/\b(\d+)\s*eggs?\b/i);
      if (match) eggs = safeNum(match[1], 0);
    }
    if (!eggs) {
      const c = safeNum(m?.calories, 0);
      if (c > 0) eggs = Math.round(c / 70);
    }
    return { protein_g: Math.round(eggs * 6), carbs_g: 0, fat_g: Math.round(eggs * 5) };
  }

  return { protein_g: 0, carbs_g: 0, fat_g: 0 };
}

function usDay(d = new Date()) {
  try {
    return new Date(d).toLocaleDateString("en-US");
  } catch {
    return d;
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

function safeNum(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function round(n) {
  return Math.round(safeNum(n, 0));
}

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

function fmtDelta(n) {
  const v = round(n);
  if (v === 0) return "0";
  return v > 0 ? `+${v}` : `${v}`;
}

function getUserTargets() {
  try {
    const ud = JSON.parse(localStorage.getItem("userData") || "{}") || {};
    const dailyGoal = safeNum(ud.dailyGoal, 0);
    const goalType = ud.goalType || localStorage.getItem("fitness_goal") || "";
    const dietPreference =
      ud.dietPreference || localStorage.getItem("diet_preference") || "omnivore";

    const proteinDaily =
      safeNum(ud?.proteinTargets?.daily_g, 0) ||
      safeNum(localStorage.getItem("protein_target_daily_g"), 0);

    const proteinMeal =
      safeNum(ud?.proteinTargets?.per_meal_g, 0) ||
      safeNum(localStorage.getItem("protein_target_meal_g"), 0);

    const trainingIntent =
      ud.trainingIntent || localStorage.getItem("training_intent") || "general";

    const trainingSplit =
      ud.trainingSplit || localStorage.getItem("training_split") || "full_body";

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

// Build local fallback context for today (works offline)
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

  // Try to use createdAt/time if present; otherwise “Unknown time”
  const meals = localMeals.map((m, idx) => {
    const eaten_at = m.createdAt || m.eaten_at || null;
    const est = estimateMacrosForLocalMeal(m);
    const items = [
      {
        food_name: m.name || "Meal",
        qty: m.qty ?? 1,
        unit: m.unit || "serving",
        calories: round(m.calories || 0),
        // Prefer stored macros; fallback to estimates for common foods (eggs, etc.)
        protein: (m.protein_g ?? m.protein) != null ? (m.protein_g ?? m.protein) : est.protein_g,
        carbs: (m.carbs_g ?? m.carbs) != null ? (m.carbs_g ?? m.carbs) : est.carbs_g,
        fat: (m.fat_g ?? m.fat) != null ? (m.fat_g ?? m.fat) : est.fat_g,
      },
    ];

    const macros = sumMacros([
      {
        protein_g: (m.protein_g ?? m.protein) != null ? safeNum(m.protein_g ?? m.protein, 0) : est.protein_g,
        carbs_g: (m.carbs_g ?? m.carbs) != null ? safeNum(m.carbs_g ?? m.carbs, 0) : est.carbs_g,
        fat_g: (m.fat_g ?? m.fat) != null ? safeNum(m.fat_g ?? m.fat, 0) : est.fat_g,
      },
    ]);

    return {
      id: `local_${todayISO}_${idx}`,
      eaten_at,
      time_label: eaten_at ? toTimeLabel(eaten_at) : "",
      title: m.name || "Meal",
      total_calories: round(m.calories || 0),
      items,
      macros,
    };
  });

  const burned = todayWorkouts.reduce((s, w) => s + round(w.totalCalories || 0), 0);
  const consumed = meals.reduce((s, m) => s + round(m.total_calories || 0), 0);

  const macroTotals = sumMacros(
    meals.flatMap((m) => [
      {
        protein_g: m.macros?.protein_g || 0,
        carbs_g: m.macros?.carbs_g || 0,
        fat_g: m.macros?.fat_g || 0,
      },
    ])
  );

  return { burned, consumed, meals, workouts, macroTotals, source: "local" };
}

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

// -----------------------------------------------------------------------------
// Component
export default function DailyRecapCoach({ embedded = false } = {}) {
  const { user } = useAuth();
  const ent = useEntitlements();

  // True for active, trialing, or past_due (matches server logic)
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
  const todayISO = useMemo(() => isoDay(), []);
  const storageKey = `recapUsage`;
  const recapKeyToday = useMemo(() => `dailyRecap:${todayISO}`, [todayISO]);
  const recapHistoryKey = "dailyRecapHistory";

  const targets = useMemo(() => getUserTargets(), []);

  // Coach homepage needs data even before generating a recap
  const [dayCtx, setDayCtx] = useState(null);
  const [dayCtxLoading, setDayCtxLoading] = useState(true);

  // XP state (awarded once per day)
  const [xpState, setXpState] = useState(() => readJsonLS(XP_KEY, { totalXp: 0, lastAwardDay: null, lastEarned: 0 }));

  // Daily quests
  const [quests, setQuests] = useState(() => {
    const cached = readJsonLS(QUESTS_KEY, null);
    if (cached?.dayKey === todayISO && Array.isArray(cached?.quests)) return cached.quests;
    const picked = pickDailyQuests({ dayKey: todayISO, isPro, proteinTarget: targets.proteinDaily || 170 });
    writeJsonLS(QUESTS_KEY, { dayKey: todayISO, quests: picked });
    return picked;
  });

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

  // Prefetch today context so Coach can show XP/Quests instantly
  useEffect(() => {
    let mounted = true;
    (async () => {
      setDayCtxLoading(true);
      try {
        const ctx = await buildContext();
        if (mounted) setDayCtx(ctx);
      } catch (e) {
        if (mounted) setDayCtx(null);
      } finally {
        if (mounted) setDayCtxLoading(false);
      }
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, todayISO]);

  // Keep quests in sync with Pro status
  useEffect(() => {
    const picked = pickDailyQuests({ dayKey: todayISO, isPro, proteinTarget: targets.proteinDaily || 170 });
    setQuests(picked);
    writeJsonLS(QUESTS_KEY, { dayKey: todayISO, quests: picked });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPro, todayISO]);

  // Load or reset today’s count on mount and whenever entitlement changes
  useEffect(() => {
    if (isPro) {
      // Pro/Trial: clear any client-side cap for today
      try {
        const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
        if (stored.date === todayUS && stored.count) {
          localStorage.setItem(storageKey, JSON.stringify({ date: todayUS, count: 0 }));
        }
      } catch {}
      setCount(0);
      return;
    }
    // Free users: load today’s usage
    const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
    setCount(stored.date === todayUS ? stored.count || 0 : 0);
  }, [isPro, todayUS]);

  // Keep an eye on Pro refresh events (login/logout, billing changes)
  useEffect(() => {
    const onRefresh = () => {
      if (localStorage.getItem("isPro") === "true") {
        setCount(0);
      }
    };
    window.addEventListener("slimcal:pro:refresh", onRefresh);
    return () => window.removeEventListener("slimcal:pro:refresh", onRefresh);
  }, []);

  const incrementCount = () => {
    if (isPro) return 0; // never increment for Pro/Trial
    const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
    const newCount = stored.date === todayUS ? (stored.count || 0) + 1 : 1;
    localStorage.setItem(storageKey, JSON.stringify({ date: todayUS, count: newCount }));
    setCount(newCount);
    return newCount;
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

  // Build the recap context (Supabase if signed in; otherwise local)
  async function buildContext() {
    if (!user) {
      return buildLocalContext(todayISO);
    }

    // 1) Today’s daily metrics
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

    // 2) Today’s workouts → sets → kcal proxy
    const workouts = [];
    try {
      const ws = await getWorkouts(user.id, { limit: 30 });
      const todays = ws.filter((w) => (w.started_at || "").slice(0, 10) === todayISO);
      for (const w of todays) {
        const sets = await getWorkoutSetsFor(w.id, user.id);
        const kcal = calcCaloriesFromSets(sets);

        if (Array.isArray(sets) && sets.length > 0) {
          // group by exercise_name to show cleaner summary
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

    // 3) Today’s meals + meal items (macros + timing)
    const meals = [];
    let macroTotals = { protein_g: 0, carbs_g: 0, fat_g: 0 };

    try {
      const mealsAll = await getMeals(user.id, {
        from: `${todayISO}T00:00:00.000Z`,
        to: `${todayISO}T23:59:59.999Z`,
        limit: 200,
      });

      const ids = mealsAll.map((m) => m.id);
      const itemsMap = await getMealItemsForMealIds(user.id, ids);

      for (const m of mealsAll) {
        const itemsRaw = itemsMap?.[m.id] || [];
        const items = itemsRaw.map((it) => ({
          food_name: it.food_name,
          qty: it.qty,
          unit: it.unit,
          calories: round(it.calories),
          protein: it.protein,
          carbs: it.carbs,
          fat: it.fat,
        }));

        const macros = sumMacros(
          itemsRaw.map((it) => ({
            protein_g: it.protein,
            carbs_g: it.carbs,
            fat_g: it.fat,
          }))
        );

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

      // totals
      macroTotals = sumMacros(
        meals.flatMap((mm) => [
          {
            protein_g: mm.macros?.protein_g || 0,
            carbs_g: mm.macros?.carbs_g || 0,
            fat_g: mm.macros?.fat_g || 0,
          },
        ])
      );

      // If daily_metrics was missing, compute consumed from meals
      if (!consumed) {
        consumed = meals.reduce((s, mm) => s + round(mm.total_calories || 0), 0);
      }
    } catch (e) {
      console.warn("[DailyRecapCoach] meals fetch failed, continuing", e);
    }

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
      gaps.push({
        from: prev.time_label,
        to: cur.time_label,
        minutes: mins,
      });
    }

    return {
      first: withTime[0].time_label,
      last: withTime[withTime.length - 1].time_label,
      gaps,
    };
  }

  // Award XP once per day based on current day state
  useEffect(() => {
    if (xpState?.lastAwardDay === todayISO) return;

    const mealsCount = (dayCtx?.meals || []).length;
    const workoutsCount = (dayCtx?.workouts || []).length;

    const goal = targets.dailyGoal || 0;
    const eaten = round(dayCtx?.consumed || 0);
    const burned = round(dayCtx?.burned || 0);
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
    // if already have a saved recap today, don't auto
    try {
      const saved = JSON.parse(localStorage.getItem(recapKeyToday) || 'null');
      if (saved?.content) return;
    } catch {}
    if (!loading && !recap) {
      // don't spam if context still loading
      if (!dayCtxLoading) handleGetRecap();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPro, recapKeyToday, dayCtxLoading]);

  const handleGetRecap = async () => {
    // Non-Pro users are limited to 3/day
    if (!isPro && count >= 3) {
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
        client_context: {
          app: "slimcal.ai",
          source: ctx.source,
        },
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
1) \"Today’s Scoreboard\" (calories eaten/burned/net + macro totals)
2) \"What You Ate\" (list each meal with time + items + macros)
3) \"Training Check-In\" (what was trained + quick note)
4) \"Goal Progress\" (daily kcal goal + how far off + protein target progress)
5) \"Timing & Consistency\" (comments on meal timing & gaps; practical fix)
6) \"Next Move\" (2–4 actionable steps + 2–3 foods to hit targets)
7) \"Coach Challenge\" (a fun micro-challenge for tomorrow)
`;

      const userMsg = `Here is my structured day data as JSON. Use it exactly:\n\n${JSON.stringify(
        coachFacts,
        null,
        2
      )}\n\nAlso, here are 2–4 non-AI suggestions you may weave in if relevant (only if they fit the data):\n- ${autoSuggestions.join(
        "\n- "
      )}`;

      // Call OpenAI-backed API
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

  // ---- Share helpers ----------------------------------------------------------
  async function copyRecap() {
    const text = String(recap || '').trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }

  async function shareRecap() {
    const text = String(recap || '').trim();
    if (!text) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'SlimCal Coach Recap', text });
        return;
      } catch {
        // user canceled
      }
    }
    await copyRecap();
  }

  // ---- UI --------------------------------------------------------------------
  const FreeUsageBanner = !isPro ? (
    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
      Free recaps used today: <strong>{count}</strong>/3
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
      <CardContent>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          alignItems="center"
          justifyContent="space-between"
        >
          <Box sx={{ textAlign: { xs: "center", sm: "left" } }}>
            <Typography
              variant="subtitle1"
              sx={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 1 }}
            >
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
                  // open sign in
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

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          alignItems="center"
          justifyContent={{ xs: "center", sm: "flex-start" }}
        >
          <Feature text="Macros + meal timing coaching" />
          <Feature text="Saved recap history" />
          <Feature text="Smarter food suggestions" />
        </Stack>
      </CardContent>
    </Card>
  ) : null;

  const buttonText = recap ? "Regenerate Today’s Recap" : "Get Daily Recap";

  const RecapHeader = (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={1.25}
      alignItems={{ xs: "stretch", sm: "center" }}
      justifyContent="space-between"
    >
      <Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant={embedded ? "h6" : "h5"} sx={{ fontWeight: 900 }}>
            Daily Recap Coach
          </Typography>
          <Chip label="AI" size="small" color="primary" sx={{ fontWeight: 800 }} />
          {!embedded && !isPro && (
            <Chip
              label="3/day Free"
              size="small"
              variant="outlined"
              sx={{ fontWeight: 700 }}
            />
          )}
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

      <Button
        variant="contained"
        onClick={handleGetRecap}
        disabled={loading}
        sx={{ fontWeight: 900, borderRadius: 999, px: 3 }}
      >
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
              sx={{
                p: 1,
                border: "1px solid rgba(2,6,23,0.08)",
                borderRadius: 2,
              }}
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

  // Use real current time each render so time-based coaching is accurate.
  const now = new Date();
  const mealsCountRaw = (dayCtx?.meals || []).length;
  const workoutsCount = (dayCtx?.workouts || []).length;
  const goal = targets.dailyGoal || 0;
  const eaten = round(dayCtx?.consumed || 0);
  const burned = round(dayCtx?.burned || 0);
  const net = round(eaten - burned);
  const proteinSoFar = round(dayCtx?.macroTotals?.protein_g || 0);
  // If calories exist but meal details are missing (cache mismatch), don't show 0 meals.
  const mealsCount = mealsCountRaw > 0 ? mealsCountRaw : eaten > 0 ? 1 : 0;
  const hitProtein = (targets.proteinDaily || 0) ? proteinSoFar >= (targets.proteinDaily || 0) : false;
  const hitCalories = goal ? eaten >= Math.round(goal * 0.95) : false;
  const lvl = useMemo(() => computeLevel(xpState.totalXp || 0), [xpState.totalXp]);
  const roastLine = missedBreakfastLine({ now, mealsCount, consumedCalories: eaten });

  return (
    <Box sx={{ p: 2, maxWidth: 900, mx: "auto" }}>

      {/* 🏠 Coach homepage header */}
      <Box sx={{ mb: 2.2 }}>
        <Typography variant={embedded ? "h6" : "h4"} sx={{ fontWeight: 900, letterSpacing: "-0.02em" }}>
          🧠 Coach
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.3 }}>
          Open app → Coach reacts to your day → you log meals/workouts → come back for the recap.
        </Typography>
      </Box>

      {/* Missed breakfast reactions (time-based) */}
      {roastLine && (
        <Card elevation={0} sx={{ mb: 2.0, border: "1px solid rgba(2,6,23,0.10)", borderRadius: 2, background: "rgba(2,6,23,0.03)" }}>
          <CardContent>
            <Typography sx={{ fontWeight: 900, lineHeight: 1.35 }}>{roastLine}</Typography>
          </CardContent>
        </Card>
      )}

      {/* XP + Level */}
      <Card data-testid="coach-xp" elevation={0} sx={{ mb: 2.0, border: "1px solid rgba(2,6,23,0.10)", borderRadius: 2 }}>
        <CardContent>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ xs: "stretch", sm: "center" }} justifyContent="space-between">
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>Level {lvl.level}</Typography>
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

      {/* Daily Quests (viral) */}
      <Card elevation={0} sx={{ mb: 2.0, border: "1px solid rgba(2,6,23,0.10)", borderRadius: 2 }}>
        <CardContent>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ xs: "flex-start", sm: "center" }} justifyContent="space-between" sx={{ mb: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>🎯 Daily Quests</Typography>
            {!isPro && (
              <Button size="small" variant="outlined" sx={{ fontWeight: 900 }} onClick={() => setModalOpen(true)}>
                🔥 Unlock 5 Quests + smarter coaching
              </Button>
            )}
          </Stack>

          <Stack spacing={1.1}>
            {quests.map((q) => {
              const prog = q.progress({ mealsCount, burned, proteinSoFar, now });
              const done = !q.locked && q.complete({ mealsCount, burned, proteinSoFar, now });
              const pct = prog.goal ? clamp((prog.value / prog.goal) * 100, 0, 100) : 0;
              return (
                <Box key={q.id} sx={{ p: 1.2, borderRadius: 1.5, border: "1px solid rgba(2,6,23,0.08)", background: q.locked ? "rgba(2,6,23,0.03)" : done ? "rgba(2,6,23,0.04)" : "white" }}>
                  <Stack direction="row" spacing={1.2} alignItems="center">
                    <Box sx={{ width: 26, textAlign: "center", fontSize: 18 }}>{q.locked ? "🔒" : done ? "✅" : "🎯"}</Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 800, opacity: q.locked ? 0.65 : 1 }}>{q.label}</Typography>
                      <LinearProgress variant="determinate" value={q.locked ? 0 : pct} sx={{ mt: 0.9, height: 8, borderRadius: 999, backgroundColor: "rgba(2,6,23,0.06)" }} />
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.6 }}>
                        {q.locked ? "Pro quest (locked)" : `${Math.min(prog.value, prog.goal)} / ${prog.goal}`}
                      </Typography>
                    </Box>
                    {q.locked && (
                      <Button size="small" variant="contained" sx={{ fontWeight: 900 }} onClick={() => setModalOpen(true)}>
                        Unlock
                      </Button>
                    )}
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
