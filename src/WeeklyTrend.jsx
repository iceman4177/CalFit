// src/WeeklyTrend.jsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Paper, Typography, Box } from '@mui/material';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Title
} from 'chart.js';

import { useAuth } from './context/AuthProvider.jsx';
import { getDailyMetricsRange, getWorkouts } from './lib/db';
import { readScopedJSON, KEYS } from './lib/scopedStorage.js';


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

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Title);

/* ---------------- Local-day helpers (stable, no UTC drift) ------------- */
function localDayISO(d = new Date()) {
  const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return ld.toISOString().slice(0, 10);
}
function fromUSDateToISO(us) {
  try {
    const [m, d, y] = String(us).split('/').map(Number);
    if (!m || !d || !y) return null;
    return localDayISO(new Date(y, m - 1, d));
  } catch (e) {
    return null;
  }
}
function toLocalUSFromISO(isoYYYYMMDD) {
  try {
    const [y, m, d] = String(isoYYYYMMDD).split('-').map(Number);
    if (!y || !m || !d) return String(isoYYYYMMDD);
    return new Date(y, m - 1, d).toLocaleDateString('en-US');
  } catch (e) {
    return String(isoYYYYMMDD);
  }
}
function lastNDaysList(n = 7) {
  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    days.push(localDayISO(d));
  }
  return days;
}
function lastNDaysRange(n = 7) {
  const days = lastNDaysList(n);
  return { from: days[0], to: days[days.length - 1], days };
}

/* ---------------- Calories proxy from sets ---------------------------- */
const SCALE = 0.1; // kcal per (lb * rep)
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

/* ---------------- Local reads (meals + workoutHistory fallback) -------- */
function readLocalMealsByISO(userId = null) {
  const mh = readScopedJSON(KEYS.mealHistory, userId, []) || [];
  const map = new Map(); // iso -> cals
  for (const m of mh) {
    const dayISO = String(m?.local_day || m?.dayISO || m?.day || "") || null;
    const us = m?.date || m?.dateLabel || null;
    const iso = dayISO || fromUSDateToISO(us) || null;
    if (!iso) continue;
    const cals = Number(m?.calories ?? m?.cals ?? m?.total_calories ?? 0) || 0;
    if (cals <= 0) continue;
    map.set(iso, (map.get(iso) || 0) + cals);
  }
  return map;
}
function readLocalWorkoutsByISO(userId = null) {
  const wh = readScopedJSON(KEYS.workoutHistory, userId, []) || [];
  const map = new Map(); // iso -> burned
  for (const w of wh) {
    const dayISO = String(w?.local_day || w?.dayISO || w?.day || "") || null;
    const us = w?.date || w?.dateLabel || null;
    const iso = dayISO || fromUSDateToISO(us) || null;
    if (!iso) continue;
    const kcal = Number(w?.total_calories ?? w?.totalCalories ?? w?.calories_burned ?? w?.burned ?? 0) || 0;
    if (kcal <= 0) continue;
    map.set(iso, (map.get(iso) || 0) + kcal);
  }
  return map;
}

/* ---------------- Build rows for the chart ---------------------------- */
function buildRowsForDays(daysISO, eatenMap, burnedMap, srcLabel = 'local') {
  return daysISO.map((dayISO) => {
    const eaten = Number(eatenMap.get(dayISO) || 0);
    const burned = Number(burnedMap.get(dayISO) || 0);
    return {
      dayISO,
      eaten,
      burned,
      net: eaten - burned,
      _src: srcLabel
    };
  });
}


export default function WeeklyTrend() {
  const { user } = useAuth();

  const [series, setSeries] = useState([]); // [{ dayISO, net, consumed, burned }]

  const recompute = useCallback(async () => {
    const uid = user?.id || null;
    const days = lastNDaysISO(7);

    // Local-first totals (canonical)
    const consumedMap = readScopedJSON(KEYS.mealHistory, uid, []) || [];
    const burnedMap = readScopedJSON(KEYS.workoutHistory, uid, []) || [];

    const sumMealsForDay = (dayISO) => {
      let total = 0;
      for (const day of consumedMap) {
        const d = String(day?.local_day || day?.dayISO || day?.day || "") || null;
        if (d !== dayISO) continue;
        const top = Number(day?.calories ?? day?.cals ?? day?.total_calories ?? day?.totalCalories ?? 0) || 0;
        if (top) { total += top; continue; }
        const arr = Array.isArray(day?.meals) ? day.meals : (Array.isArray(day?.items) ? day.items : []);
        total += arr.reduce((s, m) => s + (Number(m?.calories ?? m?.cals ?? m?.total_calories ?? m?.kcal ?? 0) || 0), 0);
      }
      return total;
    };

    const sumWorkoutsForDay = (dayISO) => {
      let total = 0;
      for (const w of burnedMap) {
        const d = String(w?.local_day || w?.dayISO || w?.day || "") || null;
        if (d !== dayISO) continue;
        total += Number(w?.total_calories ?? w?.totalCalories ?? w?.calories_burned ?? w?.burned ?? 0) || 0;
      }
      return total;
    };

    let rows = days.map((dayISO) => {
      const consumed = sumMealsForDay(dayISO);
      const burned = sumWorkoutsForDay(dayISO);
      return { dayISO, consumed, burned, net: consumed - burned, _src: "local" };
    });

    // Server fallback ONLY when local has no signal for that day
    try {
      const { data: dmRows } = await getDailyMetricsRange(days[0], days[days.length - 1]);
      const dm = Array.isArray(dmRows) ? dmRows : [];
      const byDay = new Map();
      for (const r of dm) {
        const dayISO = String(r?.local_day || r?.dayISO || r?.day || "");
        if (!dayISO) continue;
        const eaten = Number(r?.calories_eaten ?? r?.caloriesConsumed ?? r?.consumed ?? r?.food ?? 0) || 0;
        const burned = Number(r?.calories_burned ?? r?.caloriesBurned ?? r?.burned ?? r?.exercise ?? 0) || 0;
        const net = Number(r?.net_calories ?? (eaten - burned) ?? 0) || (eaten - burned);
        byDay.set(dayISO, { eaten, burned, net });
      }

      rows = rows.map((r) => {
        if ((r.consumed || r.burned) !== 0) return r; // local wins
        const s = byDay.get(r.dayISO);
        if (!s) return r;
        if ((s.eaten || s.burned) === 0) return r;
        return { dayISO: r.dayISO, consumed: s.eaten, burned: s.burned, net: s.net, _src: "server" };
      });
    } catch (e) {
      // ignore; local-only is fine
    }

    setSeries(rows);
  }, [user]);

  useEffect(() => { recompute(); }, [recompute]);

  const chart = useMemo(() => {
    const labels = (series || []).map((r) => {
      try {
        const [y, m, d] = String(r.dayISO).split("-").map(Number);
        return new Date(y, m - 1, d).toLocaleDateString("en-US");
      } catch {
        return r.dayISO;
      }
    });
    const data = (series || []).map((r) => Number(r.net) || 0);

    return {
      labels,
      datasets: [
        {
          label: "Net Calories",
          data,
          tension: 0.25,
        },
      ],
    };
  }, [series]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true },
      title: { display: false },
    },
    scales: {
      y: { beginAtZero: false },
    },
  }), []);

  return (
    <Paper elevation={3} sx={{ p: 3, borderRadius: 3, mt: 3 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>7-Day Net Calorie Trend</Typography>
      <Box sx={{ height: 280 }}>
        <Line data={chart} options={options} />
      </Box>
    </Paper>
  );
}

