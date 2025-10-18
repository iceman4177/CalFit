import React, { useEffect, useState } from 'react';
import { Paper, Typography, Chip } from '@mui/material';
import { getLocalDayKey } from './utils/dates';

function readLocalDailyTotals() {
  const dayKey = getLocalDayKey();
  // Local-authoritative sources
  const meals = JSON.parse(localStorage.getItem('mealHistory') || '{}');
  const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '{}');

  const eaten = Number(meals[dayKey]?.totalCalories || 0);
  const burned = Number(workouts[dayKey]?.totalCalories || 0);
  return { eaten, burned };
}

export default function NetCalorieBanner() {
  const [{ eaten, burned }, setTotals] = useState(readLocalDailyTotals());

  useEffect(() => {
    const onUpdate = () => setTotals(readLocalDailyTotals());
    window.addEventListener('slimcal:consumed:update', onUpdate);
    window.addEventListener('slimcal:burned:update', onUpdate);
    window.addEventListener('storage', onUpdate);
    window.addEventListener('focus', onUpdate);
    return () => {
      window.removeEventListener('slimcal:consumed:update', onUpdate);
      window.removeEventListener('slimcal:burned:update', onUpdate);
      window.removeEventListener('storage', onUpdate);
      window.removeEventListener('focus', onUpdate);
    };
  }, []);

  const net = eaten - burned;
  const isSurplus = net > 0;

  return (
    <Paper elevation={2} className="p-4 mb-4">
      <Typography variant="h6" align="center">Today’s Net Calories</Typography>
      <div className="flex items-center justify-center gap-2 mt-1">
        <Typography variant="h5">{net}</Typography>
        <Chip label={isSurplus ? 'Surplus' : net < 0 ? 'Deficit' : 'Even'} color={isSurplus ? 'error' : net < 0 ? 'success' : 'default'} />
      </div>
      <Typography align="center" variant="body2" className="mt-1">
        Eaten: {eaten} • Burned: {burned}
      </Typography>
    </Paper>
  );
}
