// ProgressDashboard.jsx
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

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

function ProgressDashboard() {
  const [workouts, setWorkouts] = useState([]);

  useEffect(() => {
    const savedHistory = localStorage.getItem('workoutHistory');
    if (savedHistory) {
      setWorkouts(JSON.parse(savedHistory));
    }
  }, []);

  const totalWorkouts = workouts.length;
  const totalCalories = workouts.reduce((acc, session) => acc + session.totalCalories, 0);

  const chartLabels = workouts.map(session => session.date);
  const chartData = {
    labels: chartLabels,
    datasets: [
      {
        label: 'Calories Burned',
        data: workouts.map(session => session.totalCalories),
        backgroundColor: 'rgba(75, 192, 192, 0.6)'
      }
    ]
  };

  const chartOptions = {
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
        <Box sx={{ maxWidth: 800, mx: 'auto' }}>
          <Bar data={chartData} options={chartOptions} />
        </Box>
      ) : (
        <Typography align="center" color="textSecondary">
          No workouts logged yet.
        </Typography>
      )}
    </Container>
  );
}

export default ProgressDashboard;
