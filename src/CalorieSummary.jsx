import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, Typography } from '@mui/material';

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
    const eaten = meals ? (meals.meals || []).reduce((s, m) => s + (Number(m.calories) || 0), 0) : 0;

    return { burned, eaten };
  } catch {
    return { burned: 0, eaten: 0 };
  }
}

export default function CalorieSummary() {
  const [burned, setBurned] = useState(0);
  const [consumed, setConsumed] = useState(0);

  const recompute = useCallback(() => {
    const { burned: b, eaten: c } = readLocal();
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

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6">Daily Calorie Summary</Typography>
        <Typography variant="body1">Consumed: {consumed}</Typography>
        <Typography variant="body1">Burned: {burned}</Typography>
        <Typography variant="subtitle1" sx={{ mt: 1.5 }}>Net: {net}</Typography>
      </CardContent>
    </Card>
  );
}
