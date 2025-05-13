// src/NetCalorieBanner.jsx
import React from 'react';
import { Box, Typography, Paper, Chip } from '@mui/material';
import DailyGoalTracker from './DailyGoalTracker';

export default function NetCalorieBanner({ burned, consumed, goal }) {
  const net = consumed - burned;
  const status = net > 0 ? 'Surplus' : net < 0 ? 'Deficit' : 'Balanced';

  return (
    <Paper sx={{ p: 3, backgroundColor: '#e6f0ff', mb: 4 }} elevation={2}>
      <Typography variant="h6" align="center" gutterBottom>
        Net Calories
      </Typography>
      <Typography variant="h4" align="center" sx={{ fontWeight: 'bold' }}>
        {net.toFixed(2)} calories
      </Typography>
      <Box textAlign="center" mt={1} mb={ goal ? 2 : 0 }>
        <Chip
          label={status}
          color={
            status === 'Surplus'
              ? 'error'
              : status === 'Deficit'
              ? 'success'
              : 'default'
          }
        />
      </Box>
      {goal ? (
        <DailyGoalTracker burned={burned} consumed={consumed} goal={goal} />
      ) : null}
    </Paper>
);
}
