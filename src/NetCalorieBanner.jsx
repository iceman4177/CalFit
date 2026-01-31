// src/NetCalorieBanner.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Chip, LinearProgress, Paper, Stack, Typography } from '@mui/material';

import { useAuth } from './context/AuthProvider.jsx';
import { useUserData } from './UserDataContext.jsx';
import { hydrateTodayTotalsFromCloud } from './lib/hydrateCloudToLocal.js';
import { ensureScopedFromLegacy, readScopedJSON, KEYS } from './lib/scopedStorage.js';

// ---------------- Local-day helpers (avoid UTC drift) ----------------
function localDayISO(d = new Date()) {
  const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return ld.toISOString().slice(0, 10);
}

function safeNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function preferLiveProp(next, prev) {
  // Props often arrive as default 0 during async recompute. Never let that clobber a real, non-zero value.
  if (next == null) return prev;
  const n = Number(next);
  const p = Number(prev);
  if (!Number.isFinite(n)) return prev;
  if (n === 0 && Number.isFinite(p) && p > 0) return p;
  return n;
}


function readUserGoalCalories(fallback) {
  try {
    // Legacy userData cache (HealthDataForm writes this)
    const raw = localStorage.getItem('userData');
    if (raw) {
      const obj = JSON.parse(raw);
      const g = safeNum(obj?.dailyGoal, NaN);
      if (Number.isFinite(g) && g > 0) return g;
    }
  } catch {}
  return safeNum(fallback, 0);
}

function readTodayCache(userId, todayISO) {
  try {
    if (!userId) return { eaten: 0, burned: 0 };
    ensureScopedFromLegacy(KEYS.dailyMetricsCache, userId);
    const cache = readScopedJSON(KEYS.dailyMetricsCache, userId, {}) || {};
    const row = cache?.[todayISO] || {};
    const eaten = safeNum(row?.consumed ?? row?.calories_eaten ?? row?.eaten ?? 0, 0);
    const burned = safeNum(row?.burned ?? row?.calories_burned ?? 0, 0);
    return { eaten, burned };
  } catch {
    return { eaten: 0, burned: 0 };
  }
}

