// src/WeeklyTrend.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Paper, Typography, Box, Stack } from "@mui/material";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";

import { useAuth } from "./context/AuthProvider.jsx";
import { readScopedJSON, KEYS } from "./lib/scopedStorage.js";
import { buildWorkoutBurnedTotalsByDay } from "./lib/workoutHistoryTotals.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

function localDayISO(d = new Date()) {
  const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return ld.toISOString().slice(0, 10);
}
function dayISOFromAny(v) {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) return localDayISO(dt);
  return null;
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

export default function WeeklyTrend() {
  const { user } = useAuth();
  const uid = user?.id || null;
  const [rows, setRows] = useState([]);

  const recompute = useCallback(() => {
    const days = lastNDaysISO(7);
    const eatenByDay = buildMealTotalsByDay(uid);
    const burnedByDay = buildWorkoutBurnedTotalsByDay(uid);

    setRows(
      days.map((dayISO) => {
        const eaten = Number(eatenByDay.get(dayISO) || 0);
        const burned = Number(burnedByDay.get(dayISO) || 0);
        return { dayISO, net: eaten - burned };
      })
    );
  }, [uid]);

  useEffect(() => {
    recompute();
  }, [recompute]);

  const chart = useMemo(
    () => ({
      labels: rows.map((r) => isoToUS(r.dayISO)),
      datasets: [
        {
          label: "Net Calories",
          data: rows.map((r) => Number(r.net) || 0),
          tension: 0.35,
          borderColor: "rgba(99, 102, 241, 0.95)",
          backgroundColor: "rgba(99, 102, 241, 0.12)",
          pointBackgroundColor: "rgba(99, 102, 241, 0.95)",
          pointBorderColor: "#ffffff",
          pointBorderWidth: 2,
          pointRadius: 4,
          fill: true,
        },
      ],
    }),
    [rows]
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { displayColors: false },
      },
      scales: {
        y: {
          beginAtZero: false,
          grid: { color: "rgba(17,24,39,0.07)" },
          ticks: { precision: 0 },
        },
        x: { grid: { display: false } },
      },
    }),
    []
  );

  return (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 2.5, md: 4 },
        borderRadius: "32px",
        border: "1px solid rgba(15,23,42,0.06)",
      }}
    >
      <Stack spacing={1.25} alignItems="center" textAlign="center" sx={{ mb: 2.5 }}>
        <Typography sx={{ fontSize: 16, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6b7280", fontWeight: 700 }}>
          Net Trend
        </Typography>
        <Typography sx={{ fontSize: { xs: 28, md: 36 }, fontWeight: 900, color: "#0f172a" }}>
          7-day net calorie trend
        </Typography>
        <Typography sx={{ color: "#98a2b3", fontSize: { xs: 18, md: 20 } }}>
          Track how your intake versus burn is trending across the week.
        </Typography>
      </Stack>
      <Box sx={{ height: { xs: 260, md: 320 } }}>
        <Line data={chart} options={options} />
      </Box>
    </Paper>
  );
}
