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
 * - mealHistory
 * - workoutHistory
 * - dailyMetricsCache
 * - burnedToday / consumedToday (hydrated truth keys)
 */
function readTodayTotals() {
  const dUS = todayUS();
  const dISO = localISODay();

  let eatenNow = 0;
  let burnedNow = 0;

  // Meals
  try {
    const mh = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    const rec = Array.isArray(mh)
      ? mh.find(m => m?.date === dUS || m?.date === dISO)
      : null;
    if (rec?.meals?.length) {
      eatenNow = rec.meals.reduce((s, m) => s + safeNum(m?.calories, 0), 0);
    }
  } catch {}

  // Workouts
  try {
    const wh = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const arr = Array.isArray(wh) ? wh : [];
    burnedNow = arr
      .filter(w => w?.date === dUS || w?.date === dISO)
      .reduce((s, w) => s + safeNum(w?.totalCalories ?? w?.total_calories, 0), 0);
  } catch {}

  // dailyMetricsCache
  try {
    const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
    const row = cache?.[dISO];
    if (row) {
      const eatenFromCache = safeNum(
        row?.consumed ??
          row?.eatenNow ??
          row?.calories_eaten ??
          row?.cals_eaten ??
          row?.food ??
          row?.caloriesConsumed,
        NaN
      );

      const burnedFromCache = safeNum(
        row?.burnedNow ??
          row?.calories_burned ??
          row?.cals_burned ??
          row?.exercise ??
          row?.caloriesBurned,
        NaN
      );

      if (Number.isFinite(eatenFromCache)) eatenNow = eatenFromCache;
      if (Number.isFinite(burnedFromCache)) {
        // Avoid flicker: don't let a stale 0 clobber a non-zero computed-from-history value.
        if (burnedFromCache > 0 || burnedNow === 0) burnedNow = burnedFromCache;
      }
    }
  } catch {}

  // ✅ burnedToday / consumedToday — strongest truth keys
  try {
    const eatenDirect = safeNum(localStorage.getItem('consumedToday'), NaN);
    if (Number.isFinite(eatenDirect)) eatenNow = eatenDirect;
  } catch {}

  try {
    const burnedDirect = safeNum(localStorage.getItem('burnedToday'), NaN);
    if (Number.isFinite(burnedDirect)) {
      // Avoid flicker: don't let a stale 0 clobber a non-zero computed-from-history value.
      if (burnedDirect > 0 || burnedNow === 0) burnedNow = burnedDirect;
    }
  } catch {}

  return {
    dayUS: dUS,
    dayISO: dISO,
    eatenNow: Math.round(eatenNow || 0),
    burnedNow: Math.round(burnedNow || 0),
    goalNow: Math.round(readUserGoalCalories() || 0),
  };
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

// ✅ Only override local totals if prop is "meaningfully set"
function preferProp(propVal, baseVal) {
  if (typeof propVal !== 'number' || !Number.isFinite(propVal)) return baseVal;
  const p = Math.round(propVal);

  // If parent is still sitting at 0 but local storage has real data, trust local.
  if (p === 0 && baseVal > 0) return baseVal;

  return p;
}

export default function NetCalorieBanner({ burnedNow: burnedProp, consumed: consumedProp, goalNow: goalProp } = {}) {
  const [state, setState] = useState(() => {
    const base = readTodayTotals();
    return {
      ...base,
      eatenNow: preferProp(consumedProp, base.eatenNow),
      burnedNow: preferProp(burnedProp, base.burnedNow),
      goalNow: (typeof goalProp === 'number' && Number.isFinite(goalProp) && goalProp > 0)
        ? Math.round(goalProp)
        : base.goalNow,
    };
  });

  const recompute = useCallback(() => {
    const base = readTodayTotals();
    setState({
      ...base,
      eatenNow: preferProp(consumedProp, base.eatenNow),
      burnedNow: preferProp(burnedProp, base.burnedNow),
      goalNow: (typeof goalProp === 'number' && Number.isFinite(goalProp) && goalProp > 0)
        ? Math.round(goalProp)
        : base.goalNow,
    });
  }, [burnedProp, consumedProp, goalProp]);

  useEffect(() => {
    recompute();
  }, [recompute]);

  // Stay in sync with meal/workout logging + hydration updates
  useEffect(() => {
    const kick = () => recompute();
    const onStorage = (e) => {
      if (!e || !e.key) return;
      if (
        [
          'mealHistory',
          'workoutHistory',
          'dailyMetricsCache',
          'userData',
          'dailyGoal',
          'burnedToday',
          'consumedToday'
        ].includes(e.key)
      ) kick();
    };

    const onVisOrFocus = () => recompute();

    window.addEventListener('slimcal:consumed:update', kick);
    window.addEventListener('slimcal:burnedNow:update', kick);
    window.addEventListener('slimcal:streak:update', kick);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisOrFocus);
    window.addEventListener('focus', onVisOrFocus);

    return () => {
      window.removeEventListener('slimcal:consumed:update', kick);
      window.removeEventListener('slimcal:burnedNow:update', kick);
      window.removeEventListener('slimcal:streak:update', kick);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisOrFocus);
      window.removeEventListener('focus', onVisOrFocus);
    };
  }, [recompute]);
  const eatenNow = state.eatenNow || 0;
  const burnedNow = state.burnedNow || 0;
  const goalNow = state.goalNow || 0;

  // Canonical math
  const net = eatenNow - burnedNow;
  const remaining = goalNow ? (goalNow - eatenNow + burnedNow) : 0;

  const netPill =
    net > 0
      ? { label: `Net: +${nf0.format(net)} kcal`, color: 'success' }
      : net < 0
        ? { label: `Net: -${nf0.format(Math.abs(net))} kcal`, color: 'error' }
        : { label: 'Net: 0 kcal', color: 'info' };

  const ringPct = useMemo(() => {
    if (!goalNow) return 0;
    const effective = eatenNow - burnedNow;
    const pct = goalNow > 0 ? (effective / goalNow) * 100 : 0;
    return clamp(pct, 0, 120);
  }, [goalNow, eatenNow, burnedNow]);

  const remainingLabel = goalNow
    ? `${nf0.format(Math.max(0, remaining))} left`
    : 'Set goalNow';

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
                {goalNow ? nf0.format(Math.max(0, remaining)) : '—'}
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
            value={goalNow ? clamp(ringPct, 0, 100) : 0}
            sx={{
              mt: 1.25,
              height: 10,
              borderRadius: 999,
              backgroundColor: 'rgba(2,6,23,0.06)',
            }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.6 }}>
            {goalNow ? `${nf0.format(eatenNow - burnedNow)} / ${nf0.format(goalNow)} effective` : 'Add a daily goalNow to unlock remaining'}
          </Typography>
        </Box>

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
                  <span role="img" aria-label="goalNow">🎯</span>
                  <Typography component="span" sx={{ fontWeight: 900 }}>Goal</Typography>
                </Box>
                <Typography component="span" sx={{ fontWeight: 950 }}>{nf0.format(goalNow || 0)} kcal</Typography>
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
                <Typography component="span" sx={{ fontWeight: 950 }}>{nf0.format(eatenNow)} kcal</Typography>
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
                <Typography component="span" sx={{ fontWeight: 950 }}>{nf0.format(burnedNow)} kcal</Typography>
              </Stack>
            }
            sx={{ borderRadius: 2, '& .MuiChip-label': { width: '100%' } }}
          />
        </Stack>
      </Stack>
    </Paper>
  );
}
