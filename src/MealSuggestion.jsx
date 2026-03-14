// src/MealSuggestion.jsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card,
  CardContent,
  CardActions,
  Typography,
  Button,
  Box,
  Chip,
  Skeleton,
  Stack
} from '@mui/material';
import UpgradeModal from './components/UpgradeModal';
import { useAuth } from './context/AuthProvider.jsx';
import { canUseDailyFeature, registerDailyFeatureUse, setDailyRemaining, getDailyRemaining } from './components/FeatureUseBadge.jsx';
import { postAI, getAIQuotaStatus } from './lib/ai';

// ---- entitlement helpers for refresh button ----
const isProUser = () => {
  if (localStorage.getItem('isPro') === 'true') return true;
  const ud = JSON.parse(localStorage.getItem('userData') || '{}');
  return !!ud.isPremium;
};

const isTrialActive = () => {
  const ts = parseInt(localStorage.getItem('trialEndTs') || '0', 10);
  return ts && Date.now() < ts;
};

// stable per-device id to count free uses
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

// macro balance helper
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

// POST helper
async function postJSON(url, payload) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': getClientId()
    },
    body: JSON.stringify(payload)
  });

  const text = await resp.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { resp, json, raw: text };
}

// normalize meal objects returned by server
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
  return list.map(m => {
    const name = m?.title || m?.name || m?.label || 'Suggested meal';

    // pick calories from any of the known fields
    const kcal =
      (Number.isFinite(+m?.calories) ? +m.calories : null) ??
      (Number.isFinite(+m?.kcal) ? +m.kcal : null) ??
      (Number.isFinite(+m?.energy_kcal) ? +m.energy_kcal : null) ??
      (Number.isFinite(+m?.nutrition?.calories) ? +m.nutrition.calories : null) ??
      0;

    const p =
      (Number.isFinite(+m?.protein_g) ? +m.protein_g : null) ??
      (Number.isFinite(+m?.protein) ? +m.protein : null) ??
      (Number.isFinite(+m?.nutrition?.protein_g) ? +m.nutrition.protein_g : null) ??
      (m?.macros?.p ?? 0);

    const c =
      (Number.isFinite(+m?.carbs_g) ? +m.carbs_g : null) ??
      (Number.isFinite(+m?.carbs) ? +m.carbs : null) ??
      (Number.isFinite(+m?.nutrition?.carbs_g) ? +m.nutrition.carbs_g : null) ??
      (m?.macros?.c ?? 0);

    const f =
      (Number.isFinite(+m?.fat_g) ? +m.fat_g : null) ??
      (Number.isFinite(+m?.fat) ? +m.fat : null) ??
      (Number.isFinite(+m?.nutrition?.fat_g) ? +m.nutrition.fat_g : null) ??
      (m?.macros?.f ?? 0);

    const prepMinutes = m?.prepMinutes ?? m?.prep_min ?? null;

    return {
      name,
      calories: Math.max(0, Math.round(kcal || 0)),
      macros: {
        p: Math.max(0, Math.round(p || 0)),
        c: Math.max(0, Math.round(c || 0)),
        f: Math.max(0, Math.round(f || 0))
      },
      prepMinutes
    };
  });
}

