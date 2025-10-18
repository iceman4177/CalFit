// src/ProgressDashboard.jsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Container, Typography, Box, Paper } from '@mui/material';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';
import WeeklyTrend from './WeeklyTrend';
import DailyGoalTracker from './DailyGoalTracker';

// ✅ Supabase auth + readers
import { useAuth } from './context/AuthProvider.jsx';
import { getWorkouts, getWorkoutSetsFor, getDailyMetricsRange } from './lib/db';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

// ---------------- Local-day helpers (avoid UTC drift) ----------------
function localDayISO(d = new Date()) {
  const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return ld.toISOString().slice(0, 10); // YYYY-MM-DD (LOCAL)
}
function fromUSDateToISO(us) {
  try {
    const [m, d, y] = us.split('/').map(Number);
    const dt = new Date(y, m - 1, d);
    return localDayISO(dt);
  } catch {
    return null;
  }
}
function toUSDate(isoLike) {
  try { return new Date(isoLike).toLocaleDateString('en-US'); } catch { return String(isoLike); }
}

// ---------------- Client-side calorie proxy for Supabase sets ----------
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

// ---------------- Read local canonical stores -------------------------
function readConsumedByDay() {
  const mh = JSON.parse(localStorage.getItem('mealHistory') || '[]'); // [{date:'M/D/YYYY', meals:[{calories}]}]
  const map = new Map();
  for (const day of mh) {
    const iso = fromUSDateToISO(day.date);
    if (!iso) continue;
    const total = (day.meals || []).reduce((s, m) => s + (Number(m.calories) || 0), 0);
    map.set(iso, (map.get(iso) || 0) + total);
  }
  return map;
}
function readBurnedByDay() {
  const wh = JSON.parse(localStorage.getItem('workoutHistory') || '[]'); // [{date:'M/D/YYYY', totalCalories}]
  const map = new Map();
  for (const sess of wh) {
    const iso = fromUSDateToISO(sess.date);
    if (!iso) continue;
    map.set(iso, (map.get(iso) || 0) + (Number(sess.totalCalories) || 0));
  }
  return map;
}

export default function ProgressDashboard() {
  const { user } = useAuth();

  // Bar chart sessions (per workout), and "Today" cards
  const [workouts, setWorkouts]           = useState([]); // [{ dateLabel, totalCalories }]
  const [burnedToday, setBurnedToday]     = useState(0);
  const [consumedToday, setConsumedToday] = useState(0);

  // Local fallback (used if not signed in or network fails)
  const local = useMemo(() => {
    const wh = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const mh = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    const todayUS = new Date().toLocaleDateString('en-US');

    const burned = wh.filter(w => w.date === todayUS)
                     .reduce((s, w) => s + (Number(w.totalCalories) || 0), 0);
    const mealsToday = mh.find(m => m.date === todayUS);
    const consumed = mealsToday
      ? (mealsToday.meals || []).reduce((s, m) => s + (Number(m.calories) || 0), 0)
      : 0;

    const ws = wh.map(w => ({
      dateLabel: w.date,
      totalCalories: Number(w.totalCalories) || 0,
    }));

    return { workouts: ws, burnedToday: burned, consumedToday: consumed };
  }, []);

  // --- Recompute today's burned/consumed from local canonical stores ---
  const recomputeTodayFromLocal = useCallback(() => {
    const today = localDayISO();
    const cBy = readConsumedByDay();
    const bBy = readBurnedByDay();
    setConsumedToday(Number(cBy.get(today) || 0));
    setBurnedToday(Number(bBy.get(today) || 0));
  }, []);

  // ---- Load from Supabase (when signed in) and compute session kcal client-side ----
  useEffect(() => {
    let ignore = false;
    (async () => {
      // Always show correct "today" immediately from local
      recomputeTodayFromLocal();

      if (!user) {
        if (!ignore) setWorkouts(local.workouts);
        return;
      }
      try {
        // Fetch last N workouts and compute calories
        const base = await getWorkouts(user.id, { limit: 200 });
        const withCals = await Promise.all(
          base.map(async w => {
            const sets = await getWorkoutSetsFor(w.id, user.id);
            return {
              dateLabel: toUSDate(w.started_at),
              totalCalories: calcCaloriesFromSets(sets),
            };
          })
        );
        if (!ignore) setWorkouts(withCals);

        // Try to refine "today" with server daily_metrics; if absent, keep local
        const todayIso = localDayISO();
        const dm = await getDailyMetricsRange(user.id, todayIso, todayIso);
        const row = dm?.[0];
        if (!ignore && row) {
          const burned = Number(row.cals_burned || 0);
          const eaten  = Number(row.cals_eaten  || 0);
          // Prefer server values only if they’re non-zero; otherwise stay local (live)
          setBurnedToday(prev => burned > 0 ? burned : prev);
          setConsumedToday(prev => eaten > 0 ? eaten : prev);
        }
      } catch (err) {
        console.error('[ProgressDashboard] Supabase fetch failed, using local fallback', err);
        if (!ignore) setWorkouts(local.workouts);
      }
    })();
    return () => { ignore = true; };
  }, [user, local, recomputeTodayFromLocal]);

  // ---- Live updates: listen to app events so dashboard reacts instantly ----
  useEffect(() => {
    const onConsumed = () => recomputeTodayFromLocal();
    const onBurned   = () => recomputeTodayFromLocal();
    const onVis      = () => recomputeTodayFromLocal();
    const onFocus    = () => recomputeTodayFromLocal();
    const onStorage  = () => recomputeTodayFromLocal();

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
  }, [recomputeTodayFromLocal]);

  // User goal from local (kept as-is)
  const userData = JSON.parse(localStorage.getItem('userData') || '{}');
  const goal = Number(userData.dailyGoal || 0);

  const totalWorkouts = workouts.length;
  const totalCalories = workouts.reduce((acc, s) => acc + (Number(s.totalCalories) || 0), 0);

  const barData = {
    labels: workouts.map(s => s.dateLabel),
    datasets: [
      {
        label: 'Calories Burned (proxy)',
        data: workouts.map(s => Number(s.totalCalories) || 0),
        backgroundColor: 'rgba(75, 192, 192, 0.6)'
      }
    ]
  };

  const barOptions = {
    responsive: true,
    plugins: {
      legend: { position: 'top' },
      title: { display: true, text: 'Calories Burned Per Workout (client-side proxy)' }
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h3" align="center" gutterBottom>
        Progress Dashboard
      </Typography>

      <Paper elevation={3} sx={{ p: 3, mb: 4 }}>
        <Typography variant="h5">Summary</Typography>
        <Typography variant="body1">Total Workouts: {totalWorkouts}</Typography>
        <Typography variant="body1">
          Total Calories Burned: {totalCalories.toFixed(2)}
        </Typography>
      </Paper>

      {workouts.length > 0 ? (
        <Box sx={{ maxWidth: 800, mx: 'auto', mb: 6 }}>
          <Bar data={barData} options={barOptions} />
        </Box>
      ) : (
        <Typography align="center" color="textSecondary" sx={{ mb: 6 }}>
          No workouts logged yet.
        </Typography>
      )}

      {/* Today’s goal progress (local-first; refined by Supabase if available) */}
      {goal > 0 && (
        <Paper elevation={3} sx={{ p: 3, mb: 6 }}>
          <Typography variant="h5" gutterBottom>
            Today’s Goal
          </Typography>
          <DailyGoalTracker burned={burnedToday} consumed={consumedToday} goal={goal} />
        </Paper>
      )}

      {/* 7-day net calorie trend (existing component) */}
      <WeeklyTrend />
    </Container>
  );
}
