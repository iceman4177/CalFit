// src/components/AlertPreferences.jsx

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Paper
} from '@mui/material';

const DEFAULT_PREFS = {
  breakfast: '08:00',
  lunch:     '12:00',
  dinner:    '18:00'
};

export default function AlertPreferences() {
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [status, setStatus] = useState('idle'); // idle | saved

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem('mealReminderPrefs') || '{}');
    setPrefs({ ...DEFAULT_PREFS, ...stored });
  }, []);

  const handleChange = meal => e => {
    setPrefs(p => ({ ...p, [meal]: e.target.value }));
    setStatus('idle');
  };

  const handleSave = () => {
    localStorage.setItem('mealReminderPrefs', JSON.stringify(prefs));
    setStatus('saved');
  };

  return (
    <Paper sx={{ maxWidth: 400, mx: 'auto', mt: 4, p: 3 }}>
      <Typography variant="h5" align="center" gutterBottom>
        Alert Preferences
      </Typography>
      <Box component="form" noValidate autoComplete="off">
        {['breakfast','lunch','dinner'].map(meal => (
          <TextField
            key={meal}
            label={`${meal.charAt(0).toUpperCase()}${meal.slice(1)} Time`}
            type="time"
            fullWidth
            value={prefs[meal]}
            onChange={handleChange(meal)}
            InputLabelProps={{ shrink: true }}
            sx={{ mb: 2 }}
          />
        ))}
        <Button variant="contained" fullWidth onClick={handleSave}>
          Save Preferences
        </Button>
        {status === 'saved' && (
          <Typography variant="body2" align="center" color="success.main" mt={2}>
            Preferences saved!
          </Typography>
        )}
      </Box>
    </Paper>
  );
}
