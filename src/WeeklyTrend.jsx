// src/WeeklyTrend.jsx
import React, { useEffect, useState } from 'react';
import { Container, Typography, Paper } from '@mui/material';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

export default function WeeklyTrend() {
  const [dailyNet, setDailyNet] = useState([]);

  useEffect(() => {
    const meals = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '[]');

    // Initialize last 7 days
    const today = new Date();
    const netMap = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toLocaleDateString('en-US');
      netMap[key] = { consumed: 0, burned: 0 };
    }

    // Accumulate consumed
    meals.forEach(({ date, meals }) => {
      if (netMap[date]) {
        netMap[date].consumed += meals.reduce((sum, m) => sum + m.calories, 0);
      }
    });

    // Accumulate burned
    workouts.forEach(({ date, totalCalories }) => {
      if (netMap[date]) {
        netMap[date].burned += totalCalories;
      }
    });

    // Build array
    const arr = Object.entries(netMap).map(([date, { consumed, burned }]) => ({
      date,
      net: consumed - burned,
    }));
    setDailyNet(arr);
  }, []);

  const data = {
    labels: dailyNet.map(d => d.date),
    datasets: [
      {
        label: 'Net Calories',
        data: dailyNet.map(d => d.net),
        fill: false,
        tension: 0.3,
      },
    ],
  };

  const options = {
    responsive: true,
    plugins: {
      legend: { position: 'top' },
      title: { display: true, text: '7‑Day Net Calorie Trend' },
    },
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h3" align="center" gutterBottom>
        Weekly Net Calories
      </Typography>
      <Paper elevation={3} sx={{ p: 3 }}>
        <Line data={data} options={options} />
      </Paper>
    </Container>
  );
}
