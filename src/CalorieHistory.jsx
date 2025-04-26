// CalorieHistory.jsx
import React, { useEffect, useState } from 'react';
import {
  Container,
  Typography,
  Paper,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody
} from '@mui/material';

function CalorieHistory() {
  const [dailyData, setDailyData] = useState([]);

  useEffect(() => {
    const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const meals = JSON.parse(localStorage.getItem('mealHistory') || '[]');

    // Map dates to { consumed, burned }
    const map = {};

    // Accumulate burned calories
    workouts.forEach(({ date, totalCalories }) => {
      if (!map[date]) map[date] = { consumed: 0, burned: 0 };
      map[date].burned += totalCalories;
    });

    // Accumulate consumed calories
    meals.forEach(({ date, meals }) => {
      if (!map[date]) map[date] = { consumed: 0, burned: 0 };
      map[date].consumed += meals.reduce((sum, m) => sum + m.calories, 0);
    });

    // Convert to array and sort descending by date
    const arr = Object.entries(map)
      .map(([date, { consumed, burned }]) => ({
        date,
        consumed,
        burned,
        net: consumed - burned
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    setDailyData(arr);
  }, []);

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" align="center" gutterBottom>
        Calorie History
      </Typography>

      {dailyData.length === 0 ? (
        <Typography align="center" color="textSecondary">
          No data yet. Log workouts or meals to see history.
        </Typography>
      ) : (
        <Paper elevation={3} sx={{ overflowX: 'auto' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell align="right">Consumed</TableCell>
                <TableCell align="right">Burned</TableCell>
                <TableCell align="right">Net</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {dailyData.map(({ date, consumed, burned, net }) => (
                <TableRow key={date}>
                  <TableCell>{date}</TableCell>
                  <TableCell align="right">{consumed.toFixed(2)}</TableCell>
                  <TableCell align="right">{burned.toFixed(2)}</TableCell>
                  <TableCell
                    align="right"
                    sx={{ color: net > 0 ? 'green' : net < 0 ? 'red' : 'gray' }}
                  >
                    {net.toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Container>
  );
}

export default CalorieHistory;
