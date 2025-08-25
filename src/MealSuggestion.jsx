// src/MealSuggestion.jsx
import React, { useState, useEffect, useCallback } from 'react';
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
  const [refreshKey, setRefreshKey] = useState(0); // trigger re-fetch on demand

  // decide meal period
  const hour   = new Date().getHours();
  const period = hour < 10 ? 'Breakfast'
               : hour < 14 ? 'Lunch'
               : hour < 17 ? 'Snack'
               : 'Dinner';

  const fetchSuggestion = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const resp = await fetch('/api/ai/meal-suggestion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period,
          goalType,
          dailyGoal,
          consumedCalories,
          recentMeals
        })
      });

      const raw = await resp.text();

      if (!resp.ok) {
        // Surface server error details for debugging
        console.error('[MealSuggestion] non-OK response:', resp.status, raw);
        throw new Error(`Server responded ${resp.status}`);
      }

      // Parse JSON safely
      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        console.error('[MealSuggestion] response was not JSON:', raw);
        throw new Error('Invalid JSON from server');
      }

      // Accept either { ok:true, suggestion:{ name, calories, ... } }
      // or legacy { name, calories, ... }
      let s =
        (data && data.suggestion && data.suggestion.name && data.suggestion.calories != null)
          ? data.suggestion
          : (data && data.name && data.calories != null)
            ? data
            : null;

      if (!s) {
        console.error('[MealSuggestion] bad payload shape:', data);
        throw new Error('Unexpected payload from server');
      }

      setSuggestion(s);
    } catch (err) {
      console.error('[MealSuggestion] fetch error', err);
      setError('Couldn’t fetch a suggestion. Please try again.');
      setSuggestion(null);
    } finally {
      setLoading(false);
    }
  }, [period, goalType, dailyGoal, consumedCalories, recentMeals]);

  // initial + whenever inputs change or refreshKey increments
  useEffect(() => {
    fetchSuggestion();
  }, [fetchSuggestion, refreshKey]);

  const handleRetry = () => setRefreshKey(k => k + 1);

  if (loading) {
    return (
      <Box sx={{ textAlign: 'center', mt: 2 }}>
        <CircularProgress />
        <Typography sx={{ mt: 1 }}>Thinking of a meal…</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ textAlign: 'center', mt: 2 }}>
        <Typography color="error" sx={{ mb: 1 }}>{error}</Typography>
        <Button onClick={handleRetry}>Retry</Button>
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
          <Button onClick={handleRetry}>New Suggestion</Button>
          <Button
            variant="contained"
            onClick={() =>
              onAddMeal({
                name:     suggestion.name,
                calories: suggestion.calories
              })
            }
          >
            Add &amp; Log
          </Button>
        </CardActions>
      </Card>
    </Box>
  );
}
