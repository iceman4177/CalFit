// src/TreadmillForm.jsx
import React, { useState } from 'react';
import { Paper, TextField, Button, Typography, Box } from '@mui/material';

export default function TreadmillForm({ onAddTreadmillCalories }) {
  const [duration, setDuration] = useState('');
  const [calories, setCalories] = useState('');

  const handleAdd = () => {
    const parsedCalories = parseFloat(calories);
    if (!isNaN(parsedCalories) && parsedCalories > 0) {
      onAddTreadmillCalories(parsedCalories);
      setDuration('');
      setCalories('');
    } else {
      alert("Please enter a valid calories burned.");
    }
  };

  return (
    <Paper elevation={3} sx={{ p: 2, mt: 2 }}>
      <Typography variant="h6">Add Treadmill Session</Typography>
      <Box display="flex" flexDirection="column" gap={2} mt={2}>
        <TextField
          label="Duration (minutes)"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          type="number"
        />
        <TextField
          label="Calories Burned"
          value={calories}
          onChange={(e) => setCalories(e.target.value)}
          type="number"
          required
        />
        <Button variant="contained" onClick={handleAdd}>
          Add Treadmill Calories
        </Button>
      </Box>
    </Paper>
  );
}
