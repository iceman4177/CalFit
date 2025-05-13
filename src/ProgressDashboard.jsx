// src/ProgressDashboard.jsx
import React, { useState, useEffect } from 'react';
import { Container, Typography, Box, Paper } from '@mui/material';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';
import WeeklyTrend from './WeeklyTrend';
import DailyGoalTracker from './DailyGoalTracker';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export default function ProgressDashboard() {
  const [workouts, setWorkouts] = useState([]);

  useEffect(() => {
    const saved = localStorage.getItem('workoutHistory');
    setWorkouts(saved ? JSON.parse(saved) : []);
  }, []);

  const totalWorkouts = workouts.length;
  const totalCalories = workouts.reduce((acc, s) => acc + s.totalCalories, 0);

  // Today’s consumed & burned
  const today = new Date().toLocaleDateString('en-US');
  const mealHist = JSON.parse(localStorage.getItem('mealHistory') || '[]');
  const todayMeals = mealHist.find(m => m.date === today);
  const consumed = todayMeals
    ? todayMeals.meals.reduce((sum, m) => sum + m.calories, 0)
    : 0;
  const burned = workouts
    .filter(w => w.date === today)
    .reduce((sum, w) => sum + w.totalCalories, 0);

  // User goal
  const userData = JSON.parse(localStorage.getItem('userData') || '{}');
  const goal = userData.dailyGoal || 0;

  const barData = {
    labels: workouts.map(s => s.date),
    datasets: [
      {
        label: 'Calories Burned',
        data: workouts.map(s => s.totalCalories),
        backgroundColor: 'rgba(75, 192, 192, 0.6)'
      }
    ]
  };

  const barOptions = {
    responsive: true,
    plugins: {
      legend: { position: 'top' },
      title: { display: true, text: 'Calories Burned Per Workout' }
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h3" align="center" gutterBottom>
        Progress Dashboard
      </Typography>

      <Paper elevation={3} sx={{ p: 3, mb: 4 }}>
        <Typography variant="h5">Summary</Typography>
        <Typography variant="body1">Total Workouts: {totalWorkouts}</Typography>
        <Typography variant="body1">
          Total Calories Burned: {totalCalories.toFixed(2)}
        </Typography>
      </Paper>

      {workouts.length > 0 ? (
        <Box sx={{ maxWidth: 800, mx: 'auto', mb: 6 }}>
          <Bar data={barData} options={barOptions} />
        </Box>
      ) : (
        <Typography align="center" color="textSecondary">
          No workouts logged yet.
        </Typography>
      )}

      {/* Today’s goal progress */}
      {goal > 0 && (
        <Paper elevation={3} sx={{ p: 3, mb: 6 }}>
          <Typography variant="h5" gutterBottom>
            Today’s Goal
          </Typography>
          <DailyGoalTracker burned={burned} consumed={consumed} goal={goal} />
        </Paper>
      )}

      {/* 7‑day net calorie trend */}
      <WeeklyTrend />
    </Container>
  );
}
