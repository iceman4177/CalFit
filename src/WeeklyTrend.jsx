// src/WeeklyTrend.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Paper, Typography, Box } from "@mui/material";
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

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

/* ---------------- Local-day helpers (stable, no UTC drift) ------------- */
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

/* ---------------- Canonical local-first day totals --------------------- */
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

export default function WeeklyTrend() {
  const { user } = useAuth();
  const uid = user?.id || null;

  const [rows, setRows] = useState([]); // [{dayISO, net}]

  const recompute = useCallback(() => {
    const days = lastNDaysISO(7);
    const eatenByDay = buildMealTotalsByDay(uid);
    const burnedByDay = buildWorkoutTotalsByDay(uid);

    const out = days.map((dayISO) => {
      const eaten = Number(eatenByDay.get(dayISO) || 0);
      const burned = Number(burnedByDay.get(dayISO) || 0);
      return { dayISO, net: eaten - burned };
    });
    setRows(out);
  }, [uid]);

  useEffect(() => {
    recompute();
  }, [recompute]);

  const chart = useMemo(() => {
    return {
      labels: rows.map((r) => isoToUS(r.dayISO)),
      datasets: [
        {
          label: "Net Calories",
          data: rows.map((r) => Number(r.net) || 0),
          tension: 0.25,
        },
      ],
    };
  }, [rows]);

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: false } },
    }),
    []
  );

  return (
    <Paper elevation={3} sx={{ p: 3, borderRadius: 3, mt: 3 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        7-Day Net Calorie Trend
      </Typography>
      <Box sx={{ height: 260 }}>
        <Line data={chart} options={options} />
      </Box>
    </Paper>
  );
}
