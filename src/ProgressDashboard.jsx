// src/ProgressDashboard.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Container, Typography, Box, Paper, Stack, Chip } from "@mui/material";
import LocalFireDepartmentRoundedIcon from "@mui/icons-material/LocalFireDepartmentRounded";
import RestaurantRoundedIcon from "@mui/icons-material/RestaurantRounded";
import FitnessCenterRoundedIcon from "@mui/icons-material/FitnessCenterRounded";
import TrendingUpRoundedIcon from "@mui/icons-material/TrendingUpRounded";
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

    const kcal =
      Number(w?.total_calories ?? w?.totalCalories ?? w?.calories_burned ?? w?.calories ?? w?.burned ?? 0) || 0;

    const key = String(w?.client_id || w?.id || i);
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

function metricChip(icon, label, value) {
  return {
    icon,
    label,
    value,
  };
}

export default function ProgressDashboard() {
  const { user } = useAuth();
  const uid = user?.id || null;

  const goalCalories = useMemo(() => readUserGoalCalories(0), []);

  const [burnedSeries, setBurnedSeries] = useState([]);
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

  const netToday = consumedToday - burnedToday;
  const statusLine = netToday > 0
    ? `You are ${Math.round(netToday)} kcal over burned today.`
    : netToday < 0
      ? `You are ${Math.round(Math.abs(netToday))} kcal under consumed today.`
      : "You are exactly even so far today.";

  const chartData = useMemo(() => ({
    labels: burnedSeries.map((r) => r.label),
    datasets: [
      {
        label: "Calories Burned",
        data: burnedSeries.map((r) => Number(r.total) || 0),
        backgroundColor: "rgba(45, 212, 191, 0.35)",
        borderColor: "rgba(45, 212, 191, 0.95)",
        borderWidth: 1,
        borderRadius: 8,
      },
    ],
  }), [burnedSeries]);

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: "rgba(255,255,255,0.08)" }, ticks: { color: "rgba(255,255,255,0.72)" } },
        x: { grid: { display: false }, ticks: { color: "rgba(255,255,255,0.72)" } },
      },
    }),
    []
  );

  const chips = [
    metricChip(<FitnessCenterRoundedIcon sx={{ fontSize: 18 }} />, "Workout days", summary.nonZeroDays),
    metricChip(<LocalFireDepartmentRoundedIcon sx={{ fontSize: 18 }} />, "Burned today", Math.round(burnedToday)),
    metricChip(<RestaurantRoundedIcon sx={{ fontSize: 18 }} />, "Consumed today", Math.round(consumedToday)),
    metricChip(<TrendingUpRoundedIcon sx={{ fontSize: 18 }} />, "Net today", `${netToday > 0 ? "+" : ""}${Math.round(netToday)}`),
  ];

  return (
    <Container maxWidth="md" sx={{ py: { xs: 2.5, md: 4 } }}>
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2.5, md: 3.5 },
          borderRadius: 4,
          background: "linear-gradient(180deg, rgba(19,28,41,0.96) 0%, rgba(12,18,27,0.98) 100%)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 18px 44px rgba(0,0,0,0.22)",
          textAlign: "center",
          mb: 3,
        }}
      >
        <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: -0.5 }}>
          Dashboard
        </Typography>
        <Typography variant="body1" sx={{ mt: 0.75, opacity: 0.84 }}>
          See how this week is trending and where today stands.
        </Typography>
        <Typography variant="body2" sx={{ mt: 1.25, opacity: 0.72 }}>
          {statusLine}
        </Typography>

        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          flexWrap="wrap"
          justifyContent="center"
          sx={{ mt: 2.25 }}
        >
          {chips.map((item) => (
            <Chip
              key={item.label}
              icon={item.icon}
              label={`${item.label}: ${item.value}`}
              sx={{
                borderRadius: 999,
                height: 34,
                bgcolor: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "inherit",
                ".MuiChip-icon": { color: "inherit" },
              }}
            />
          ))}
        </Stack>
      </Paper>

      <Paper
        elevation={0}
        sx={{
          p: { xs: 2.25, md: 3 },
          borderRadius: 4,
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 12px 30px rgba(0,0,0,0.16)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <Typography variant="overline" sx={{ display: "block", textAlign: "center", opacity: 0.65, letterSpacing: 1.3 }}>
          Weekly burn
        </Typography>
        <Typography variant="h6" align="center" sx={{ mt: 0.25, fontWeight: 800 }}>
          Calories burned over the last 7 days
        </Typography>
        <Typography variant="body2" align="center" sx={{ mt: 0.75, opacity: 0.72 }}>
          {summary.totalBurned.toFixed(0)} kcal burned across {summary.nonZeroDays} workout day{summary.nonZeroDays === 1 ? "" : "s"}.
        </Typography>
        <Box sx={{ height: 260, mt: 2 }}>
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
