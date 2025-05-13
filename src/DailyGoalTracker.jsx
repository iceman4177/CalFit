// src/DailyGoalTracker.jsx
import React from 'react';
import { Box, Typography, LinearProgress } from '@mui/material';

export default function DailyGoalTracker({ burned, consumed, goal }) {
  const net = consumed - burned;

  if (net < 0) {
    return (
      <Box sx={{ mt: 2, textAlign: 'center' }}>
        <Typography variant="subtitle1" color="error">
          You’re in a caloric deficit of {Math.abs(net).toFixed(0)} kcal
        </Typography>
      </Box>
    );
  }

  const pct = goal > 0 ? Math.min((net / goal) * 100, 100) : 0;
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle1" align="center">
        Daily Goal Progress
      </Typography>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{ height: 10, borderRadius: 5, mb: 1 }}
      />
      <Typography variant="body2" align="center">
        {Math.round(pct)}% of {goal} kcal
      </Typography>
    </Box>
  );
}
