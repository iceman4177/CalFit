// src/components/StreakBanner.jsx
import React, { useEffect, useState } from 'react';
import { Box, Typography, Paper } from '@mui/material';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import { getStreak } from '../utils/streak';

/**
 * StreakBanner
 * - Shows the user's current local-day logging streak
 * - If `streak` prop is provided, uses it; otherwise reads from utils/streak
 * - Subscribes to 'slimcal:streak:update' to stay in sync with the app
 */
export default function StreakBanner({ streak: streakProp, sx = {} }) {
  const [streak, setStreak] = useState(
    typeof streakProp === 'number' ? streakProp : getStreak()
  );

  // keep in sync if parent prop changes
  useEffect(() => {
    if (typeof streakProp === 'number') setStreak(streakProp);
  }, [streakProp]);

  // subscribe to streak updates if no prop is provided
  useEffect(() => {
    if (typeof streakProp === 'number') return undefined;
    const onUpdate = () => setStreak(getStreak());
    window.addEventListener('slimcal:streak:update', onUpdate);
    return () => window.removeEventListener('slimcal:streak:update', onUpdate);
  }, [streakProp]);

  // render nothing if streak is falsy/zero
  if (!streak) return null;

  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        mb: 2,
        borderRadius: 3,
        border: '1px solid rgba(2,6,23,0.10)',
        background: 'rgba(2,6,23,0.02)',
        ...sx,
      }}
    >
      <Box display="flex" alignItems="center" justifyContent="center" gap={1}>
        <EmojiEventsIcon />
        <Typography variant="subtitle1" component="span" sx={{ fontWeight: 900 }}>
          {streak}-day streak! Keep it going 🔥
        </Typography>
      </Box>
    </Paper>
  );
}
