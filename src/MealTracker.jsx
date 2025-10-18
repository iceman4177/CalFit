import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Container, Typography, Box, TextField, Button, Paper,
  IconButton, Divider, ListItem, ListItemText, Tooltip
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { updateStreak } from './utils/streak';

const todayUS = () => new Date().toLocaleDateString('en-US');

function readMealsForToday() {
  const all = JSON.parse(localStorage.getItem('mealHistory') || '[]');
  const log = all.find(e => e.date === todayUS());
  const meals = log ? (log.meals || []) : [];
  return { meals, all };
}

function persistToday(meals) {
  const d = todayUS();
  const rest = JSON.parse(localStorage.getItem('mealHistory') || '[]').filter(e => e.date !== d);
  rest.push({ date: d, meals });
  localStorage.setItem('mealHistory', JSON.stringify(rest));
}

function emitConsumed(total) {
  try {
    window.dispatchEvent(new CustomEvent('slimcal:consumed:update', {
      detail: { date: new Date().toISOString().slice(0,10), consumed: total }
    }));
  } catch {}
}

export default function MealTracker({ onMealUpdate }) {
  const [{ meals }, setState] = useState(readMealsForToday());
  const [foodInput, setFoodInput] = useState('');
  const [calories, setCalories] = useState('');

  const total = useMemo(() => meals.reduce((s, m) => s + (Number(m.calories) || 0), 0), [meals]);

  const reload = useCallback(() => setState(readMealsForToday()), []);

  useEffect(() => {
    onMealUpdate?.(total);
  }, [total, onMealUpdate]);

  useEffect(() => {
    const kick = () => reload();
    const onStorage = e => {
      if (!e || !e.key || ['mealHistory'].includes(e.key)) kick();
    };
    const onVisOrFocus = () => kick();

    window.addEventListener('slimcal:consumed:update', kick);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisOrFocus);
    window.addEventListener('focus', onVisOrFocus);
    return () => {
      window.removeEventListener('slimcal:consumed:update', kick);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisOrFocus);
      window.removeEventListener('focus', onVisOrFocus);
    };
  }, [reload]);

  const save = (nextMeals) => {
    persistToday(nextMeals);
    const t = nextMeals.reduce((s, m) => s + (Number(m.calories) || 0), 0);
    onMealUpdate?.(t);
    emitConsumed(t);
  };

  const handleAdd = () => {
    const c = Number.parseInt(calories, 10);
    if (!foodInput.trim() || !Number.isFinite(c) || c <= 0) {
      alert('Enter a valid food & calories.');
      return;
    }
    const nm = { name: foodInput.trim(), calories: c };
    setState(prev => {
      const next = { ...prev, meals: [...prev.meals, nm] };
      persistToday(next.meals);
      const t = next.meals.reduce((s, m) => s + (Number(m.calories) || 0), 0);
      onMealUpdate?.(t);
      emitConsumed(t);
      return next;
    });
    updateStreak();
    setFoodInput('');
    setCalories('');
  };

  const handleDeleteMeal = (index) => {
    setState(prev => {
      const nextMeals = prev.meals.filter((_, i) => i !== index);
      persistToday(nextMeals);
      const t = nextMeals.reduce((s, m) => s + (Number(m.calories) || 0), 0);
      onMealUpdate?.(t);
      emitConsumed(t);
      return { ...prev, meals: nextMeals };
    });
  };

  const handleClear = () => {
    persistToday([]);
    onMealUpdate?.(0);
    emitConsumed(0);
    setState(readMealsForToday());
  };

  const dateLabel = useMemo(() => todayUS(), []);

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h4" align="center" sx={{ mb: 2 }}>
        Meal Tracker
      </Typography>

      <Paper sx={{ p: 2, mb: 2 }}>
        <TextField
          fullWidth
          label="Food Name"
          value={foodInput}
          onChange={(e) => setFoodInput(e.target.value)}
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          label="Calories"
          value={calories}
          onChange={(e) => setCalories(e.target.value.replace(/[^\d.]/g, ''))}
          sx={{ mb: 2 }}
          inputMode="decimal"
        />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="contained" onClick={handleAdd}>ADD MEAL</Button>
          <Button variant="outlined" color="error" onClick={handleClear}>CLEAR MEALS</Button>
        </Box>
      </Paper>

      <Typography variant="h6" sx={{ mb: 1 }}>
        Meals Logged Today ({dateLabel})
      </Typography>

      <Paper sx={{ p: 2 }}>
        {meals.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No meals added yet.
          </Typography>
        ) : (
          meals.map((m, idx) => (
            <Box key={`${m.name}-${idx}`} sx={{ py: 1 }}>
              <ListItem
                secondaryAction={
                  <IconButton aria-label="delete" onClick={() => handleDeleteMeal(idx)}>
                    <DeleteIcon />
                  </IconButton>
                }
              >
                <ListItemText primary={m.name} secondary={`${Number(m.calories) || 0} cals`} />
              </ListItem>
              {idx < meals.length - 1 && <Divider sx={{ mt: 1 }} />}
            </Box>
          ))
        )}

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle1">Total: {total} cals</Typography>
      </Paper>
    </Container>
  );
}
