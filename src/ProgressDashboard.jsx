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
    const [m, d, y] = String(us).split('/').map(Number);
    if (!m || !d || !y) return null;
    const dt = new Date(y, m - 1, d);
    return localDayISO(dt);
  } catch {
    return null;
  }
}
function toUSDate(isoLike) {
  try {
    if (typeof isoLike === 'string' && isoLike.includes('/') && isoLike.split('/').length === 3) {
      return isoLike;
    }
    return new Date(isoLike).toLocaleDateString('en-US');
  } catch {
    return String(isoLike);
  }
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

// Try to read a "total calories" field from server workout row if it exists
function readWorkoutCaloriesFallback(workoutRow) {
  if (!workoutRow || typeof workoutRow !== 'object') return 0;
  const candidates = [
    workoutRow.totalCalories,
    workoutRow.total_calories,
    workoutRow.calories,
    workoutRow.cals,
    workoutRow.cals_burned,
    workoutRow.calories_burned,
    workoutRow.kcal,
  ];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

// ---------------- Read local canonical stores -------------------------
function readConsumedByDay() {
  const mh = JSON.parse(localStorage.getItem('mealHistory') || '[]');
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
  const wh = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
  const map = new Map();
  for (const sess of wh) {
    const iso = fromUSDateToISO(sess.date);
    if (!iso) continue;
    map.set(iso, (map.get(iso) || 0) + (Number(sess.totalCalories) || 0));
  }
  return map;
}

function readLocalWorkoutSessions() {
  const wh = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
  return wh
    .map((w) => {
      const dayISO = fromUSDateToISO(w.date);
      return {
        dateLabel: String(w.date || ''),
        totalCalories: Number(w.totalCalories) || 0,
        _src: 'local',
        _dayISO: dayISO,
      };
    })
    .filter((x) => x.dateLabel && x._dayISO);
}

// Merge sessions then aggregate by day to avoid duplicate dates on chart
function mergeSessions(localSessions, serverSessions) {
  const out = [];
  const seen = new Set();

  const add = (s) => {
    const dayISO = s._dayISO || fromUSDateToISO(s.dateLabel) || null;
    const cal = Number(s.totalCalories) || 0;

    // De-dupe within each source by (dayISO + calories + src)
    const key = `${dayISO || 'na'}|${cal}|${s._src || 'na'}`;
    if (seen.has(key)) return;

    seen.add(key);
    out.push({
      dateLabel: s.dateLabel,
      totalCalories: cal,
      _src: s._src || 'unknown',
      _dayISO: dayISO,
    });
  };

  for (const s of localSessions || []) add(s);
  for (const s of serverSessions || []) add(s);

  return out;
}

function aggregateByDay(sessions) {
  // Combine all entries into ONE per dayISO
  const map = new Map(); // dayISO -> { totalCalories, sources:Set }
  for (const s of sessions || []) {
    if (!s?._dayISO) continue;
    const rec = map.get(s._dayISO) || { totalCalories: 0, sources: new Set() };
    rec.totalCalories += Number(s.totalCalories) || 0;
    rec.sources.add(s._src || 'unknown');
    map.set(s._dayISO, rec);
  }

  // Convert to sorted array
  const days = Array.from(map.entries()).map(([dayISO, rec]) => ({
    _dayISO: dayISO,
    dateLabel: toUSDate(dayISO), // NOTE: dayISO isn't a Date, but toUSDate handles string fallback
    // Better: convert ISO to local US date explicitly
    totalCalories: rec.totalCalories,
    _src: Array.from(rec.sources).join('+'),
  }));

  // Fix dateLabel properly as US date based on ISO day (avoid UTC drift)
  for (const d of days) {
    try {
      const [y, m, dd] = String(d._dayISO).split('-').map(Number);
      if (y && m && dd) d.dateLabel = new Date(y, m - 1, dd).toLocaleDateString('en-US');
    } catch {}
  }

  days.sort((a, b) => (a._dayISO < b._dayISO ? -1 : a._dayISO > b._dayISO ? 1 : 0));
  return days;
}

export default function ProgressDashboard() {
  const { user } = useAuth();

  // Bar chart DAYS (aggregated), and "Today" cards
  const [workouts, setWorkouts] = useState([]); // [{ dateLabel, totalCalories, _src, _dayISO }]
  const [burnedToday, setBurnedToday] = useState(0);
  const [consumedToday, setConsumedToday] = useState(0);

  const local = useMemo(() => {
    const todayUS = new Date().toLocaleDateString('en-US');
    const wh = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const mh = JSON.parse(localStorage.getItem('mealHistory') || '[]');

    const burned = wh.filter(w => w.date === todayUS)
      .reduce((s, w) => s + (Number(w.totalCalories) || 0), 0);

    const mealsToday = mh.find(m => m.date === todayUS);
    const consumed = mealsToday
      ? (mealsToday.meals || []).reduce((s, m) => s + (Number(m.calories) || 0), 0)
      : 0;

    const sessions = wh.map((w) => ({
      dateLabel: w.date,
      totalCalories: Number(w.totalCalories) || 0,
      _src: 'local',
      _dayISO: fromUSDateToISO(w.date) || null,
    })).filter(x => x._dayISO);

    return { workouts: aggregateByDay(sessions), burnedToday: burned, consumedToday: consumed };
  }, []);

  const recomputeTodayFromLocal = useCallback(() => {
    const today = localDayISO();
    const cBy = readConsumedByDay();
    const bBy = readBurnedByDay();

    let eaten = Number(cBy.get(today) || 0);
    let burned = Number(bBy.get(today) || 0);

    // ✅ FIX: if this device has no local history yet, fall back to hydrated cloud totals
    try {
      const ct = localStorage.getItem('consumedToday');
      const bt = localStorage.getItem('burnedToday');

      if ((!eaten || eaten === 0) && ct != null) eaten = Number(ct) || eaten;
      if ((!burned || burned === 0) && bt != null) burned = Number(bt) || burned;
    } catch {}

    setConsumedToday(eaten);
    setBurnedToday(burned);
  }, []);

  useEffect(() => {
    let ignore = false;

    (async () => {
      recomputeTodayFromLocal();

      // Always start with local aggregated days
      const localSessions = readLocalWorkoutSessions();
      if (!ignore) setWorkouts(aggregateByDay(localSessions));

      if (!user) return;

      try {
        const base = await getWorkouts(user.id, { limit: 200 });

        const serverSessions = await Promise.all(
          (base || []).map(async (w) => {
            let kcal = 0;
            try {
              const sets = await getWorkoutSetsFor(w.id, user.id);
              kcal = calcCaloriesFromSets(sets);
            } catch {
              kcal = 0;
            }
            if (!kcal || kcal <= 0) kcal = readWorkoutCaloriesFallback(w);

            const started = w.started_at || w.date || w.created_at;
            const dateLabel = toUSDate(started);
            const dayISO = fromUSDateToISO(dateLabel);

            return {
              dateLabel,
              totalCalories: Number(kcal) || 0,
              _src: 'server',
              _dayISO: dayISO,
            };
          })
        );

        // Merge then aggregate by day to remove duplicate 1/5 bars
        const mergedSessions = mergeSessions(localSessions, serverSessions);
        const dailyTotals = aggregateByDay(mergedSessions);

        if (!ignore) setWorkouts(dailyTotals);

        // refine today with server daily_metrics if present
        const todayIso = localDayISO();
        const dm = await getDailyMetricsRange(user.id, todayIso, todayIso);
        const row = dm?.[0];

        if (!ignore && row) {
          // ✅ FIX: support both new + legacy schemas
          const burnedNew = Number(row.calories_burned ?? row.burned ?? row.cals_burned ?? 0);
          const eatenNew = Number(row.calories_eaten ?? row.eaten ?? row.cals_eaten ?? 0);

          setBurnedToday((prev) => (burnedNew > 0 ? burnedNew : prev));
          setConsumedToday((prev) => (eatenNew > 0 ? eatenNew : prev));
        }
      } catch (err) {
        console.error('[ProgressDashboard] Supabase fetch failed, using local-only view', err);
        // keep local
      }
    })();

    return () => { ignore = true; };
  }, [user, local, recomputeTodayFromLocal]);

  useEffect(() => {
    const refresh = () => {
      recomputeTodayFromLocal();

      const localSessions = readLocalWorkoutSessions();
      setWorkouts((prev) => {
        // If prev is already daily totals, convert back to sessions is not possible,
        // so simplest is to rebuild from local and keep prev as additional days.
        // We merge by day here (sum).
        const prevMap = new Map((prev || []).map(d => [d._dayISO, d]));
        const localDaily = aggregateByDay(localSessions);

        for (const d of localDaily) {
          const existing = prevMap.get(d._dayISO);
          if (!existing) prevMap.set(d._dayISO, d);
          else {
            // Add local calories on top only if existing wasn’t already from local
            // (avoid runaway double-add when events fire)
            if (!String(existing._src || '').includes('local')) {
              prevMap.set(d._dayISO, {
                ...existing,
                totalCalories: Number(existing.totalCalories || 0) + Number(d.totalCalories || 0),
                _src: `${existing._src || 'server'}+local`
              });
            }
          }
        }

        const out = Array.from(prevMap.values());
        out.sort((a, b) => (a._dayISO < b._dayISO ? -1 : a._dayISO > b._dayISO ? 1 : 0));
        return out;
      });
    };

    window.addEventListener('slimcal:consumed:update', refresh);
    window.addEventListener('slimcal:burned:update', refresh);
    window.addEventListener('slimcal:net:update', refresh); // ✅ FIX: hydration dispatches this
    window.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);

    return () => {
      window.removeEventListener('slimcal:consumed:update', refresh);
      window.removeEventListener('slimcal:burned:update', refresh);
      window.removeEventListener('slimcal:net:update', refresh);
      window.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [recomputeTodayFromLocal]);

  const userData = JSON.parse(localStorage.getItem('userData') || '{}');
  const goal = Number(userData.dailyGoal || 0);

  const totalDays = workouts.length;
  const totalCalories = workouts.reduce((acc, s) => acc + (Number(s.totalCalories) || 0), 0);

  const barData = {
    labels: workouts.map((s) => s.dateLabel),
    datasets: [
      {
        label: 'Calories Burned (daily total)',
        data: workouts.map((s) => Number(s.totalCalories) || 0),
        backgroundColor: 'rgba(75, 192, 192, 0.6)'
      }
    ]
  };

  const barOptions = {
    responsive: true,
    plugins: {
      legend: { position: 'top' },
      title: { display: true, text: 'Calories Burned Per Day (local + server merged)' }
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h3" align="center" gutterBottom>
        Progress Dashboard
      </Typography>

      <Paper elevation={3} sx={{ p: 3, mb: 4 }}>
        <Typography variant="h5">Summary</Typography>
        <Typography variant="body1">Days With Workouts: {totalDays}</Typography>
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

      {goal > 0 && (
        <Paper elevation={3} sx={{ p: 3, mb: 6 }}>
          <Typography variant="h5" gutterBottom>
            Today’s Goal
          </Typography>
          <DailyGoalTracker burned={burnedToday} consumed={consumedToday} goal={goal} />
        </Paper>
      )}

      <WeeklyTrend />
    </Container>
  );
}
