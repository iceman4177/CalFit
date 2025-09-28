// src/DailyRecapCoach.jsx
import React, { useState, useEffect, useMemo } from "react";
import { Box, Button, CircularProgress, Typography } from "@mui/material";
import UpgradeModal from "./components/UpgradeModal";
import { useUserData } from "./UserDataContext";
import { useAuth } from "./context/AuthProvider.jsx";
import {
  getWorkouts,
  getWorkoutSetsFor,
  getDailyMetricsRange,
  getMeals,
} from "./lib/db";

// ---- Helpers ----------------------------------------------------------------
const SCALE = 0.1; // kcal per (lb * rep) proxy; tune/replace with your MET formula later

function isoDay(d = new Date()) {
  try {
    return new Date(d).toISOString().slice(0, 10);
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

function calcCaloriesFromSets(sets) {
  if (!Array.isArray(sets) || sets.length === 0) return 0;
  let vol = 0;
  for (const s of sets) {
    const w = Number(s.weight) || 0;
    const r = Number(s.reps) || 0;
    vol += w * r;
  }
  return Math.round(vol * SCALE);
}

// Build local fallback context for today
function buildLocalContext() {
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
        calories: Math.round(ex.calories || 0),
      });
    }
  }

  const mealsRec = mh.find((m) => m.date === todayUS);
  const meals =
    mealsRec?.meals?.map((m) => ({
      title: m.name || "Meal",
      total_calories: m.calories || 0,
      items: [], // local doesn't store items; optional
    })) || [];

  const burned = todayWorkouts.reduce((s, w) => s + (w.totalCalories || 0), 0);
  const consumed = meals.reduce((s, m) => s + (m.total_calories || 0), 0);

  return { burned, consumed, meals, workouts };
}

// -----------------------------------------------------------------------------

export default function DailyRecapCoach() {
  const { isPremium } = useUserData();
  const { user } = useAuth();

  const [loading, setLoading] = useState(false);
  const [recap, setRecap] = useState("");
  const [error, setError] = useState("");
  const [count, setCount] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

  const todayUS = useMemo(() => usDay(), []);
  const todayISO = useMemo(() => isoDay(), []);

  const storageKey = `recapUsage`;

  // Load today’s count on mount
  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
    if (stored.date === todayUS) setCount(stored.count);
    else setCount(0);
  }, [todayUS]);

  const incrementCount = () => {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
    const newCount = stored.date === todayUS ? (stored.count || 0) + 1 : 1;
    localStorage.setItem(storageKey, JSON.stringify({ date: todayUS, count: newCount }));
    setCount(newCount);
    return newCount;
  };

  // Build the recap context (Supabase if signed in; otherwise local)
  async function buildContext() {
    if (!user) {
      return buildLocalContext();
    }

    // ---- Supabase path ----
    // 1) Today’s daily metrics
    let burned = 0;
    let consumed = 0;
    try {
      const dm = await getDailyMetricsRange(user.id, todayISO, todayISO);
      const row = dm?.[0];
      burned = Math.round(row?.cals_burned || 0);
      consumed = Math.round(row?.cals_eaten || 0);
    } catch (e) {
      console.warn("[DailyRecapCoach] getDailyMetricsRange failed, continuing", e);
    }

    // 2) Today’s workouts → sets → client-side kcal proxy
    const workouts = [];
    try {
      const ws = await getWorkouts(user.id, { limit: 30 });
      const todays = ws.filter((w) => (w.started_at || "").slice(0, 10) === todayISO);
      for (const w of todays) {
        const sets = await getWorkoutSetsFor(w.id, user.id);
        const kcal = calcCaloriesFromSets(sets);
        // represent as per-set lines so the coach can see details
        if (Array.isArray(sets) && sets.length > 0) {
          for (const s of sets) {
            workouts.push({
              exercise_name: s.exercise_name,
              reps: s.reps || 0,
              weight: s.weight || 0,
              calories: kcal, // same estimate per workout; simple but effective for recap tone
            });
          }
        } else {
          // no sets captured → still include workout-level estimate
          workouts.push({
            exercise_name: "Workout session",
            reps: 0,
            weight: 0,
            calories: kcal,
          });
        }
      }
    } catch (e) {
      console.warn("[DailyRecapCoach] workouts fetch failed, continuing", e);
    }

    // 3) Today’s meals (summary level; items optional)
    const meals = [];
    try {
      const mealsAll = await getMeals(user.id, {
        from: todayISO,
        to: todayISO,
        limit: 100,
      });
      for (const m of mealsAll) {
        meals.push({
          title: m.title || "Meal",
          total_calories: Math.round(m.total_calories || 0),
          items: [], // if you later add a reader for meal_items, fill this in
        });
      }
    } catch (e) {
      console.warn("[DailyRecapCoach] meals fetch failed, continuing", e);
    }

    return { burned, consumed, meals, workouts };
  }

  const handleGetRecap = async () => {
    // Free users: max 3/day
    if (!isPremium && count >= 3) {
      setModalOpen(true);
      return;
    }
    if (!isPremium) incrementCount();

    setLoading(true);
    setError("");
    setRecap("");

    try {
      const ctx = await buildContext();

      // Build a short human summary for the prompt
      let lines = [];
      if (ctx.workouts?.length) {
        const sample = ctx.workouts.slice(0, 8).map(
          (w) =>
            `- ${w.exercise_name}: ${w.reps ? `${w.reps} reps` : ""}${
              w.weight ? ` × ${w.weight} lb` : ""
            }${w.calories ? ` (${w.calories} cal est.)` : ""}`.trim()
        );
        lines.push(`Workouts logged today:\n${sample.join("\n")}`);
      }
      if (ctx.meals?.length) {
        const sampleM = ctx.meals.slice(0, 6).map(
          (m) => `- ${m.title}: ${m.total_calories || 0} cal`
        );
        lines.push(`Meals logged today:\n${sampleM.join("\n")}`);
      }
      lines.push(
        `Calories today — burned: ${ctx.burned || 0}, eaten: ${ctx.consumed || 0}, net: ${(ctx.consumed || 0) - (ctx.burned || 0)}.`
      );

      const userContent =
        lines.length === 0
          ? "I haven't logged any workout today. Can you suggest a full-body workout plan for me?"
          : `Here’s my day:\n${lines.join(
              "\n\n"
            )}\n\nPlease give me a concise, upbeat recap and 2–3 actionable tips (training or nutrition).`;

      // Call your OpenAI-backed API with structured context
      const res = await fetch("/api/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "You are a friendly, practical fitness coach." },
            { role: "user", content: userContent },
          ],
          context: ctx, // 🔥 new: pass structured context for the API to append
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
    } catch (err) {
      console.error("Recap error:", err);
      setError(err.message || "Sorry, I couldn’t generate your daily recap right now.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 2, textAlign: "center" }}>
      <Button variant="contained" onClick={handleGetRecap} disabled={loading}>
        {loading ? <CircularProgress size={24} /> : "Get Daily Recap"}
      </Button>

      {error && (
        <Typography color="error" sx={{ mt: 2 }}>
          {error}
        </Typography>
      )}

      {recap && (
        <Typography sx={{ mt: 3, whiteSpace: "pre-wrap" }}>
          {recap}
        </Typography>
      )}

      <UpgradeModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </Box>
  );
}
