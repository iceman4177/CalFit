import React, { useEffect, useState, useCallback } from 'react';
import { Box, Paper, Typography } from '@mui/material';

const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const todayUS  = () => new Date().toLocaleDateString('en-US');

function readLocal() {
  const d = todayUS();
  try {
    const wh = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const mh = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    const burned = wh.filter(w => w.date === d).reduce((s,w)=> s + (Number(w.totalCalories)||0), 0);
    const meals  = mh.find(m => m.date === d);
    const consumed = meals ? (meals.meals||[]).reduce((s,m)=> s + (Number(m.calories)||0), 0) : 0;
    return { burned, consumed };
  } catch { return { burned:0, consumed:0 }; }
}

export default function NetCalorieBanner() {
  const [burned, setBurned]     = useState(0);
  const [consumed, setConsumed] = useState(0);

  const recompute = useCallback(() => {
    const { burned: b, consumed: c } = readLocal();
    setBurned(Math.round(b||0));
    setConsumed(Math.round(c||0));
  }, []);

  useEffect(() => { recompute(); }, [recompute]);

  useEffect(() => {
    const kick = () => recompute();
    const onStorage = (e) => {
      if (!e || !e.key || ['mealHistory','workoutHistory'].includes(e.key)) recompute();
    };
    const onVisOrFocus = () => recompute();

    window.addEventListener('slimcal:consumed:update', kick);
    window.addEventListener('slimcal:burned:update',   kick);
    window.addEventListener('storage',                 onStorage);
    document.addEventListener('visibilitychange',      onVisOrFocus);
    window.addEventListener('focus',                   onVisOrFocus);

    return () => {
      window.removeEventListener('slimcal:consumed:update', kick);
      window.removeEventListener('slimcal:burned:update',   kick);
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