function SkeletonCard() {
  return (
    <Card
      sx={{
        p: 1,
        mb: 2,
        width: '100%',
        maxWidth: 480,
        mx: 'auto',
        borderRadius: 2,
        overflow: 'visible' // ✅ prevent any clipping in skeleton state
      }}
    >
      <CardContent sx={{ pb: 1, overflow: 'visible' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Skeleton variant="text" width="60%" height={24} />
          <Skeleton variant="rounded" width={60} height={22} />
        </Stack>
        <Stack direction="row" spacing={2} sx={{ mb: 1 }}>
          <Skeleton variant="text" width={60} />
          <Skeleton variant="text" width={60} />
          <Skeleton variant="text" width={60} />
          <Skeleton variant="text" width={60} />
        </Stack>
        <Skeleton variant="text" width="90%" />
        <Skeleton variant="text" width="50%" />
      </CardContent>
      <CardActions sx={{ justifyContent: 'space-between', pt: 0, px: 2, pb: 2 }}>
        <Skeleton variant="rounded" width={80} height={32} />
        <Skeleton variant="rounded" width={110} height={32} />
      </CardActions>
    </Card>
  );
}

export default function MealSuggestion({ consumedCalories, onAddMeal, onQuotaChange }) {
  const { user } = useAuth();

  // snapshot consumed calories at mount so we don't keep re-fetching
  const [baseConsumed] = useState(consumedCalories);

  // pull diet / goals for personalization
  const stored = JSON.parse(localStorage.getItem('userData') || '{}');
  const dailyGoal = stored.dailyGoal || 0;
  const goalType = stored.goalType || 'maintenance';

  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const proOrTrial = isProUser() || isTrialActive();
  const [quotaTick, setQuotaTick] = useState(0);
  const freeRefreshesLeft = getDailyRemaining('ai_meal');
  const lockInteractions = useMemo(
    () => !proOrTrial && freeRefreshesLeft <= 0,
    [proOrTrial, freeRefreshesLeft, quotaTick]
  );

  useEffect(() => {
    if (lockInteractions) setShowUpgrade(true);
  }, [lockInteractions]);

  const upgradeModalNode = (
    <UpgradeModal
      open={showUpgrade}
      onClose={() => setShowUpgrade(false)}
      title="Unlock unlimited meal ideas"
      description="You’ve used today’s free AI refreshes. Start a 7-day trial of Slimcal Pro to continue."
    />
  );

  // time-of-day label
  const hour = new Date().getHours();
  const period = hour < 10 ? 'Breakfast' : hour < 14 ? 'Lunch' : hour < 17 ? 'Snack' : 'Dinner';

  // fetch from server
  const fetchSuggestions = useCallback(async () => {
    setLoading(true);
    setErrMsg(null);

    try {
      const dietPreference = localStorage.getItem('diet_preference') || 'omnivore';
      const trainingIntent = localStorage.getItem('training_intent') || 'general';
      const proteinMealG = parseInt(localStorage.getItem('protein_target_meal_g') || '0', 10);
      const calorieBias = parseInt(localStorage.getItem('calorie_bias') || '0', 10);

      // meal budget snapshot (based on calories already eaten when panel opened)
      const remaining = Math.max(0, (dailyGoal || 0) + (calorieBias || 0) - (baseConsumed || 0));
      const mealBudget = Math.max(250, Math.round(remaining / 3));

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

      let data;
      try {
        data = await postAI('meal', basePayload);
      } catch (e) {
        if (e?.code === 402) {
          setShowUpgrade(true);
          setSuggestions([]);
          setLoading(false);
          return;
        }
        throw e;
      }

      if (!proOrTrial) {
        if (typeof data?.remaining === 'number') {
          setDailyRemaining('ai_meal', data.remaining);
          onQuotaChange?.(data.remaining);
          setQuotaTick(k => k + 1);
        } else {
          registerDailyFeatureUse('ai_meal');
          const rem = getDailyRemaining('ai_meal');
          onQuotaChange?.(rem);
          setQuotaTick(k => k + 1);
        }
      }

      let meals = coerceMeals(data);

      // enrich each suggestion with "why"
      meals = meals.map(m => {
        const p = m.macros?.p ?? 0;
        const c = m.macros?.c ?? 0;
        const f = m.macros?.f ?? 0;
        const ok = withinSoftMacroRanges({ kcal: m.calories, p, c, f });

        const why = [
          proteinMealG
            ? p >= proteinMealG - 3
              ? `Hits ~${proteinMealG}g protein/meal`
              : `Aim ~${proteinMealG}g protein/meal`
            : null,
          ok ? 'Balanced macros' : 'Adjust carbs/fats to balance macros',
          dietPreference ? `Diet: ${dietPreference}` : null
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
      setErrMsg('Couldn’t fetch meal suggestions. Please try again.');
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id, goalType, dailyGoal, baseConsumed, proOrTrial, onQuotaChange]);

  useEffect(() => {
    let active = true;
    const syncQuota = async () => {
      if (proOrTrial) return;
      try {
        const q = await getAIQuotaStatus('meal');
        if (!active) return;
        if (typeof q?.remaining === 'number') {
          setDailyRemaining('ai_meal', q.remaining);
          onQuotaChange?.(q.remaining);
          setQuotaTick(k => k + 1);
        }
      } catch {}
    };
    syncQuota();
    window.addEventListener('focus', syncQuota);
    return () => {
      active = false;
      window.removeEventListener('focus', syncQuota);
    };
  }, [proOrTrial, onQuotaChange]);

  // initial + when user taps Refresh
  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions, refreshKey]);

  const handleRefreshClick = () => {
    if (!proOrTrial && !canUseDailyFeature('ai_meal')) {
      setShowUpgrade(true);
      return;
    }
    setRefreshKey(k => k + 1);
  };

  // "Add & Log" on a single suggestion
  const handleLogAndRemove = idx => {
    const meal = suggestions[idx];
    if (!meal) return;

    // if gated, show upgrade instead of logging
    if (lockInteractions) {
      setShowUpgrade(true);
      return;
    }

    // log up in parent
    onAddMeal?.({
      name: meal.name,
      calories: Math.max(0, Number(meal.calories) || 0),
      macros: {
        protein_g: Math.max(0, Number(meal?.macros?.p) || 0),
        carbs_g: Math.max(0, Number(meal?.macros?.c) || 0),
        fat_g: Math.max(0, Number(meal?.macros?.f) || 0)
      }
    });

    // remove just that meal locally
    setSuggestions(prev => prev.filter((_, i) => i !== idx));
  };

  // ---------- UI: Loading ----------
  if (loading) {
    return (
      <Box sx={{ mt: 3 }}>
        <Typography
          variant="subtitle2"
          sx={{
            textTransform: 'uppercase',
            fontWeight: 600,
            color: 'text.secondary',
            textAlign: 'center',
            letterSpacing: 0.4,
            mb: 1
          }}
        >
          Finding {period} ideas…
        </Typography>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </Box>
    );
  }

  // ---------- UI: Error ----------
  if (errMsg) {
    return (
      <>
        <Box sx={{ textAlign: 'center', mt: 3 }}>
          <Typography color="error" sx={{ mb: 1 }}>
            {errMsg}
          </Typography>
          <Button
            onClick={handleRefreshClick}
            variant="contained"
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Retry
          </Button>
        </Box>
        {upgradeModalNode}
      </>
    );
  }

  // ---------- UI: Empty ----------
  if (!suggestions.length) {
    return (
      <>
        <Box sx={{ textAlign: 'center', mt: 3 }}>
          <Typography sx={{ mb: 1 }}>No more ideas right now.</Typography>
          <Button
            onClick={handleRefreshClick}
            variant="contained"
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Get New Ideas
          </Button>
        </Box>
        {upgradeModalNode}
      </>
    );
  }

  // ---------- UI: Suggestions ----------
  return (
    <Box sx={{ mt: 3, position: 'relative' }}>
      <Typography
        variant="subtitle2"
        sx={{
          textTransform: 'uppercase',
          fontWeight: 600,
          color: 'text.secondary',
          textAlign: 'center',
          letterSpacing: 0.4,
          mb: 1
        }}
      >
        {period} Ideas
      </Typography>

      {/* Blur overlay when interactions are locked (non-Pro, no free refreshes left) */}
      {lockInteractions && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 2,
            backdropFilter: 'blur(3px)',
            background:
              'linear-gradient(to bottom, rgba(255,255,255,0.6), rgba(255,255,255,0.7))',
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            px: 2,
            textAlign: 'center'
          }}
        >
          <Box>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
              Unlock unlimited meal ideas
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              You’ve used today’s free AI refreshes. Start a 7-day trial of Slimcal Pro to continue.
            </Typography>
            <Button
              variant="contained"
              sx={{ textTransform: 'none', fontWeight: 700 }}
              onClick={() => setShowUpgrade(true)}
            >
              Start Free Trial
            </Button>
          </Box>
        </Box>
      )}

      {upgradeModalNode}

      {suggestions.map((s, idx) => (
        <Card
          key={idx}
          sx={{
            p: 1,
            mb: 2,
            width: '100%',
            maxWidth: 480,
            mx: 'auto',
            borderRadius: 2,
            overflow: 'visible', // ✅ allow any nested badge/chips to render safely
            border: '1px solid rgba(0,0,0,0.04)',
            boxShadow: '0 16px 40px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.03)'
          }}
        >
          <CardContent sx={{ pb: 1, overflow: 'visible' }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                mb: 1,
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 1
              }}
            >
              <Typography variant="subtitle1" fontWeight={700} sx={{ lineHeight: 1.25 }}>
                {s.name}
              </Typography>
              <Chip label={period} size="small" />
            </Box>

            <Box
              sx={{
                display: 'flex',
                gap: 2,
                flexWrap: 'wrap',
                mb: 1,
                fontSize: '0.92rem',
                alignItems: 'center'
              }}
            >
              <Typography>🔥 {Math.max(0, Number(s.calories) || 0)} kcal</Typography>
              {s.macros && (
                <>
                  <Typography>🥩 {Math.max(0, Number(s.macros.p) || 0)}g</Typography>
                  <Typography>🌾 {Math.max(0, Number(s.macros.c) || 0)}g</Typography>
                  <Typography>🥑 {Math.max(0, Number(s.macros.f) || 0)}g</Typography>
                </>
              )}
              {typeof s.prepMinutes === 'number' && (
                <Typography>⏱ {Math.max(0, Math.round(s.prepMinutes))} min</Typography>
              )}
            </Box>

            {s._why && (
              <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                💡 {s._why}
              </Typography>
            )}
          </CardContent>

          <CardActions
            sx={{
              justifyContent: 'space-between',
              pt: 0,
              px: 2,
              pb: 2
            }}
          >
            <Button
              size="small"
              variant="text"
              onClick={handleRefreshClick}
              sx={{ textTransform: 'none', fontWeight: 500 }}
              disabled={lockInteractions}
            >
              Refresh
              {!proOrTrial && (
                <Typography
                  component="span"
                  sx={{ ml: 1, fontSize: '0.8rem', color: 'text.secondary' }}
                >
                  {freeRefreshesLeft} left
                </Typography>
              )}
            </Button>

            <Button
              size="small"
              variant="contained"
              sx={{ textTransform: 'none', fontWeight: 700 }}
              onClick={() => handleLogAndRemove(idx)}
              disabled={lockInteractions}
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