export default function NetCalorieBanner({ consumed = 0, burned = 0, goal = 0, goalLabel }) {
  const { user } = useAuth();
  const userId = user?.id || null;
  const { dailyGoal } = useUserData();

  const todayISO = useMemo(() => localDayISO(new Date()), []);

  // Initial state: prefer props, then scoped cache.
  const [state, setState] = useState(() => {
    const cache = readTodayCache(userId, todayISO);
    const g = readUserGoalCalories(safeNum(goal || dailyGoal || 0, 0));
    return {
      eatenNow: preferLiveProp(consumed, cache.eaten),
      burnedNow: preferLiveProp(burned, cache.burned),
      goalNow: g,
    };
  });

  // Keep state in sync with incoming props (when parent recomputes)
  useEffect(() => {
    setState((s) => ({
      ...s,
      eatenNow: preferLiveProp(consumed, s.eatenNow),
      burnedNow: preferLiveProp(burned, s.burnedNow),
      goalNow: readUserGoalCalories(safeNum(goal || dailyGoal || s.goalNow || 0, 0)),
    }));
  }, [consumed, burned, goal, dailyGoal]);

  const hydratorInFlight = useRef(false);
  const runHydrate = useCallback(async () => {
    if (!userId || hydratorInFlight.current) return;
    hydratorInFlight.current = true;
    try {
      const res = await hydrateTodayTotalsFromCloud(user, { alsoDispatch: true });
      if (res?.ok) {
        setState((s) => {
          // Prevent “snap back to 0” when cloud lags behind a fresh local log.
          // If local already has >0 and cloud reports 0, keep local.
          const nextEaten = (safeNum(res.eaten, 0) === 0 && s.eatenNow > 0)
            ? s.eatenNow
            : safeNum(res.eaten, s.eatenNow);

          const nextBurned = (safeNum(res.burned, 0) === 0 && s.burnedNow > 0)
            ? s.burnedNow
            : safeNum(res.burned, s.burnedNow);

          return {
            ...s,
            eatenNow: nextEaten,
            burnedNow: nextBurned,
            goalNow: readUserGoalCalories(safeNum(goal || dailyGoal || s.goalNow || 0, 0)),
          };
        });
      }
    } catch (e) {
      console.warn('[NetCalorieBanner] hydrate failed', e);
    } finally {
      hydratorInFlight.current = false;
    }
  }, [user, userId, goal, dailyGoal]);

  // Auto-hydrate on login / focus / reconnect so mobile + PC stay aligned.
  useEffect(() => {
    if (!userId) return;

    // 1) Immediately hydrate once after user is available.
    runHydrate();

    // 2) Re-hydrate when tab becomes visible / app regains focus.
    const onVis = () => {
      if (document.visibilityState === 'visible') runHydrate();
    };
    const onFocus = () => runHydrate();
    const onOnline = () => runHydrate();

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [userId, runHydrate]);

  // Listen to the app-wide realtime events (meals/workouts update totals instantly).
  useEffect(() => {
    const onConsumed = (e) => {
      const amt = safeNum(e?.detail?.consumed, NaN);
      if (Number.isFinite(amt)) {
        setState((s) => ({ ...s, eatenNow: amt }));
      }
    };
    const onBurned = (e) => {
      const amt = safeNum(e?.detail?.burned, NaN);
      if (Number.isFinite(amt)) {
        setState((s) => ({ ...s, burnedNow: amt }));
      }
    };

    window.addEventListener('slimcal:consumed:update', onConsumed);
    window.addEventListener('slimcal:burned:update', onBurned);

    return () => {
      window.removeEventListener('slimcal:consumed:update', onConsumed);
      window.removeEventListener('slimcal:burned:update', onBurned);
    };
  }, []);

  const eatenNow = safeNum(state.eatenNow, 0);
  const burnedNow = safeNum(state.burnedNow, 0);
  const goalNow = safeNum(state.goalNow, 0);

  const effective = Math.max(0, goalNow - eatenNow + burnedNow);
  const pct = goalNow > 0 ? Math.min(100, Math.max(0, (effective / goalNow) * 100)) : 0;

  // Net calories in your app: consumed - burned (positive = surplus).
  const net = Math.round(eatenNow - burnedNow);

  const netChip = net > 0
    ? { label: `Net: +${net} kcal`, color: 'success' }
    : net < 0
      ? { label: `Net: ${net} kcal`, color: 'error' }
      : { label: 'Net: 0 kcal', color: 'default' };

  return (
    <Paper elevation={0} sx={{ p: 2, borderRadius: 4, border: '1px solid rgba(0,0,0,0.08)' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Box>
          <Typography variant="subtitle2" color="text.secondary">Today</Typography>
          <Typography variant="h6" sx={{ lineHeight: 1.1 }}>Calories</Typography>
        </Box>
        <Chip label={netChip.label} color={netChip.color} />
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.2fr 1fr' }, gap: 2 }}>
        <Paper elevation={0} sx={{ p: 2, borderRadius: 4, border: '1px solid rgba(0,0,0,0.06)' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Remaining = Goal − Food + Exercise
          </Typography>
          <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mt: 1 }}>
            <Typography variant="h3" sx={{ fontWeight: 800 }}>
              {Math.round(effective)}
            </Typography>
            <Typography variant="h6" color="text.secondary">kcal</Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {Math.round(effective)} left
          </Typography>

          <Box sx={{ mt: 1.5 }}>
            <LinearProgress variant="determinate" value={pct} />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {Math.round(net)} / {Math.round(goalNow || 0)} effective
            </Typography>
          </Box>
        </Paper>

        <Paper elevation={0} sx={{ p: 2, borderRadius: 4, border: '1px solid rgba(0,0,0,0.06)' }}>
          <Stack spacing={1}>
            <Row label={goalLabel || 'Goal'} value={Math.round(goalNow)} icon="🎯" />
            <Row label="Food" value={Math.round(eatenNow)} icon="🍽️" />
            <Row label="Exercise" value={Math.round(burnedNow)} icon="🔥" />
          </Stack>
        </Paper>
      </Box>
    </Paper>
  );
}

function Row({ label, value, icon }) {
  return (
    <Paper elevation={0} sx={{ p: 1.2, borderRadius: 999, border: '1px solid rgba(0,0,0,0.10)' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography sx={{ fontSize: 16 }}>{icon}</Typography>
          <Typography sx={{ fontWeight: 700 }}>{label}</Typography>
        </Stack>
        <Typography sx={{ fontWeight: 800 }}>{Number.isFinite(value) ? value.toLocaleString() : '0'} kcal</Typography>
      </Stack>
    </Paper>
  );
}
