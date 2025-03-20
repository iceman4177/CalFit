import React from 'react';
import { Box, TextField, Typography, Button } from '@mui/material';

const SaunaForm = ({
  saunaTime,
  saunaTemp,
  setSaunaTime,
  setSaunaTemp,
  onFinishWorkout,
  onBackToExercises
}) => {
  return (
    <Box sx={{ maxWidth: 600, mx: 'auto', mt: 2 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Sauna Session (Optional)
      </Typography>

      <TextField
        label="Time in Sauna (minutes)"
        type="number"
        value={saunaTime}
        onChange={(e) => setSaunaTime(e.target.value)}
        fullWidth
        sx={{ mb: 2 }}
      />

      <TextField
        label="Temperature (°F)"
        type="number"
        value={saunaTemp}
        onChange={(e) => setSaunaTemp(e.target.value)}
        fullWidth
        sx={{ mb: 2 }}
      />

      <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
        <Button variant="outlined" onClick={onBackToExercises}>
          Back to Exercises
        </Button>
        <Button variant="contained" color="primary" onClick={onFinishWorkout}>
          Finish Workout
        </Button>
      </Box>
    </Box>
  );
};

export default SaunaForm;
