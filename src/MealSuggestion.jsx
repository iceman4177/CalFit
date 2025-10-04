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

// ---- Pro gating helpers (still used for refresh button fallback) ----
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

// small inline helpers to avoid extra files
function withinSoftMacroRanges({ kcal, p, c, f }) {
  if (!kcal || kcal <= 0) return true;
  const pK = (p || 0) * 4, cK = (c || 0) * 4, fK = (f || 0) * 9;
  const tot = pK + cK + fK || 1;
  const carbPct = (cK / tot) * 100;
  const fatPct  = (fK / tot) * 100;
  return carbPct >= 35 && carbPct <= 70 && fatPct >= 15 && fatPct <= 40;
}

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
      // pull personalization context saved by HealthDataForm
      const dietPreference   = localStorage.getItem('diet_preference') || 'omnivore';
      const trainingIntent   = localStorage.getItem('training_intent') || 'general';
      const proteinMealG     = parseInt(localStorage.getItem('protein_target_meal_g') || '0',10);
      const calorieBias      = parseInt(localStorage.getItem('calorie_bias') || '0',10);

      // derive a suggested budget for this meal based on remaining calories
      const remaining = Math.max(0, (dailyGoal || 0) + (calorieBias || 0) - (consumedCalories || 0));
      const mealBudget = Math.max(250, Math.round(remaining / 3)); // soft heuristic

      const resp = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature: 'meal',
          user_id: JSON.parse(localStorage.getItem('supabase.auth.token') || 'null')?.user?.id || null, // if available
          goal: goalType || 'maintenance',
          constraints: {
            diet_preference: dietPreference,
            training_intent: trainingIntent,
            protein_per_meal_g: proteinMealG || undefined,
            calorie_bias: calorieBias || undefined,
            meal_budget_kcal: mealBudget,
            avoid_recent: recentMeals?.slice(-5) || []
          },
          count: 5
        })
      });

      if (resp.status === 402) {
        setShowUpgrade(true);
        setSuggestions([]);
        setLoading(false);
        return;
      }

      const raw = await resp.text();
      if (!resp.ok) throw new Error(`Server responded ${resp.status}`);

      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error('Invalid JSON from server');
      }

      // gateway returns { suggestions: [ { title, calories, protein_g, carbs_g, fat_g, ingredients, instructions } ] }
      let meals = Array.isArray(data?.suggestions) ? data.suggestions : [];

      meals = meals.map((m) => {
        const name = m?.title || m?.name || "Suggested meal";
        const kcal = Number.isFinite(+m?.calories) ? +m.calories : 0;
        const p = Number.isFinite(+m?.protein_g) ? +m.protein_g : (m?.macros?.p || 0);
        const c = Number.isFinite(+m?.carbs_g)   ? +m.carbs_g   : (m?.macros?.c || 0);
        const f = Number.isFinite(+m?.fat_g)     ? +m.fat_g     : (m?.macros?.f || 0);

        const ok = withinSoftMacroRanges({ kcal, p, c, f });
        const why = [
          proteinMealG ? (p >= proteinMealG - 3 ? `Hits ~${proteinMealG}g protein/meal` : `Aim ~${proteinMealG}g protein/meal`) : null,
          ok ? "Balanced macros" : "Adjust carbs/fats to balance macros",
          dietPreference ? `Diet: ${dietPreference}` : null
        ].filter(Boolean).join(" • ");

        return {
          name,
          calories: kcal,
          macros: { p, c, f },
          prepMinutes: m?.prepMinutes ?? null,
          _why: why
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
    // client-side fallback limit for refreshes
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
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, gap: 1, justifyContent: 'space-between' }}>
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

            {s._why && (
              <Typography variant="body2" color="textSecondary">
                💡 {s._why}
              </Typography>
            )}

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
        description="You’ve reached your free daily AI limit. Upgrade for unlimited smart meal suggestions."
      />
    </Box>
  );
}
