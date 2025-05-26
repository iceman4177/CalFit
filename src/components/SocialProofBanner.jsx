// src/components/SocialProofBanner.jsx

import React, { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';

export default function SocialProofBanner() {
  const [count, setCount] = useState(null);

  useEffect(() => {
    // TODO: replace with real API call when backend is ready
    // For now, simulate with a random number between 100 and 999
    const simulatedCount = Math.floor(100 + Math.random() * 900);
    setCount(simulatedCount);
  }, []);

  if (count === null) return null;

  return (
    <Box
      sx={{
        bgcolor: 'primary.light',
        color: 'primary.contrastText',
        p: 2,
        borderRadius: 2,
        textAlign: 'center',
        mb: 3
      }}
    >
      <Typography variant="h6">
        🎉 {count.toLocaleString()} users hit their goal today!
      </Typography>
    </Box>
  );
}
