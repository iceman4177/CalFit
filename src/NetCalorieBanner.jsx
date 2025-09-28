// src/NetCalorieBanner.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { useAuth } from './context/AuthProvider.jsx';
import { getDailyMetricsRange } from './lib/db';

const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

function isoToday() {
  try { return new Date().toISOString().slice(0, 10); } catch { return null; }
}

export default function NetCalorieBanner({ burned: burnedProp, consumed: consumedProp }) {
  const { user } = useAuth();

  // ----- Local fallback (if no props and not signed in) -----
  const local = useMemo(() => {
    const todayUS = new Date().toLocaleDateString('en-US');
    const wh = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const mh = JSON.parse(localStorage.getItem('mealHistory') || '[]');

    const burned = wh
      .filter(w => w.date === todayUS)
      .reduce((s, w) => s + (w.totalCalories || 0), 0);

    const mealsToday = mh.find(m => m.date === todayUS);
    const consumed = mealsToday
      ? (mealsToday.meals || []).reduce((s, m) => s + (m.calories || 0), 0)
      : 0;

    return { burned, consumed };
  }, []);

  // State that powers the UI (rounded for display)
  const [burned, setBurned]     = useState(
    Number.isFinite(burnedProp) ? Math.round(burnedProp) : Math.round(local.burned || 0)
  );
  const [consumed, setConsumed] = useState(
    Number.isFinite(consumedProp) ? Math.round(consumedProp) : Math.round(local.consumed || 0)
  );

  // If signed in, prefer Supabase’s daily_metrics for today
  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!user) return; // stick with props/local
      try {
        const day = isoToday();
        const rows = await getDailyMetricsRange(user.id, day, day);
        const r = rows?.[0];
        if (r && !ignore) {
          setBurned(Math.round(r.cals_burned || 0));
          setConsumed(Math.round(r.cals_eaten || 0));
        }
      } catch (err) {
        console.error('[NetCalorieBanner] Supabase fetch failed; using props/local', err);
      }
    })();
    return () => { ignore = true; };
  }, [user]);

  // If props change later, allow them to nudge state when unauthenticated
  useEffect(() => {
    if (!user && Number.isFinite(burnedProp)) setBurned(Math.round(burnedProp));
  }, [burnedProp, user]);
  useEffect(() => {
    if (!user && Number.isFinite(consumedProp)) setConsumed(Math.round(consumedProp));
  }, [consumedProp, user]);

  const net = (consumed || 0) - (burned || 0);
  const pillBg =
    net > 0 ? 'error.main' : net < 0 ? 'success.main' : 'grey.500';
  const pillLabel =
    net > 0 ? 'Surplus' : net < 0 ? 'Deficit' : 'Balanced';

  return (
    <Paper
      elevation={3}
      sx={{
        p: 3,
        mb: 4,
        textAlign: 'center',
        borderRadius: 2
      }}
    >
      <Typography variant="h6" sx={{ mb: 1 }}>
        Today’s Net Calories
      </Typography>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          mb: 1
        }}
      >
        <Typography variant="h3" component="div" sx={{ lineHeight: 1 }}>
          {nf0.format(net)}
        </Typography>
        <Box
          sx={{
            px: 1.5,
            py: 0.5,
            borderRadius: 999,
            bgcolor: pillBg,
            color: 'white',
            fontWeight: 700,
            fontSize: '0.9rem'
          }}
        >
          {pillLabel}
        </Box>
      </Box>

      <Typography variant="body2" color="text.secondary">
        Eaten: {nf0.format(consumed || 0)} • Burned: {nf0.format(burned || 0)}
      </Typography>
    </Paper>
  );
}
