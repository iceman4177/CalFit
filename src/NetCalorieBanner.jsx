// src/NetCalorieBanner.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  Chip,
  Divider,
  LinearProgress,
} from '@mui/material';

const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

function todayUS() {
  try {
    return new Date().toLocaleDateString('en-US');
  } catch {
    return '';
  }
}

function localISODay(d = new Date()) {
  try {
    const dt = new Date(d);
    const localMidnight = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    return localMidnight.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function safeNum(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function readUserGoalCalories() {
  try {
    const ud = JSON.parse(localStorage.getItem('userData') || '{}') || {};
    const dg = safeNum(ud?.dailyGoal, 0);
    if (dg > 0) return Math.round(dg);
  } catch {}

  // legacy fallbacks
  const legacy = safeNum(localStorage.getItem('dailyGoal'), 0);
  return legacy > 0 ? Math.round(legacy) : 0;
}

/**
 * Read today's totals from the local-first caches that the app already writes:
 * - mealHistory (todayUS key) from MealTracker.persistToday
 * - workoutHistory (todayUS key) from WorkoutPage/saveWorkoutLocalFirst
 * - dailyMetricsCache (todayISO) as an extra fallback
 */
function readTodayTotals() {
  const dUS = todayUS();
  const dISO = localISODay();

  let eaten = 0;
  let burned = 0;

  // Meals: stored under mealHistory with date = todayUS
  try {
    const mh = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    const rec = Array.isArray(mh) ? mh.find(m => m?.date === dUS) : null;
    if (rec?.meals?.length) {
      eaten = rec.meals.reduce((s, m) => s + safeNum(m?.calories, 0), 0);
    }
  } catch {}

  // Workouts: stored under workoutHistory with date = todayUS
  try {
    const wh = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const arr = Array.isArray(wh) ? wh : [];
    burned = arr
      .filter(w => w?.date === dUS)
      .reduce((s, w) => s + safeNum(w?.totalCalories ?? w?.total_calories, 0), 0);
  } catch {}

  // Fallback: dailyMetricsCache for todayISO if either side is missing
  try {
    const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
    const row = cache?.[dISO];
    if (row) {
      if (!eaten) eaten = safeNum(row?.consumed ?? row?.eaten ?? row?.calories_eaten, eaten);
      if (!burned) burned = safeNum(row?.burned ?? row?.calories_burned, burned);
    }
  } catch {}

  return {
    dayUS: dUS,
    dayISO: dISO,
    eaten: Math.round(eaten || 0),
    burned: Math.round(burned || 0),
    goal: Math.round(readUserGoalCalories() || 0),
  };
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export default function NetCalorieBanner({ burned: burnedProp, consumed: consumedProp, goal: goalProp } = {}) {
  const [state, setState] = useState(() => {
    const base = readTodayTotals();
    return {
      ...base,
      eaten: (typeof consumedProp === 'number' && Number.isFinite(consumedProp)) ? Math.round(consumedProp) : base.eaten,
      burned: (typeof burnedProp === 'number' && Number.isFinite(burnedProp)) ? Math.round(burnedProp) : base.burned,
      goal: (typeof goalProp === 'number' && Number.isFinite(goalProp)) ? Math.round(goalProp) : base.goal,
    };
  });

  const recompute = useCallback(() => {
    const base = readTodayTotals();
    setState({
      ...base,
      eaten: (typeof consumedProp === 'number' && Number.isFinite(consumedProp)) ? Math.round(consumedProp) : base.eaten,
      burned: (typeof burnedProp === 'number' && Number.isFinite(burnedProp)) ? Math.round(burnedProp) : base.burned,
      goal: (typeof goalProp === 'number' && Number.isFinite(goalProp)) ? Math.round(goalProp) : base.goal,
    });
  }, [burnedProp, consumedProp, goalProp]);

  useEffect(() => {
    recompute();
  }, [recompute]);

  // Stay in sync with meal/workout logging + local-first updates
  useEffect(() => {
    const kick = () => recompute();
    const onStorage = (e) => {
      if (!e || !e.key) return;
      if (['mealHistory', 'workoutHistory', 'dailyMetricsCache', 'userData', 'dailyGoal'].includes(e.key)) kick();
    };
    const onVisOrFocus = () => recompute();

    window.addEventListener('slimcal:consumed:update', kick);
    window.addEventListener('slimcal:burned:update', kick);
    window.addEventListener('slimcal:streak:update', kick);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisOrFocus);
    window.addEventListener('focus', onVisOrFocus);

    return () => {
      window.removeEventListener('slimcal:consumed:update', kick);
      window.removeEventListener('slimcal:burned:update', kick);
      window.removeEventListener('slimcal:streak:update', kick);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisOrFocus);
      window.removeEventListener('focus', onVisOrFocus);
    };
  }, [recompute]);

  const eaten = state.eaten || 0;
  const burned = state.burned || 0;
  const goal = state.goal || 0;

  // Canonical math:
  // - Net = eaten - burned
  // - Remaining = goal - eaten + burned (MFP-style)
  const net = eaten - burned;
  const remaining = goal ? (goal - eaten + burned) : 0;

  const netPill =
    net > 0
      ? { label: `Net: +${nf0.format(net)} kcal`, color: 'error' }
      : net < 0
        ? { label: `Net: -${nf0.format(Math.abs(net))} kcal`, color: 'success' }
        : { label: 'Net: 0 kcal', color: 'info' };

  const ringPct = useMemo(() => {
    if (!goal) return 0;
    // Progress should feel intuitive: show how close you are to "remaining == 0"
    // remaining = goal - eaten + burned  => eaten - burned vs goal
    // effective = eaten - burned (net-in)
    const effective = eaten - burned;
    const pct = goal > 0 ? (effective / goal) * 100 : 0;
    return clamp(pct, 0, 120);
  }, [goal, eaten, burned]);

  const remainingLabel = goal
    ? `${nf0.format(Math.max(0, remaining))} left`
    : 'Set goal';

  return (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 2, sm: 2.25 },
        mb: 2,
        borderRadius: 3,
        border: '1px solid rgba(2,6,23,0.10)',
        background: 'rgba(2,6,23,0.02)',
      }}
      aria-label="Today's calories"
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 900, color: 'text.secondary' }}>
            Today
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 900, lineHeight: 1.1 }}>
            Calories
          </Typography>
        </Box>

        <Chip
          label={netPill.label}
          color={netPill.color}
          size="small"
          sx={{ fontWeight: 900, borderRadius: 999 }}
        />
      </Stack>

      <Divider sx={{ mb: 1.5 }} />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="stretch">
        {/* Remaining meter */}
        <Box
          sx={{
            flex: 1,
            borderRadius: 2,
            background: 'white',
            border: '1px solid rgba(2,6,23,0.08)',
            p: 1.5,
            minWidth: 240,
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 800, color: 'text.secondary' }}>
            Remaining = Goal − Food + Exercise
          </Typography>

          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 1.25 }}>
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontWeight: 950, fontSize: '1.8rem', lineHeight: 1.05 }}>
                {goal ? nf0.format(Math.max(0, remaining)) : '—'}
                <Typography component="span" sx={{ ml: 1, fontWeight: 900, color: 'text.secondary' }}>
                  kcal
                </Typography>
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {remainingLabel}
              </Typography>
            </Box>
          </Stack>

          <LinearProgress
            variant="determinate"
            value={goal ? clamp(ringPct, 0, 100) : 0}
            sx={{
              mt: 1.25,
              height: 10,
              borderRadius: 999,
              backgroundColor: 'rgba(2,6,23,0.06)',
            }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.6 }}>
            {goal ? `${nf0.format(eaten - burned)} / ${nf0.format(goal)} effective` : 'Add a daily goal to unlock remaining'}
          </Typography>
        </Box>

        {/* Breakdown chips */}
        <Stack
          spacing={1}
          sx={{
            width: { xs: '100%', sm: 260 },
            borderRadius: 2,
            background: 'white',
            border: '1px solid rgba(2,6,23,0.08)',
            p: 1.5,
          }}
        >
          <Chip
            variant="outlined"
            label={
              <Stack direction="row" justifyContent="space-between" sx={{ width: '100%' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <span role="img" aria-label="goal">🎯</span>
                  <Typography component="span" sx={{ fontWeight: 900 }}>Goal</Typography>
                </Box>
                <Typography component="span" sx={{ fontWeight: 950 }}>{nf0.format(goal || 0)} kcal</Typography>
              </Stack>
            }
            sx={{ borderRadius: 2, '& .MuiChip-label': { width: '100%' } }}
          />

          <Chip
            variant="outlined"
            label={
              <Stack direction="row" justifyContent="space-between" sx={{ width: '100%' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <span role="img" aria-label="food">🍽️</span>
                  <Typography component="span" sx={{ fontWeight: 900 }}>Food</Typography>
                </Box>
                <Typography component="span" sx={{ fontWeight: 950 }}>{nf0.format(eaten)} kcal</Typography>
              </Stack>
            }
            sx={{ borderRadius: 2, '& .MuiChip-label': { width: '100%' } }}
          />

          <Chip
            variant="outlined"
            label={
              <Stack direction="row" justifyContent="space-between" sx={{ width: '100%' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <span role="img" aria-label="exercise">🔥</span>
                  <Typography component="span" sx={{ fontWeight: 900 }}>Exercise</Typography>
                </Box>
                <Typography component="span" sx={{ fontWeight: 950 }}>{nf0.format(burned)} kcal</Typography>
              </Stack>
            }
            sx={{ borderRadius: 2, '& .MuiChip-label': { width: '100%' } }}
          />
        </Stack>
      </Stack>
    </Paper>
  );
}
