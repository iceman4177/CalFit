import React, { useEffect, useState } from 'react';
import { Card, CardContent, Typography } from '@mui/material';
import { getLocalDayKey } from './utils/dates';

function readLocalDailyTotals() {
  const dayKey = getLocalDayKey();
  const meals = JSON.parse(localStorage.getItem('mealHistory') || '{}');
  const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '{}');
  return {
    consumed: Number(meals[dayKey]?.totalCalories || 0),
    burned: Number(workouts[dayKey]?.totalCalories || 0),
  };
}

export default function CalorieSummary() {
  const [{ consumed, burned }, setTotals] = useState(readLocalDailyTotals());

  useEffect(() => {
    const onUpdate = () => setTotals(readLocalDailyTotals());
    window.addEventListener('slimcal:consumed:update', onUpdate);
    window.addEventListener('slimcal:burned:update', onUpdate);
    window.addEventListener('storage', onUpdate);
    return () => {
      window.removeEventListener('slimcal:consumed:update', onUpdate);
      window.removeEventListener('slimcal:burned:update', onUpdate);
      window.removeEventListener('storage', onUpdate);
    };
  }, []);

  const net = consumed - burned;

  return (
    <Card className="mb-4">
      <CardContent>
        <Typography variant="h6">Daily Calorie Summary</Typography>
        <Typography variant="body1">Consumed: {consumed}</Typography>
        <Typography variant="body1">Burned: {burned}</Typography>
        <Typography variant="subtitle1" className="mt-2">Net: {net}</Typography>
      </CardContent>
    </Card>
  );
}
