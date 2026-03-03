// src/ProgressDashboard.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Container, Typography, Box, Paper } from "@mui/material";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

import { useAuth } from "./context/AuthProvider.jsx";
import { readScopedJSON, KEYS } from "./lib/scopedStorage.js";
import WeeklyTrend from "./WeeklyTrend.jsx";
import DailyGoalTracker from "./DailyGoalTracker.jsx";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

/* ---------------- Local-day helpers (stable, no UTC drift) ------------- */
function localDayISO(d = new Date()) {
  const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return ld.toISOString().slice(0, 10); // YYYY-MM-DD
}
function isoToUS(iso) {
  try {
    const [y, m, d] = String(iso).split("-").map(Number);
    if (!y || !m || !d) return String(iso);
    return new Date(y, m - 1, d).toLocaleDateString("en-US");
  } catch {
    return String(iso);
  }
}
function dayISOFromAny(v) {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) return localDayISO(dt);
  return null;
}
function lastNDaysISO(n = 7, end = new Date()) {
  const out = [];
  const base = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    out.push(localDayISO(d));
  }
  return out;
}


function safeNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function readUserGoalCalories(fallback = 0) {
  try {
    const raw = localStorage.getItem("userData");
    if (raw) {
      const obj = JSON.parse(raw);
      const g = safeNum(obj?.dailyGoal, NaN);
      if (Number.isFinite(g) && g > 0) return g;
    }
  } catch {}
  return safeNum(fallback, 0);
}

/* ---------------- Canonical local-first day totals --------------------- */
/**
 * Important: workoutHistory/mealHistory can contain duplicates (draft + final, or resync copies).
 * We dedupe by client_id when present, keeping the MAX calories for that client_id/day.
 */
function buildMealTotalsByDay(userId) {
  const mh = readScopedJSON(KEYS.mealHistory, userId, []) || [];
  const byDay = new Map(); // dayISO -> Map(client_id|idx -> calories)

  const put = (dayISO, key, calories) => {
    if (!dayISO || !calories) return;
    const m = byDay.get(dayISO) || new Map();
    const prev = Number(m.get(key) || 0);
    m.set(key, Math.max(prev, Number(calories) || 0));
    byDay.set(dayISO, m);
  };

  for (let i = 0; i < mh.length; i++) {
    const dayISO = dayISOFromAny(
      mh[i]?.local_day ||
        mh[i]?.__local_day ||
        mh[i]?.day ||
        mh[i]?.date ||
        mh[i]?.eaten_at ||
        mh[i]?.created_at
    );
    if (!dayISO) continue;

    // Day aggregate shape: { local_day, meals: [...] }
    const arr = Array.isArray(mh[i]?.meals)
      ? mh[i].meals
      : Array.isArray(mh[i]?.items)
        ? mh[i].items
        : null;

    if (arr && arr.length) {
      for (let j = 0; j < arr.length; j++) {
        const m = arr[j] || {};
        const kcal =
          Number(m?.calories ?? m?.cals ?? m?.total_calories ?? m?.totalCalories ?? m?.kcal ?? 0) || 0;
        const key = String(m?.client_id || m?.id || `${i}:${j}`);
        put(dayISO, key, kcal);
      }
      continue;
    }

    // Flat meal row shape
    const kcal =
      Number(
        mh[i]?.calories ??
          mh[i]?.cals ??
          mh[i]?.total_calories ??
          mh[i]?.totalCalories ??
          mh[i]?.kcal ??
          0
      ) || 0;
    const key = String(mh[i]?.client_id || mh[i]?.id || i);
    put(dayISO, key, kcal);
  }

  const totals = new Map();
  for (const [dayISO, m] of byDay.entries()) {
    let sum = 0;
    for (const v of m.values()) sum += Number(v) || 0;
    totals.set(dayISO, sum);
  }
  return totals;
}

