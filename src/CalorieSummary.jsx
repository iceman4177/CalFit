// src/CalorieSummary.jsx
import React from 'react';
import {
  Container,
  Typography,
  Paper,
  Box,
  Chip
} from '@mui/material';

// Now receives burned & consumed from App, so it always matches the banner
function CalorieSummary({ burned, consumed }) {
  const net = consumed - burned;
  const status =
    net > 0
      ? 'Calorie Surplus'
      : net < 0
      ? 'Calorie Deficit'
      : 'Neutral';

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
            sx={{
              color: net > 0 ? 'green' : net < 0 ? 'red' : 'gray'
            }}
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
