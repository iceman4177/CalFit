// src/MealSuggestion.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import UpgradeModal from './components/UpgradeModal';
import { useAuth } from './context/AuthProvider.jsx';

// ---- Pro / trial gating helpers (used for "Refresh" button limit) ----
const isProUser = () => {
  if (localStorage.getItem('isPro') === 'true') return true;
  const ud = JSON.parse(localStorage.getItem('userData') || '{}');
  return !!ud.isPremium;
};

const isTrialActive = () => {
  const ts = parseInt(localStorage.getItem('trialEndTs') || '0', 10);
  return ts && Date.now() < ts;
};

// keep per-device tries for non-signed-in users
function getClientId() {
  try {
    let cid = localStorage.getItem('clientId');
    if (!cid) {
      cid = (crypto?.randomUUID?.() || String(Date.now())).slice(0, 36);
      localStorage.setItem('clientId', cid);
    }
    return cid;
  } catch {
    return 'anon';
  }
}

// local daily refresh counter for free users
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

// --- tiny helpers ---
function withinSoftMacroRanges({ kcal, p, c, f }) {
  if (!kcal || kcal <= 0) return true;
  const pK = (p || 0) * 4;
  const cK = (c || 0) * 4;
  const fK = (f || 0) * 9;
  const tot = pK + cK + fK || 1;
  const carbPct = (cK / tot) * 100;
  const fatPct = (fK / tot) * 100;
  return carbPct >= 35 && carbPct <= 70 && fatPct >= 15 && fatPct <= 40;
}

async function postJSON(url, payload) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': getClientId(), // lets backend bucket anon devices
    },
    body: JSON.stringify(payload)
  });
  const text = await resp.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* noop */ }
  return { resp, json, raw: text };
}

// Accept multiple backend shapes + normalize
function coerceMeals(data) {
  if (!data) return [];
  const arr =
    (Array.isArray(data) ? data : null) ||
    data?.suggestions ||
    data?.meals ||
    data?.items ||
    data?.data ||
    data?.result ||
    [];

  const list = Array.isArray(arr) ? arr : [];
  return list.map((m) => {
    const name =
      m?.title ||
      m?.name ||
      m?.label ||
      'Suggested meal';

    // calories
    const kcal =
      (Number.isFinite(+m?.calories) ? +m.calories : null) ??
      (Number.isFinite(+m?.kcal) ? +m.kcal : null) ??
      (Number.isFinite(+m?.energy_kcal) ? +m.energy_kcal : null) ??
      (Number.isFinite(+m?.nutrition?.calories) ? +m.nutrition.calories : null) ??
      0;

    // protein
    const p =
      (Number.isFinite(+m?.protein_g) ? +m.protein_g : null) ??
      (Number.isFinite(+m?.protein) ? +m.protein : null) ??
      (Number.isFinite(+m?.nutrition?.protein_g) ? +m.nutrition.protein_g : null) ??
      (m?.macros?.p ?? 0);

    // carbs
    const c =
      (Number.isFinite(+m?.carbs_g) ? +m.carbs_g : null) ??
      (Number.isFinite(+m?.carbs) ? +m.carbs : null) ??
      (Number.isFinite(+m?.nutrition?.carbs_g) ? +m.nutrition.carbs_g : null) ??
      (m?.macros?.c ?? 0);

    // fats
    const f =
      (Number.isFinite(+m?.fat_g) ? +m.fat_g : null) ??
      (Number.isFinite(+m?.fat) ? +m.fat : null) ??
      (Number.isFinite(+m?.nutrition?.fat_g) ? +m.nutrition.fat_g : null) ??
      (m?.macros?.f ?? 0);

    const prepMinutes = m?.prepMinutes ?? m?.prep_min ?? null;

    return {
      name,
      calories: kcal || 0,
      macros: { p: p || 0, c: c || 0, f: f || 0 },
      prepMinutes
    };
  });
}

