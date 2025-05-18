import React from 'react';
import { Box, Typography } from '@mui/material';
import { getStreak } from '../utils/streak';

export default function StreakBanner() {
  const streak = getStreak();
  // Only show once they've hit at least a 2‑day streak
  if (streak < 2) return null;

  return (
    <Box sx={{ textAlign: 'center', mb: 2 }}>
      <Typography variant="h6" color="secondary">
        🔥 You’re on a {streak}-day logging streak!
      </Typography>
    </Box>
  );
}
