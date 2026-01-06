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
import { getDailyMetricsRange, getWorkouts, getWorkoutSetsFor } from './lib/db';

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
  } catch {
    return null;
  }
}
function toLocalUSFromISO(isoYYYYMMDD) {
  try {
    const [y, m, d] = String(isoYYYYMMDD).split('-').map(Number);
    if (!y || !m || !d) return String(isoYYYYMMDD);
    return new Date(y, m - 1, d).toLocaleDateString('en-US');
  } catch {
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
function readLocalMealsByISO() {
  const meals = JSON.parse(localStorage.getItem('mealHistory') || '[]');
  const map = new Map(); // iso -> eaten
  for (const m of meals) {
    const dayISO = fromUSDateToISO(m.date);
    if (!dayISO) continue;
    const eaten = (m.meals || []).reduce((s, x) => s + (Number(x.calories) || 0), 0);
    map.set(dayISO, (map.get(dayISO) || 0) + eaten);
  }
  return map;
}
function readLocalWorkoutsByISO() {
  const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
  const map = new Map(); // iso -> burned
  for (const w of workouts) {
    const dayISO = fromUSDateToISO(w.date);
    if (!dayISO) continue;
    map.set(dayISO, (map.get(dayISO) || 0) + (Number(w.totalCalories) || 0));
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
  const [rows, setRows] = useState([]);

  const recompute = useCallback(async () => {
    const { from, to, days } = lastNDaysRange(7);

    // 1) Local always (instant)
    const eatenLocal = readLocalMealsByISO();
    const burnedLocal = readLocalWorkoutsByISO();
    let baseRows = buildRowsForDays(days, eatenLocal, burnedLocal, 'local');

    // If not signed in, we’re done
    if (!user) {
      setRows(baseRows);
      return;
    }

    // 2) Server daily_metrics (if you populate it)
    let serverDaily = [];
    try {
      const dm = await getDailyMetricsRange(user.id, from, to);
      serverDaily = (dm || []).map((r) => ({
        dayISO: r.day,
        eaten: Number(r.cals_eaten || 0),
        burned: Number(r.cals_burned || 0),
        net: (r.net_cals != null ? Number(r.net_cals) : (Number(r.cals_eaten || 0) - Number(r.cals_burned || 0))),
        _src: 'daily_metrics'
      }));
    } catch (e) {
      // no-op
      serverDaily = [];
    }

    // 3) Compute burned from Supabase workouts/sets for last 7 days (proxy),
    //    so you don’t get a flat 0 trend even when daily_metrics isn’t written.
    const burnedFromSets = new Map(); // iso -> burned
    try {
      const all = await getWorkouts(user.id, { limit: 300 });

      // Filter to last 7 days by local-day ISO
      const inWindow = (all || []).filter((w) => {
        const started = w.started_at || w.date || w.created_at;
        if (!started) return false;
        const dayISO = localDayISO(new Date(started));
        return dayISO >= from && dayISO <= to;
      });

      // Sum proxy calories by day
      await Promise.all(
        inWindow.map(async (w) => {
          const started = w.started_at || w.date || w.created_at;
          const dayISO = localDayISO(new Date(started));
          try {
            const sets = await getWorkoutSetsFor(w.id, user.id);
            const kcal = calcCaloriesFromSets(sets);
            if (kcal > 0) {
              burnedFromSets.set(dayISO, (burnedFromSets.get(dayISO) || 0) + kcal);
            }
          } catch {
            // ignore
          }
        })
      );
    } catch {
      // ignore
    }

    // 4) Merge priority per day:
    //    eaten: prefer daily_metrics if >0 else local
    //    burned: prefer daily_metrics if >0 else sets-proxy if >0 else local
    const serverMap = new Map(serverDaily.map(r => [r.dayISO, r]));
    const merged = baseRows.map((r) => {
      const s = serverMap.get(r.dayISO);

      const eaten =
        (s && Number(s.eaten) > 0) ? Number(s.eaten) : Number(r.eaten);

      const burnedProxy = Number(burnedFromSets.get(r.dayISO) || 0);

      const burned =
        (s && Number(s.burned) > 0)
          ? Number(s.burned)
          : (burnedProxy > 0 ? burnedProxy : Number(r.burned));

      return {
        dayISO: r.dayISO,
        eaten,
        burned,
        net: eaten - burned,
        _src: (s ? 'server+local' : 'local') + (burnedProxy > 0 ? '+sets' : '')
      };
    });

    setRows(merged);
  }, [user]);

  // Initial compute + live update hooks
  useEffect(() => {
    recompute();

    const onConsumed = () => recompute();
    const onBurned = () => recompute();
    const onVis = () => recompute();
    const onFocus = () => recompute();
    const onStorage = () => recompute();

    window.addEventListener('slimcal:consumed:update', onConsumed);
    window.addEventListener('slimcal:burned:update', onBurned);
    window.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('slimcal:consumed:update', onConsumed);
      window.removeEventListener('slimcal:burned:update', onBurned);
      window.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
    };
  }, [recompute]);

  const chartData = useMemo(() => {
    return {
      labels: rows.map((r) => toLocalUSFromISO(r.dayISO)),
      datasets: [
        {
          label: 'Net Calories',
          data: rows.map((r) => Number(r.net) || 0),
          borderColor: 'rgba(75,192,192,1)',
          fill: false
        }
      ]
    };
  }, [rows]);

  return (
    <Paper elevation={3} sx={{ p: 3 }}>
      <Typography variant="h5" gutterBottom>7-Day Net Calorie Trend</Typography>
      <Box sx={{ maxWidth: 800, mx: 'auto' }}>
        <Line data={chartData} />
      </Box>
    </Paper>
  );
}
