import React, { useEffect, useState } from 'react';
import { Paper, Typography, Chip, Box } from '@mui/material';
import { getLocalDayKey } from './utils/dates';

function readLocalDailyTotals() {
  const dayKey = getLocalDayKey();
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
  const label =
    net > 0 ? 'Surplus' : net < 0 ? 'Deficit' : 'Even';
  const color =
    net > 0 ? 'error' : net < 0 ? 'success' : 'default';

  return (
    <Box display="flex" justifyContent="center" mb={4}>
      <Paper
        elevation={3}
        sx={{
          textAlign: 'center',
          width: '100%',
          maxWidth: 480,
          p: 3,
          borderRadius: 3,
        }}
      >
        <Typography variant="h6" gutterBottom>
          Today’s Net Calories
        </Typography>
        <Box
          display="flex"
          justifyContent="center"
          alignItems="center"
          gap={1}
          mt={1}
        >
          <Typography variant="h4" fontWeight="bold">
            {net}
          </Typography>
          <Chip label={label} color={color} size="medium" />
        </Box>
        <Typography
          variant="body2"
          sx={{ mt: 1, color: 'text.secondary' }}
        >
          Eaten: {eaten} • Burned: {burned}
        </Typography>
      </Paper>
    </Box>
  );
}
