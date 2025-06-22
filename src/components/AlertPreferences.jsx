// src/components/AlertPreferences.jsx
import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  TextField,
  IconButton,
  Button,
  Stack,
  Box,
  FormControlLabel,
  Switch,
  Divider
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';

const STORAGE_KEY = 'mealReminderPrefs';
const SETTINGS_KEY = 'alertPrefsSettings';

function loadPrefs() {
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter(p => p.name && p.time);
  }
  return Object.entries(raw).map(([name, time]) => ({ name, time }));
}

function loadSettings() {
  return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
}

export default function AlertPreferences() {
  // meal-times
  const [meals, setMeals] = useState([]);
  // global toggles
  const [settings, setSettings] = useState({
    pushNotifications: true,
    mealReminders:     true,
    variableRewards:   true,
    ...loadSettings()
  });

  useEffect(() => {
    setMeals(loadPrefs());
  }, []);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  const saveMeals = updated => {
    setMeals(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  const updateMeal = (idx, field, value) => {
    const updated = meals.slice();
    updated[idx] = { ...updated[idx], [field]: value };
    saveMeals(updated);
  };

  const addMeal = () => {
    saveMeals([...meals, { name: '', time: '12:00' }]);
  };

  const removeMeal = idx => {
    saveMeals(meals.filter((_, i) => i !== idx));
  };

  const toggle = key => (_e, checked) =>
    setSettings(prev => ({ ...prev, [key]: checked }));

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom>
        Alert & Engagement Preferences
      </Typography>

      <Stack spacing={2} sx={{ mb: 3 }}>
        <FormControlLabel
          control={
            <Switch
              checked={settings.pushNotifications}
              onChange={toggle('pushNotifications')}
            />
          }
          label="Enable Push Notifications"
        />
        <FormControlLabel
          control={
            <Switch
              checked={settings.mealReminders}
              onChange={toggle('mealReminders')}
            />
          }
          label="Enable In-App Meal Reminders"
        />
        <FormControlLabel
          control={
            <Switch
              checked={settings.variableRewards}
              onChange={toggle('variableRewards')}
            />
          }
          label="Enable Variable Rewards"
        />
      </Stack>

      <Divider sx={{ mb: 3 }} />

      <Typography variant="h5" gutterBottom>
        Meal Reminder Times
      </Typography>

      {meals.map((meal, idx) => (
        <Stack
          key={idx}
          direction="row"
          spacing={2}
          alignItems="center"
          sx={{ mb: 2 }}
        >
          <TextField
            label="Meal name"
            value={meal.name}
            onChange={e => updateMeal(idx, 'name', e.target.value)}
            placeholder="e.g. Breakfast"
            fullWidth
          />
          <TextField
            label="Time"
            type="time"
            value={meal.time}
            onChange={e => updateMeal(idx, 'time', e.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{ step: 300 }}
            sx={{ width: 120 }}
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