export default function MealSuggestion({
  consumedCalories,
  onAddMeal
}) {
  const { user } = useAuth();

  // pull baseline prefs from localStorage
  const stored   = JSON.parse(localStorage.getItem('userData') || '{}');
  const dailyGoal = stored.dailyGoal || 0;
  const goalType  = stored.goalType  || 'maintenance';

  // state
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);
  const [refreshKey, setRefreshKey]   = useState(0);
  const [showUpgrade, setShowUpgrade] = useState(false);

  // we "freeze" the calories snapshot on first render of this component
  // so adding/logging a meal won't instantly trigger new fetch logic
  const baseConsumedRef = useRef(consumedCalories);

  // derive meal "time of day" label (Breakfast/Lunch/Snack/Dinner)
  const hour = new Date().getHours();
  const period =
    hour < 10 ? 'Breakfast' :
    hour < 14 ? 'Lunch' :
    hour < 17 ? 'Snack' :
    'Dinner';

  // ---- core fetcher (called on mount + manual refresh)
  const fetchSuggestions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // personalization context saved by HealthDataForm
      const dietPreference   = localStorage.getItem('diet_preference') || 'omnivore';
      const trainingIntent   = localStorage.getItem('training_intent') || 'general';
      const proteinMealG     = parseInt(localStorage.getItem('protein_target_meal_g') || '0',10);
      const calorieBias      = parseInt(localStorage.getItem('calorie_bias') || '0',10);

      // instead of live "consumedCalories", use frozen snapshot from when
      // the card was first opened. That stops re-fetch on every Add&Log.
      const consumedSnapshot = baseConsumedRef.current || 0;
      const remaining  = Math.max(
        0,
        (dailyGoal || 0) + (calorieBias || 0) - consumedSnapshot
      );
      const mealBudget = Math.max(250, Math.round(remaining / 3)); // soft heuristic

      const basePayload = {
        feature: 'meal',
        type: 'meal',
        mode: 'meal',
        user_id: user?.id || null,
        goal: goalType || 'maintenance',
        constraints: {
          diet_preference: dietPreference,
          training_intent: trainingIntent,
          protein_per_meal_g: proteinMealG || undefined,
          calorie_bias: calorieBias || undefined,
          meal_budget_kcal: mealBudget
        },
        count: 5
      };

      // try unified gateway first
      let { resp, json, raw } = await postJSON('/api/ai/generate', basePayload);

      // 402 means user is gated (hit free limit / needs Pro)
      if (resp.status === 402) {
        setShowUpgrade(true);
        setSuggestions([]);
        setLoading(false);
        return;
      }

      // legacy fallback if /api/ai/generate returns 400/404 (older deployments)
      if (!resp.ok && (resp.status === 404 || resp.status === 400)) {
        const fallback = await postJSON('/api/ai/meal-suggestion', basePayload);
        resp = fallback.resp; json = fallback.json; raw = fallback.raw;
      }

      if (!resp.ok) {
        throw new Error(
          `Server responded ${resp.status}${raw ? ` - ${raw}` : ''}`
        );
      }

      // normalize
      let meals = coerceMeals(json);

      // add "why this meal" context for UI
      meals = meals.map((m) => {
        const p = m.macros?.p ?? 0;
        const c = m.macros?.c ?? 0;
        const f = m.macros?.f ?? 0;

        const ok = withinSoftMacroRanges({
          kcal: m.calories,
          p, c, f
        });

        const pTarget = proteinMealG || 0;

        const why = [
          pTarget
            ? (p >= pTarget - 3
                ? `Hits ~${pTarget}g protein/meal`
                : `Aim ~${pTarget}g protein/meal`)
            : null,
          ok
            ? 'Balanced macros'
            : 'Adjust carbs/fats to balance macros',
          dietPreference
            ? `Diet: ${dietPreference}`
            : null
        ]
          .filter(Boolean)
          .join(' • ');

        return { ...m, _why: why };
      });

      if (!meals.length) {
        throw new Error('No meal suggestions found');
      }

      setSuggestions(meals);
    } catch (err) {
      console.error('[MealSuggestion] fetch error', err);
      setError('Couldn’t fetch meal suggestions. Please try again.');
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, goalType, dailyGoal /* we intentionally do NOT depend on consumedCalories */]);

  // initial + when refreshKey changes
  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions, refreshKey]);

  // ---- user taps "Refresh"
  const handleRetry = () => {
    // free users get 3 refreshes total per day; pro/trial unlimited
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

  // ---- user taps "Add & Log"
  const handleAddAndLog = (idx) => {
    const s = suggestions[idx];
    if (!s) return;

    // log in parent (this updates meal log + streak + totals)
    onAddMeal({
      name: s.name,
      calories: Math.max(0, Number(s.calories) || 0)
    });

    // locally remove JUST that one suggestion
    setSuggestions((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next;
    });
  };

  // ---- render states ----
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

  // if no suggestions (either all logged or failed), don't render list
  if (!suggestions.length) {
    return (
      <>
        <UpgradeModal
          open={showUpgrade}
          onClose={() => setShowUpgrade(false)}
          title="Upgrade to Slimcal Pro"
          description="You’ve reached your free daily AI limit. Upgrade for unlimited smart meal suggestions."
        />
      </>
    );
  }

  // ---- main UI ----
  return (
    <Box sx={{ mt: 3 }}>
      <Typography variant="h6" align="center" gutterBottom>
        {period} Ideas
      </Typography>

      {suggestions.map((s, idx) => (
        <Card key={idx} sx={{ p: 1, mb: 2, maxWidth: 400, mx: 'auto' }}>
          <CardContent>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                mb: 1,
                gap: 1,
                justifyContent: 'space-between'
              }}
            >
              <Typography variant="subtitle1">{s.name}</Typography>
              <Chip label={period} size="small" />
            </Box>

            <Box sx={{ display: 'flex', gap: 2, mb: 1, flexWrap: 'wrap' }}>
              <Typography>
                🔥 {Math.max(0, Number(s.calories) || 0)}
              </Typography>
              {s.macros && (
                <>
                  <Typography>
                    🥩 {Math.max(0, Number(s.macros.p) || 0)}g
                  </Typography>
                  <Typography>
                    🌾 {Math.max(0, Number(s.macros.c) || 0)}g
                  </Typography>
                  <Typography>
                    🥑 {Math.max(0, Number(s.macros.f) || 0)}g
                  </Typography>
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
              onClick={() => handleAddAndLog(idx)}
            >
              Add &amp; Log
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
