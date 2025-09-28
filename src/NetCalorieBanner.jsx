// src/NetCalorieBanner.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Chip, Paper, Stack, Typography } from '@mui/material';
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
  const status = net >= 0 ? 'Surplus' : 'Deficit';

  return (
    <Paper
      elevation={0}
      sx={{
        mb: 2,
        p: 2,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        bgcolor: 'background.paper',
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        justifyContent="space-between"
      >
        <Box>
          <Typography variant="subtitle2" color="text.secondary">
            Today’s Net Calories
          </Typography>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 0.5 }}>
            <Typography variant="h5" component="div">
              {nf0.format(net)}
            </Typography>
            <Chip
              label={status}
              color={net >= 0 ? 'warning' : 'success'}
              size="small"
              variant="filled"
            />
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Eaten: {nf0.format(consumed || 0)} • Burned: {nf0.format(burned || 0)}
          </Typography>
        </Box>

        {!user && (
          <Alert
            severity="info"
            variant="outlined"
            sx={{ p: 1, alignSelf: { xs: 'stretch', sm: 'center' } }}
          >
            Sign in to back up your data and sync across devices.
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}
