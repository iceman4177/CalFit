// src/NetCalorieBanner.jsx
import React, { useEffect, useState, useCallback } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { useAuth } from './context/AuthProvider.jsx';
import { getDailyMetricsRange } from './lib/db';

const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

const isoToday = () => new Date().toISOString().slice(0, 10);
const usToday  = () => new Date().toLocaleDateString('en-US');

function readLocal() {
  const today = usToday();
  try {
    const wh = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const mh = JSON.parse(localStorage.getItem('mealHistory') || '[]');

    const burned = wh
      .filter(w => w.date === today)
      .reduce((s, w) => s + (w.totalCalories || 0), 0);

    const mealsToday = mh.find(m => m.date === today);
    const consumed = mealsToday
      ? (mealsToday.meals || []).reduce((s, m) => s + (m.calories || 0), 0)
      : 0;

    return { burned, consumed };
  } catch {
    return { burned: 0, consumed: 0 };
  }
}

export default function NetCalorieBanner({ burned: burnedProp, consumed: consumedProp }) {
  const { user } = useAuth();
  const [burned, setBurned] = useState(0);
  const [consumed, setConsumed] = useState(0);

  // Canonical recompute (local-first, then cloud if signed in)
  const recompute = useCallback(async () => {
    // 1) local for instant UI
    const { burned: bLocal, consumed: cLocal } = readLocal();
    setBurned(Math.round(Number.isFinite(bLocal) ? bLocal : 0));
    setConsumed(Math.round(Number.isFinite(cLocal) ? cLocal : 0));

    // 2) props override for unauth flows (if provided)
    if (!user) {
      if (Number.isFinite(burnedProp)) setBurned(Math.round(burnedProp));
      if (Number.isFinite(consumedProp)) setConsumed(Math.round(consumedProp));
      return;
    }

    // 3) cloud authoritative snapshot for the signed-in user
    try {
      const day = isoToday();
      const rows = await getDailyMetricsRange(user.id, day, day);
      const r = rows?.[0];
      if (r) {
        setBurned(Math.round(r.cals_burned || 0));
        setConsumed(Math.round(r.cals_eaten || 0));
      }
    } catch (err) {
      console.error('[NetCalorieBanner] Supabase fetch failed; using local snapshot', err);
    }
  }, [user, burnedProp, consumedProp]);

  // Initial + user change
  useEffect(() => { recompute(); }, [recompute]);

  // Listen for local updates and visibility changes
  useEffect(() => {
    const onConsumed = () => recompute();
    const onBurned   = () => recompute();
    const onStorage  = (e) => {
      if (!e || !e.key || ['mealHistory','workoutHistory','dailyMetricsCache','consumedToday'].includes(e.key)) {
        recompute();
      }
    };
    const onVisOrFocus = () => recompute();

    window.addEventListener('slimcal:consumed:update', onConsumed);
    window.addEventListener('slimcal:burned:update',   onBurned);
    window.addEventListener('storage',                 onStorage);
    document.addEventListener('visibilitychange',      onVisOrFocus);
    window.addEventListener('focus',                   onVisOrFocus);
    return () => {
      window.removeEventListener('slimcal:consumed:update', onConsumed);
      window.removeEventListener('slimcal:burned:update',   onBurned);
      window.removeEventListener('storage',                 onStorage);
      document.removeEventListener('visibilitychange',      onVisOrFocus);
      window.removeEventListener('focus',                   onVisOrFocus);
    };
  }, [recompute]);

  const net = (consumed || 0) - (burned || 0);
  const pillBg   = net > 0 ? 'error.main' : net < 0 ? 'success.main' : 'grey.500';
  const pillText = net > 0 ? 'Surplus'    : net < 0 ? 'Deficit'     : 'Balanced';

  return (
    <Paper elevation={3} sx={{ p: 3, mb: 4, textAlign: 'center', borderRadius: 2 }}>
      <Typography variant="h6" sx={{ mb: 1 }}>Today’s Net Calories</Typography>
      <Box sx={{ display:'flex', alignItems:'center', justifyContent:'center', gap:1, mb:1 }}>
        <Typography variant="h3" component="div" sx={{ lineHeight: 1 }}>
          {nf0.format(net)}
        </Typography>
        <Box sx={{ px:1.5, py:0.5, borderRadius:999, bgcolor:pillBg, color:'#fff', fontWeight:700, fontSize:'0.9rem' }}>
          {pillText}
        </Box>
      </Box>
      <Typography variant="body2" color="text.secondary">
        Eaten: {nf0.format(consumed || 0)} • Burned: {nf0.format(burned || 0)}
      </Typography>
    </Paper>
  );
}
