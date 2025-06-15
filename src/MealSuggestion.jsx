import React, { useState, useEffect, useContext } from 'react';
import {
  Card, CardContent, CardActions,
  Typography, Button, Box, Chip, CircularProgress
} from '@mui/material';
import { UserDataContext } from './UserDataContext';

export default function MealSuggestion({ consumedCalories, onAddMeal }) {
  const { dailyGoal, goalType, recentMeals = [] } = useContext(UserDataContext);

  const [meal,     setMeal]    = useState(null);
  const [loading,  setLoading] = useState(false);
  const [error,    setError]   = useState(null);
  const [tries,    setTries]   = useState(0);

  const hour   = new Date().getHours();
  const period = hour < 10
    ? 'Breakfast'
    : hour < 14
      ? 'Lunch'
      : hour < 17
        ? 'Snack'
        : 'Dinner';

  /** Fetch from our API (with up to 2 retries) */
  const fetchMeal = async () => {
    setLoading(true);
    setError(null);
    setTries(t => t + 1);

    try {
      const recent = recentMeals.slice(-3).join(',');
      const qs = new URLSearchParams({
        period,
        goalType,
        dailyGoal:   String(dailyGoal),
        consumed:    String(consumedCalories),
        recentMeals: recent
      });
      const resp = await fetch(`/api/suggestMeal?${qs}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      if (typeof data.calories !== 'number' || data.calories < 100) {
        throw new Error('BadCalories');
      }

      setMeal(data);
    } catch (err) {
      console.error('[MealSuggestion] fetch error', err);
      if (tries < 2) {
        return fetchMeal();
      }
      setError('Couldn’t fetch a valid suggestion. Try again.');
    } finally {
      setLoading(false);
    }
  };

  // Kick off our first fetch
  useEffect(() => {
    fetchMeal();
  }, []);  // ← Notice we don't return anything here!

  if (loading) {
    return (
      <Box sx={{ textAlign:'center', mt:2 }}>
        <CircularProgress />
        <Typography>Thinking of a meal…</Typography>
      </Box>
    );
  }
  if (error) {
    return (
      <Box sx={{ textAlign:'center', mt:2 }}>
        <Typography color="error">{error}</Typography>
        <Button onClick={fetchMeal}>RETRY</Button>
      </Box>
    );
  }
  if (!meal) return null;

  return (
    <Box>
      <Card sx={{ maxWidth:400, mx:'auto', mt:2, p:2 }}>
        <CardContent>
          <Box sx={{ display:'flex', alignItems:'center', mb:1, gap:1 }}>
            <Typography variant="h6">{meal.name}</Typography>
            <Chip label={period} size="small" />
          </Box>
          <Box sx={{ display:'flex', gap:2, mb:1, flexWrap:'wrap' }}>
            <Typography>🔥 {meal.calories}</Typography>
            {meal.macros && (
              <>
                <Typography>🥩 {meal.macros.p}g</Typography>
                <Typography>🌾 {meal.macros.c}g</Typography>
                <Typography>🥑 {meal.macros.f}g</Typography>
              </>
            )}
          </Box>
          <Typography variant="body2" color="textSecondary">
            ⏱ {meal.prepMinutes} min prep
          </Typography>
        </CardContent>
        <CardActions sx={{ justifyContent:'space-between' }}>
          <Button onClick={fetchMeal}>New Suggestion</Button>
          <Button
            variant="contained"
            onClick={() => onAddMeal({ name: meal.name, calories: meal.calories })}
          >
            Add &amp; Log
          </Button>
        </CardActions>
      </Card>
    </Box>
  );
}
