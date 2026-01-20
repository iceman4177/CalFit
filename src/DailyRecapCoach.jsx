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
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
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
const SCALE = 0.1; // kcal per (lb * rep) proxy; tune/replace with MET later

function isoDay(d = new Date()) {
  // Local-day safe ISO string (prevents UTC rollover showing the wrong date in PST evenings)
  try {
    const dd = new Date(d);
    const localMidnight = new Date(dd.getFullYear(), dd.getMonth(), dd.getDate());
    return localMidnight.toISOString().slice(0, 10);
  } catch {
    return d;
  }
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

function estimateMacrosFromName({ name, qty = 0, unit = "", calories = 0 }) {
  const n = String(name || "").toLowerCase();
  let q = Math.max(0, Number(qty) || 0);

  // If qty wasn't stored, try to infer it from the name: "Eggs (6 eggs)" or "Eggs — 6 eggs"
  if (q <= 0) {
    const match = n.match(/(\d+)\s*egg/);
    if (match) q = Number(match[1]) || 0;
  }

  // If still unknown, infer from calories for eggs (70 kcal per egg)
  if (q <= 0 && n.includes("egg") && !n.includes("white")) {
    const c = Math.max(0, Number(calories) || 0);
    if (c > 0) q = Math.max(1, Math.round(c / 70));
  }

  // Large egg ~= 6g protein, 5g fat, 0.6g carbs
  if (n.includes("egg") && !n.includes("white")) {
    return {
      protein_g: Math.round(q * 6),
      fat_g: Math.round(q * 5),
      carbs_g: Math.round(q * 0.6),
    };
  }

  // Egg white ~= 3.6g protein
  if (n.includes("egg") && n.includes("white")) {
    return {
      protein_g: Math.round(q * 3.6),
      fat_g: Math.round(q * 0.1),
      carbs_g: Math.round(q * 0.2),
    };
  }

  return { protein_g: 0, carbs_g: 0, fat_g: 0 };
}

function mergeEstimatedMacros(existing, estimate) {
  const ex = existing || {};
  const est = estimate || {};
  return {
    protein_g: safeNum(ex.protein_g, 0) > 0 ? safeNum(ex.protein_g, 0) : safeNum(est.protein_g, 0),
    carbs_g: safeNum(ex.carbs_g, 0) > 0 ? safeNum(ex.carbs_g, 0) : safeNum(est.carbs_g, 0),
    fat_g: safeNum(ex.fat_g, 0) > 0 ? safeNum(ex.fat_g, 0) : safeNum(est.fat_g, 0),
  };
}


function estimateLocalMacrosForMeal(meal) {
  // Fallback when mealHistory doesn't include macros.
  // Keep this small + safe. Expand later.
  const name = String(meal?.name || "").toLowerCase();
  const qty = Number(meal?.qty ?? 0) || 0;

  // Eggs: ~6g protein, ~5g fat per large egg
  if (name.includes("egg")) {
    const q = qty > 0 ? qty : 1;
    return { protein_g: Math.round(q * 6), carbs_g: 0, fat_g: Math.round(q * 5) };
  }

  return { protein_g: 0, carbs_g: 0, fat_g: 0 };
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

    const est = estimateLocalMacrosForMeal(m);
    const proteinRaw = m.protein_g ?? m.protein;
    const carbsRaw = m.carbs_g ?? m.carbs;
    const fatRaw = m.fat_g ?? m.fat;

    const items = [
      {
        food_name: m.name || "Meal",
        qty: m.qty ?? 1,
        unit: m.unit || "serving",
        calories: round(m.calories || 0),
        protein: proteinRaw != null ? proteinRaw : est.protein_g,
        carbs: carbsRaw != null ? carbsRaw : est.carbs_g,
        fat: fatRaw != null ? fatRaw : est.fat_g,
      },
    ];

    const macros = sumMacros([
      {
        protein_g: safeNum(proteinRaw, 0) || est.protein_g,
        carbs_g: safeNum(carbsRaw, 0) || est.carbs_g,
        fat_g: safeNum(fatRaw, 0) || est.fat_g,
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
    const now = new Date();
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
        from: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).toISOString(),
        to: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString(),
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

      
      /* FALLBACK_LOCAL_MEALS */
      // If we have server totals (daily metrics) but no meal rows, use localStorage mealHistory
      if ((!meals || meals.length === 0) && (consumed > 0)) {
        try {
          const local = buildLocalContext(todayISO);
          if (Array.isArray(local?.meals) && local.meals.length > 0) {
            meals = local.meals;
          }
        } catch {}
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

      const system = `You are Slimcal Coach — a sharp, funny, no-BS fitness coach.

Your job: based on TODAY'S DATA, tell the user the next best move (eat / train / recover) to hit their goal.

Style:
- Confident, concise, slightly witty. No corny catchphrases, no "bestie" vibe.
- Light humor is OK, but keep it purposeful and motivating.
- Short punchy sections. If you roast, roast the *situation*, not the person.

Rules:
- Use ONLY the provided data. Do NOT invent foods or workouts.
- If something is missing (like macros/times), say what’s missing and give a practical fix.
- Be realistic about time of day. Late-day advice should be simple + doable.
- Always finish with 2–4 specific actions the user can do right now.

Output format (use these headings):
1) "Today’s Scoreboard" (calories eaten/burned/net + macro totals)
2) "What You Ate" (list each meal with time + items + macros)
3) "Training Check-In" (what was trained + quick note)
4) "Goal Progress" (daily kcal goal + how far off + protein target progress)
5) "Timing & Consistency" (comments on meal timing & gaps; practical fix)
6) "Next Move" (2–4 actionable steps + 2–3 foods to hit targets)
7) "Tomorrow’s Challenge" (one simple, winnable challenge)
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
            Daily Recap Coach • BUILD_STABLE_12
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

  return (
    <Box sx={{ p: 2, maxWidth: 900, mx: "auto" }}>
      {Inner}
    </Box>
  );
}

function Feature({ text }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Chip label="✓" size="small" variant="outlined" />
      <Typography variant="caption">{text}</Typography>
    
      {History}
</Stack>
  );
}
