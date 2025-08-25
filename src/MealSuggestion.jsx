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
import { useUserData } from './UserDataContext';
import UpgradeModal from './components/UpgradeModal';

// ---- Pro gating helpers ----
const isProUser = () => {
  if (localStorage.getItem('isPro') === 'true') return true;
  const ud = JSON.parse(localStorage.getItem('userData') || '{}');
  return !!ud.isPremium;
};

const isTrialActive = () => {
  const ts = parseInt(localStorage.getItem('trialEndTs') || '0', 10);
  return ts && Date.now() < ts;
};

const getMealAIRefreshCount = () => {
  const today = new Date().toLocaleDateString('en-US');
  const savedDate = localStorage.getItem('aiMealRefreshDate');
  if (savedDate !== today) {
    localStorage.setItem('aiMealRefreshDate', today);
    localStorage.setItem('aiMealRefreshCount', '0');
    return 0;
  }
  return parseInt(localStorage.getItem('aiMealRefreshCount') || '0', 10);
};

const incMealAIRefreshCount = () => {
  const today = new Date().toLocaleDateString('en-US');
  localStorage.setItem('aiMealRefreshDate', today);
  const newCount = getMealAIRefreshCount() + 1;
  localStorage.setItem('aiMealRefreshCount', String(newCount));
};

export default function MealSuggestion({ consumedCalories, onAddMeal }) {
  const { dailyGoal, goalType, recentMeals } = useUserData();

  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const hour = new Date().getHours();
  const period =
    hour < 10 ? 'Breakfast' :
    hour < 14 ? 'Lunch' :
    hour < 17 ? 'Snack' :
    'Dinner';

  const fetchSuggestions = useCallback(async () => {
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
      if (!resp.ok) throw new Error(`Server responded ${resp.status}`);

      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error('Invalid JSON from server');
      }

      let meals = Array.isArray(data?.suggestions) ? data.suggestions : [];

      meals = meals.map((m) => {
        let safeCalories = 0;

        // ✅ Handle number
        if (typeof m?.calories === "number" && !isNaN(m.calories)) {
          safeCalories = m.calories;
        }
        // ✅ Handle string like "420 kcal"
        else if (typeof m?.calories === "string") {
          const match = m.calories.match(/\d+/);
          if (match) safeCalories = parseInt(match[0], 10);
        }

        return {
          name: m?.name || "Unknown meal",
          calories: safeCalories,
          macros: m?.macros || { p: 0, c: 0, f: 0 },
          prepMinutes: m?.prepMinutes || null,
        };
      });

      if (!meals.length) throw new Error('No meal suggestions found');

      setSuggestions(meals);
    } catch (err) {
      console.error('[MealSuggestion] fetch error', err);
      setError('Couldn’t fetch meal suggestions. Please try again.');
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [period, goalType, dailyGoal, consumedCalories, recentMeals]);

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions, refreshKey]);

  const handleRetry = () => {
    if (!isProUser() && !isTrialActive()) {
      const used = getMealAIRefreshCount();
      if (used >= 3) {
        setShowUpgrade(true);
        return;
      }
      incMealAIRefreshCount();
    }
    setRefreshKey((k) => k + 1);
  };

  if (loading) {
    return (
      <Box sx={{ textAlign: 'center', mt: 2 }}>
        <CircularProgress />
        <Typography sx={{ mt: 1 }}>Thinking of meals…</Typography>
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

  if (!suggestions.length) return null;

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="h6" align="center" gutterBottom>
        {period} Ideas
      </Typography>

      {suggestions.map((s, idx) => (
        <Card key={idx} sx={{ p: 1, mb: 2, maxWidth: 400, mx: "auto" }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, gap: 1 }}>
              <Typography variant="subtitle1">{s.name}</Typography>
              <Chip label={period} size="small" />
            </Box>

            <Box sx={{ display: 'flex', gap: 2, mb: 1, flexWrap: 'wrap' }}>
              <Typography>🔥 {s.calories}</Typography>
              {s.macros && (
                <>
                  <Typography>🥩 {s.macros.p}g</Typography>
                  <Typography>🌾 {s.macros.c}g</Typography>
                  <Typography>🥑 {s.macros.f}g</Typography>
                </>
              )}
            </Box>

            {s.prepMinutes != null && (
              <Typography variant="body2" color="textSecondary">
                ⏱ {s.prepMinutes} min prep
              </Typography>
            )}
          </CardContent>

          <CardActions sx={{ justifyContent: 'space-between' }}>
            <Button onClick={handleRetry}>Refresh</Button>
            <Button
              variant="contained"
              onClick={() => onAddMeal({ name: s.name, calories: s.calories })}
            >
              Add & Log
            </Button>
          </CardActions>
        </Card>
      ))}

      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        title="Upgrade to Slimcal Pro"
        description="You’ve reached your 3 free daily AI meal suggestions. Upgrade for unlimited access."
      />
    </Box>
  );
}
