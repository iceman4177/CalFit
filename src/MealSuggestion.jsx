import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardActions,
  Typography,
  Button,
  Box,
  Chip,
  CircularProgress
} from '@mui/material';
import { useUserData } from './UserDataContext'; // <- updated import

export default function MealSuggestion({ consumedCalories, onAddMeal }) {
  const { dailyGoal, goalType, recentMeals } = useUserData();

  const [suggestion, setSuggestion] = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);

  // decide meal period
  const hour   = new Date().getHours();
  const period = hour < 10 ? 'Breakfast'
               : hour < 14 ? 'Lunch'
               : hour < 17 ? 'Snack'
               : 'Dinner';

  // fetch from our API
  useEffect(() => {
    async function fetchSuggestion() {
      setLoading(true);
      setError(null);

      try {
        const resp = await fetch(
          `/api/suggestMeal?period=${period}&goalType=${goalType}` +
          `&dailyGoal=${dailyGoal}&consumed=${consumedCalories}` +
          `&recentMeals=${encodeURIComponent(recentMeals.join(','))}`
        , { method: 'GET' });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        if (data.name && data.calories != null) {
          setSuggestion(data);
        } else {
          throw new Error('Invalid suggestion format');
        }
      } catch (err) {
        console.error('[MealSuggestion] fetch error', err);
        setError('Couldn’t fetch a suggestion. Try again.');
      } finally {
        setLoading(false);
      }
    }

    fetchSuggestion();
  }, [period, goalType, dailyGoal, consumedCalories, recentMeals]);

  if (loading) {
    return (
      <Box sx={{ textAlign: 'center', mt: 2 }}>
        <CircularProgress />
        <Typography>Thinking of a meal…</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ textAlign: 'center', mt: 2 }}>
        <Typography color="error">{error}</Typography>
        <Button onClick={() => setSuggestion(null)}>Retry</Button>
      </Box>
    );
  }

  if (!suggestion) return null;

  return (
    <Box>
      <Card sx={{ maxWidth: 400, mx: 'auto', mt: 2, p: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, gap: 1 }}>
            <Typography variant="h6">{suggestion.name}</Typography>
            <Chip label={period} size="small" />
          </Box>
          <Box sx={{ display: 'flex', gap: 2, mb: 1, flexWrap: 'wrap' }}>
            <Typography>🔥 {suggestion.calories}</Typography>
            {suggestion.macros && (
              <>
                <Typography>🥩 {suggestion.macros.p}g</Typography>
                <Typography>🌾 {suggestion.macros.c}g</Typography>
                <Typography>🥑 {suggestion.macros.f}g</Typography>
              </>
            )}
          </Box>
          {suggestion.prepMinutes != null && (
            <Typography variant="body2" color="textSecondary">
              ⏱ {suggestion.prepMinutes} min prep
            </Typography>
          )}
        </CardContent>
        <CardActions sx={{ justifyContent: 'space-between' }}>
          <Button onClick={() => setSuggestion(null)}>New Suggestion</Button>
          <Button
            variant="contained"
            onClick={() => onAddMeal({
              name:       suggestion.name,
              calories:   suggestion.calories
            })}
          >
            Add &amp; Log
          </Button>
        </CardActions>
      </Card>
    </Box>
  );
}
