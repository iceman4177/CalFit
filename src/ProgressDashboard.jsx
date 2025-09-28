// src/ProgressDashboard.jsx
import React, { useEffect, useMemo, useState } from 'react';
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

// --- Client-side calorie proxy ----------------------------------------------
// Uses simple volume proxy: (weight * reps) summed over sets, scaled.
// Tune the SCALE later or replace with your MET+work formula if you start
// persisting more detailed fields per set.
const SCALE = 0.1; // kcal per (lb * rep) approx — tweak as needed

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

function toIsoDay(d = new Date()) {
  try { return new Date(d).toISOString().slice(0, 10); } catch { return d; }
}
function toUSDate(d) {
  try { return new Date(d).toLocaleDateString('en-US'); } catch { return d; }
}

export default function ProgressDashboard() {
  const { user } = useAuth();

  const [workouts, setWorkouts]           = useState([]); // unified shape: { dateLabel, totalCalories }
  const [burnedToday, setBurnedToday]     = useState(0);
  const [consumedToday, setConsumedToday] = useState(0);

  // ---- Local fallback (existing storage format) ----
  const local = useMemo(() => {
    const wh = JSON.parse(localStorage.getItem('workoutHistory') || '[]'); // [{date (US), totalCalories}]
    const mh = JSON.parse(localStorage.getItem('mealHistory') || '[]');    // [{date (US), meals:[{calories}]}]
    const todayUS = new Date().toLocaleDateString('en-US');

    const burned = wh.filter(w => w.date === todayUS).reduce((s, w) => s + (w.totalCalories || 0), 0);
    const mealsToday = mh.find(m => m.date === todayUS);
    const consumed = mealsToday ? (mealsToday.meals || []).reduce((s, m) => s + (m.calories || 0), 0) : 0;

    const ws = wh.map(w => ({
      dateLabel: w.date,
      totalCalories: w.totalCalories || 0,
    }));

    return { workouts: ws, burnedToday: burned, consumedToday: consumed };
  }, []);

  // ---- Load from Supabase (when signed in) and compute session kcal client-side ----
  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!user) {
        if (!ignore) {
          setWorkouts(local.workouts);
          setBurnedToday(local.burnedToday);
          setConsumedToday(local.consumedToday);
        }
        return;
      }
      try {
        // Fetch last N workouts
        const base = await getWorkouts(user.id, { limit: 200 });
        // For each workout, fetch its sets and compute calories with the proxy
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

        // Pull today's burned/consumed from daily_metrics
        const todayIso = toIsoDay();
        const dm = await getDailyMetricsRange(user.id, todayIso, todayIso);
        const row = dm?.[0];
        if (!ignore) {
          setBurnedToday(Math.round(row?.cals_burned || 0));
          setConsumedToday(Math.round(row?.cals_eaten || 0));
        }
      } catch (err) {
        console.error('[ProgressDashboard] Supabase fetch failed, using local fallback', err);
        if (!ignore) {
          setWorkouts(local.workouts);
          setBurnedToday(local.burnedToday);
          setConsumedToday(local.consumedToday);
        }
      }
    })();
    return () => { ignore = true; };
  }, [user, local]);

  // User goal from local (kept as-is)
  const userData = JSON.parse(localStorage.getItem('userData') || '{}');
  const goal = userData.dailyGoal || 0;

  const totalWorkouts = workouts.length;
  const totalCalories = workouts.reduce((acc, s) => acc + (s.totalCalories || 0), 0);

  const barData = {
    labels: workouts.map(s => s.dateLabel),
    datasets: [
      {
        label: 'Calories Burned (proxy)',
        data: workouts.map(s => s.totalCalories || 0),
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
        <Typography align="center" color="textSecondary">
          No workouts logged yet.
        </Typography>
      )}

      {/* Today’s goal progress (Supabase daily_metrics when signed in; local fallback otherwise) */}
      {goal > 0 && (
        <Paper elevation={3} sx={{ p: 3, mb: 6 }}>
          <Typography variant="h5" gutterBottom>
            Today’s Goal
          </Typography>
          <DailyGoalTracker burned={burnedToday} consumed={consumedToday} goal={goal} />
        </Paper>
      )}

      {/* 7-day net calorie trend (your existing component; can be wired to Supabase next) */}
      <WeeklyTrend />
    </Container>
  );
}
