// src/components/AlertPreferences.jsx

import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  TextField,
  IconButton,
  Button,
  Stack,
  Box
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';

const STORAGE_KEY = 'mealReminderPrefs';

// Helper to load-and-normalize prefs
function loadPrefs() {
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (!raw) return [];
  if (Array.isArray(raw)) {
    // already in the new [ { name, time }, … ] format
    return raw.filter(p => p.name && p.time);
  }
  // legacy object format: { breakfast: "08:00", … }
  return Object.entries(raw).map(([name, time]) => ({ name, time }));
}

export default function AlertPreferences() {
  const [meals, setMeals] = useState([]);

  // on mount, load normalized prefs
  useEffect(() => {
    setMeals(loadPrefs());
  }, []);

  // persist the array form whenever it changes
  const save = updated => {
    setMeals(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  const updateMeal = (idx, field, value) => {
    const updated = meals.slice();
    updated[idx] = { ...updated[idx], [field]: value };
    save(updated);
  };

  const addMeal = () => {
    save([...meals, { name: '', time: '12:00' }]);
  };

  const removeMeal = idx => {
    save(meals.filter((_, i) => i !== idx));
  };

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom>
        Alert Preferences
      </Typography>

      {meals.map((meal, idx) => (
        <Stack
          key={idx}
          direction="row"
          spacing={2}
          alignItems="center"
          sx={{ mb: 2 }}
        >
          {/* Meal label */}
          <TextField
            label="Meal name"
            value={meal.name}
            onChange={e => updateMeal(idx, 'name', e.target.value)}
            placeholder="e.g. Breakfast"
            fullWidth
          />

          {/* Time picker – widened so you see both minute digits */}
          <TextField
            label="Time"
            type="time"
            value={meal.time}
            onChange={e => updateMeal(idx, 'time', e.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{ step: 300 }}       // 5‑minute steps
            sx={{ width: 120 }}              // <— ensure full "HH:MM" is visible
          />

          <IconButton onClick={() => removeMeal(idx)}>
            <DeleteIcon />
          </IconButton>
        </Stack>
      ))}

      <Box sx={{ textAlign: 'center', mt: 3 }}>
        <Button variant="outlined" onClick={addMeal}>
          + Add another meal
        </Button>
      </Box>
    </Container>
  );
}
