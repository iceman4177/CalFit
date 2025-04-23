// CalorieSummary.jsx
import React, { useEffect, useState } from 'react';
import { Container, Typography, Paper, Box, Chip } from '@mui/material';

function CalorieSummary() {
  const [burned, setBurned] = useState(0);
  const [consumed, setConsumed] = useState(0);
  const today = new Date().toLocaleDateString('en-US');

  useEffect(() => {
    // load today's burned
    const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const todayWorkout = workouts.find((w) => w.date === today);
    const burnedCals = todayWorkout ? todayWorkout.totalCalories : 0;

    // load today's consumed
    const meals = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    const todayMeals = meals.find((m) => m.date === today);
    const consumedCals = todayMeals
      ? todayMeals.meals.reduce((sum, meal) => sum + meal.calories, 0)
      : 0;

    setBurned(burnedCals);
    setConsumed(consumedCals);
  }, []);

  // FIXED: subtract burned from consumed
  const net = consumed - burned;
  const status = net > 0 ? 'Calorie Surplus' : net < 0 ? 'Calorie Deficit' : 'Neutral';

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h4" align="center" gutterBottom>
        Daily Calorie Summary
      </Typography>

      <Paper elevation={3} sx={{ p: 3, borderRadius: 2 }}>
        <Typography variant="h6">🍽 Calories Consumed:</Typography>
        <Typography variant="body1" sx={{ mb: 2 }}>
          {consumed.toFixed(2)} cals
        </Typography>

        <Typography variant="h6">🔥 Calories Burned:</Typography>
        <Typography variant="body1" sx={{ mb: 2 }}>
          {burned.toFixed(2)} cals
        </Typography>

        <Typography variant="h6">⚖️ Net Calories:</Typography>
        <Box display="flex" alignItems="center" gap={1}>
          <Typography
            variant="body1"
            sx={{ color: net > 0 ? 'green' : net < 0 ? 'red' : 'gray' }}
          >
            {net.toFixed(2)} cals
          </Typography>
          <Chip
            label={status}
            color={net > 0 ? 'success' : net < 0 ? 'error' : 'default'}
          />
        </Box>
      </Paper>
    </Container>
  );
}

export default CalorieSummary;
