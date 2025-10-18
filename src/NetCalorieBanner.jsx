import React, { useEffect, useState, useCallback } from 'react';
import { Box, Paper, Typography, Chip } from '@mui/material';

const todayUS = () => new Date().toLocaleDateString('en-US');

function readLocal() {
  const d = todayUS();
  try {
    const wh = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const mh = JSON.parse(localStorage.getItem('mealHistory') || '[]');

    const burned = wh
      .filter(w => w.date === d)
      .reduce((s, w) => s + (Number(w.totalCalories) || 0), 0);

    const meals = mh.find(m => m.date === d);
    const consumed = meals ? (meals.meals || []).reduce((s, m) => s + (Number(m.calories) || 0), 0) : 0;

    return { burned, consumed };
  } catch {
    return { burned: 0, consumed: 0 };
  }
}

export default function NetCalorieBanner() {
  const [burned, setBurned] = useState(0);
  const [consumed, setConsumed] = useState(0);

  const recompute = useCallback(() => {
    const { burned: b, consumed: c } = readLocal();
    setBurned(Math.round(b || 0));
    setConsumed(Math.round(c || 0));
  }, []);

  useEffect(() => { recompute(); }, [recompute]);

  useEffect(() => {
    const kick = () => recompute();
    const onStorage = e => {
      if (!e || !e.key || ['mealHistory', 'workoutHistory'].includes(e.key)) kick();
    };
    const onVisOrFocus = () => kick();

    window.addEventListener('slimcal:consumed:update', kick);
    window.addEventListener('slimcal:burned:update', kick);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisOrFocus);
    window.addEventListener('focus', onVisOrFocus);
    return () => {
      window.removeEventListener('slimcal:consumed:update', kick);
      window.removeEventListener('slimcal:burned:update', kick);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisOrFocus);
      window.removeEventListener('focus', onVisOrFocus);
    };
  }, [recompute]);

  const net = consumed - burned;
  const label = net > 0 ? 'Surplus' : net < 0 ? 'Deficit' : 'Even';
  const color = net > 0 ? 'error' : net < 0 ? 'success' : 'default';

  // Centered, clean UI — logic unchanged
  return (
    <Box display="flex" justifyContent="center" sx={{ px: 2, mb: 3 }}>
      <Paper elevation={3} sx={{ textAlign: 'center', width: '100%', maxWidth: 520, p: 3, borderRadius: 3 }}>
        <Typography variant="h6" gutterBottom>Today’s Net Calories</Typography>
        <Box display="flex" justifyContent="center" alignItems="center" gap={1} mt={1}>
          <Typography variant="h4" fontWeight="bold">{net}</Typography>
          <Chip label={label} color={color} size="medium" />
        </Box>
        <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
          Eaten: {consumed} • Burned: {burned}
        </Typography>
      </Paper>
    </Box>
  );
}