function buildWorkoutTotalsByDay(userId) {
  const wh = readScopedJSON(KEYS.workoutHistory, userId, []) || [];
  const byDay = new Map(); // dayISO -> Map(client_id|idx -> calories)

  const put = (dayISO, key, calories) => {
    if (!dayISO || !calories) return;
    const m = byDay.get(dayISO) || new Map();
    const prev = Number(m.get(key) || 0);
    m.set(key, Math.max(prev, Number(calories) || 0));
    byDay.set(dayISO, m);
  };

  for (let i = 0; i < wh.length; i++) {
    const w = wh[i] || {};
    const dayISO = dayISOFromAny(
      w?.local_day || w?.__local_day || w?.day || w?.date || w?.started_at || w?.createdAt || w?.created_at
    );
    if (!dayISO) continue;

    const kcal =
      Number(w?.total_calories ?? w?.totalCalories ?? w?.calories_burned ?? w?.calories ?? w?.burned ?? 0) || 0;

    const key = String(w?.client_id || w?.id || i);

    // If there is a draft flag, exclude drafts (banner effectively does by keeping one deterministic per day)
    if (w?.isDraft || w?.draft === true || w?.status === "draft") continue;

    put(dayISO, key, kcal);
  }

  const totals = new Map();
  for (const [dayISO, m] of byDay.entries()) {
    let sum = 0;
    for (const v of m.values()) sum += Number(v) || 0;
    totals.set(dayISO, sum);
  }
  return totals;
}

export default function ProgressDashboard() {
  const { user } = useAuth();
  const uid = user?.id || null;

  const goalCalories = useMemo(() => readUserGoalCalories(0), []);

  const [burnedSeries, setBurnedSeries] = useState([]); // [{dayISO,label,total}]
  const [consumedToday, setConsumedToday] = useState(0);
  const [burnedToday, setBurnedToday] = useState(0);

  const recompute = useCallback(() => {
    const days = lastNDaysISO(7);
    const eatenByDay = buildMealTotalsByDay(uid);
    const burnedByDay = buildWorkoutTotalsByDay(uid);

    setConsumedToday(Number(eatenByDay.get(localDayISO()) || 0));
    setBurnedToday(Number(burnedByDay.get(localDayISO()) || 0));

    const rows = days.map((dayISO) => ({
      dayISO,
      label: isoToUS(dayISO),
      total: Number(burnedByDay.get(dayISO) || 0),
    }));
    setBurnedSeries(rows);
  }, [uid]);

  useEffect(() => {
    recompute();
  }, [recompute]);

  const summary = useMemo(() => {
    const nonZeroDays = burnedSeries.filter((r) => (Number(r.total) || 0) > 0).length;
    const totalBurned = burnedSeries.reduce((s, r) => s + (Number(r.total) || 0), 0);
    return { nonZeroDays, totalBurned };
  }, [burnedSeries]);

  const chartData = useMemo(() => {
    return {
      labels: burnedSeries.map((r) => r.label),
      datasets: [
        {
          label: "Calories Burned (daily total)",
          data: burnedSeries.map((r) => Number(r.total) || 0),
          backgroundColor: "rgba(45, 212, 191, 0.35)",
          borderColor: "rgba(45, 212, 191, 0.95)",
          borderWidth: 1,
          borderRadius: 8,
        },
      ],
    };
  }, [burnedSeries]);

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.06)' } }, x: { grid: { display: false } } },
    }),
    []
  );

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h5" align="center" sx={{ mb: 2 }}>
        Progress Dashboard
      </Typography>

      <Paper elevation={3} sx={{ p: 3, borderRadius: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Summary
        </Typography>
        <Typography variant="body2">Days With Workouts: {summary.nonZeroDays}</Typography>
        <Typography variant="body2">Total Calories Burned: {summary.totalBurned.toFixed(0)}</Typography>
      </Paper>

      <Paper elevation={3} sx={{ p: 3, borderRadius: 3, mt: 3 }}>
        <Typography variant="caption" sx={{ display: "block", mb: 1, opacity: 0.7, textAlign: "center" }}>
          Calories Burned Per Day (local canonical)
        </Typography>
        <Box sx={{ height: 260 }}>
          <Bar data={chartData} options={chartOptions} />
        </Box>
      </Paper>

      <Box sx={{ mt: 3 }}>
        <DailyGoalTracker burned={burnedToday} consumed={consumedToday} goal={goalCalories} />
      </Box>

      <WeeklyTrend />
    </Container>
  );
}
