// src/ProgressDashboard.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Container, Typography, Box, Paper, Stack, Chip } from "@mui/material";
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
import { ensureScopedProfileFromLegacy, readProfileBundle } from "./lib/profileStorage.js";
import WeeklyTrend from "./WeeklyTrend.jsx";
import DailyGoalTracker from "./DailyGoalTracker.jsx";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

function localDayISO(d = new Date()) {
  const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return ld.toISOString().slice(0, 10);
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
function readUserGoalCalories(userId, fallback = 0) {
  try {
    if (userId) ensureScopedProfileFromLegacy(userId);
    const profile = readProfileBundle(userId);
    const g = safeNum(profile?.userData?.dailyGoal, NaN);
    if (Number.isFinite(g) && g > 0) return g;
  } catch {}
  return safeNum(fallback, 0);
}

function buildMealTotalsByDay(userId) {
  const mh = readScopedJSON(KEYS.mealHistory, userId, []) || [];
  const byDay = new Map();

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
  const byDay = new Map();

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

    if (w?.isDraft || w?.draft === true || w?.status === "draft") continue;

    const kcal =
      Number(w?.total_calories ?? w?.totalCalories ?? w?.calories_burned ?? w?.calories ?? w?.burned ?? 0) || 0;
    const key = String(w?.client_id || w?.id || i);
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

function fmtKcal(v) {
  const n = Number(v) || 0;
  return `${n >= 0 ? "+" : ""}${Math.round(n)} kcal`;
}

export default function ProgressDashboard() {
  const { user } = useAuth();
  const uid = user?.id || null;

  const goalCalories = useMemo(() => readUserGoalCalories(uid, 0), [uid]);
  const [burnedSeries, setBurnedSeries] = useState([]);
  const [consumedToday, setConsumedToday] = useState(0);
  const [burnedToday, setBurnedToday] = useState(0);

  const recompute = useCallback(() => {
    const days = lastNDaysISO(7);
    const eatenByDay = buildMealTotalsByDay(uid);
    const burnedByDay = buildWorkoutTotalsByDay(uid);

    setConsumedToday(Number(eatenByDay.get(localDayISO()) || 0));
    setBurnedToday(Number(burnedByDay.get(localDayISO()) || 0));

    setBurnedSeries(
      days.map((dayISO) => ({
        dayISO,
        label: isoToUS(dayISO),
        total: Number(burnedByDay.get(dayISO) || 0),
      }))
    );
  }, [uid]);

  useEffect(() => {
    recompute();
  }, [recompute]);

  const summary = useMemo(() => {
    const nonZeroDays = burnedSeries.filter((r) => (Number(r.total) || 0) > 0).length;
    const totalBurned = burnedSeries.reduce((s, r) => s + (Number(r.total) || 0), 0);
    return { nonZeroDays, totalBurned };
  }, [burnedSeries]);

  const netToday = consumedToday - burnedToday;
  const todayStatus =
    netToday > 0
      ? `You are ${Math.round(netToday)} kcal above burned so far.`
      : netToday < 0
        ? `You are ${Math.round(Math.abs(netToday))} kcal under burned so far.`
        : `You are perfectly balanced so far today.`;

  const chartData = useMemo(
    () => ({
      labels: burnedSeries.map((r) => r.label),
      datasets: [
        {
          label: "Calories Burned",
          data: burnedSeries.map((r) => Number(r.total) || 0),
          backgroundColor: "rgba(45, 212, 191, 0.35)",
          borderColor: "rgba(45, 212, 191, 0.95)",
          borderWidth: 1,
          borderRadius: 10,
          barThickness: 42,
          maxBarThickness: 48,
        },
      ],
    }),
    [burnedSeries]
  );

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { displayColors: false },
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: "rgba(17,24,39,0.07)" },
          ticks: { precision: 0 },
        },
        x: { grid: { display: false } },
      },
    }),
    []
  );

  const summaryChips = [
    `Workout days: ${summary.nonZeroDays}`,
    `Burned today: ${Math.round(burnedToday)}`,
    `Consumed today: ${Math.round(consumedToday)}`,
    `Net today: ${fmtKcal(netToday)}`,
  ];

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 2.5, md: 4 } }}>
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2.5, md: 4 },
          borderRadius: "32px",
          border: "1px solid rgba(15,23,42,0.06)",
          mb: 3,
          background: "linear-gradient(180deg, #f9fbff 0%, #ffffff 100%)",
        }}
      >
        <Stack spacing={2} alignItems="center" textAlign="center">
          <Typography
            sx={{
              fontSize: { xs: 16, md: 18 },
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#6b7280",
              fontWeight: 700,
            }}
          >
            Dashboard
          </Typography>
          <Typography sx={{ fontSize: { xs: 34, md: 48 }, fontWeight: 900, lineHeight: 1, color: "#0f172a" }}>
            See how this week is trending.
          </Typography>
          <Typography sx={{ maxWidth: 760, fontSize: { xs: 18, md: 22 }, color: "#667085", lineHeight: 1.45 }}>
            {todayStatus}
          </Typography>
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 1.25,
              justifyContent: "center",
              pt: 0.5,
            }}
          >
            {summaryChips.map((label) => (
              <Chip
                key={label}
                label={label}
                sx={{
                  px: 0.75,
                  height: 38,
                  borderRadius: 999,
                  bgcolor: "#f8fafc",
                  border: "1px solid rgba(15,23,42,0.08)",
                  fontWeight: 800,
                  color: "#0f172a",
                  fontSize: 15,
                }}
              />
            ))}
          </Box>
        </Stack>
      </Paper>

      <Paper
        elevation={0}
        sx={{
          p: { xs: 2.5, md: 4 },
          borderRadius: "32px",
          border: "1px solid rgba(15,23,42,0.06)",
          mb: 3,
        }}
      >
        <Stack spacing={1.25} alignItems="center" textAlign="center" sx={{ mb: 2.5 }}>
          <Typography sx={{ fontSize: 16, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6b7280", fontWeight: 700 }}>
            Weekly Burn
          </Typography>
          <Typography sx={{ fontSize: { xs: 28, md: 36 }, fontWeight: 900, color: "#0f172a" }}>
            Calories burned over the last 7 days
          </Typography>
          <Typography sx={{ color: "#98a2b3", fontSize: { xs: 18, md: 20 } }}>
            {Math.round(summary.totalBurned)} kcal burned across {summary.nonZeroDays} workout day{summary.nonZeroDays === 1 ? "" : "s"}.
          </Typography>
        </Stack>
        <Box sx={{ height: { xs: 260, md: 320 } }}>
          <Bar data={chartData} options={chartOptions} />
        </Box>
      </Paper>

      <DailyGoalTracker burned={burnedToday} consumed={consumedToday} goal={goalCalories} />

      <WeeklyTrend />
    </Container>
  );
}
