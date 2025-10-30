// src/DailyRecapCoach.jsx
import React, { useMemo, useState, useCallback } from 'react';
import {
  Box, Button, CircularProgress, Typography, Card, CardContent,
  Stack, Divider, Chip, Alert,
} from '@mui/material';
import UpgradeModal from './components/UpgradeModal';
import { useAuth } from './context/AuthProvider.jsx';
import { EntitlementsContext } from './context/EntitlementsContext.jsx';
import useAiQuota from './hooks/useAiQuota.js';
import { getWorkouts, getWorkoutSetsFor, getDailyMetricsRange, getMeals } from './lib/db';
import { getSupabaseUserFromStorage, postAI, probeEntitlement } from './lib/ai';

// ---------- helpers ----------
const SCALE = 0.1; // kcal per (lb*rep) rough proxy

function isoDay(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}
function usDay(d = new Date()) {
  return new Date(d).toLocaleDateString('en-US');
}

function calcCaloriesFromSets(sets) {
  if (!Array.isArray(sets) || sets.length === 0) return 0;
  let vol = 0;
  for (const s of sets) {
    const w = Number(s.weight) || 0;
    const r = Number(s.reps) || 0;
    vol += w * r;
  }
  return Math.round(vol * SCALE);
}

function normalizeIntent(s) {
  const v = String(s || 'general').toLowerCase();
  if (v === 'yoga' || v === 'pilates' || v === 'yoga_pilates') return 'yoga_pilates';
  return v;
}

function buildLocalContext() {
  const todayUS = usDay();
  const wh = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
  const mh = JSON.parse(localStorage.getItem('mealHistory') || '[]');

  const todayWorkouts = wh.filter(w => w.date === todayUS);
  const workouts = [];
  for (const w of todayWorkouts) {
    for (const ex of (w.exercises || [])) {
      workouts.push({
        exercise_name: ex.name,
        reps: ex.reps || 0,
        weight: ex.weight || 0,
        calories: Math.round(ex.calories || 0),
      });
    }
  }

  const mealsRec = mh.find(m => m.date === todayUS);
  const meals = mealsRec?.meals?.map(m => ({
    title: m.name || 'Meal',
    total_calories: m.calories || 0,
    items: [],
  })) || [];

  const burned = todayWorkouts.reduce((s, w) => s + (w.totalCalories || 0), 0);
  const consumed = meals.reduce((s, m) => s + (m.total_calories || 0), 0);

  return { burned, consumed, meals, workouts };
}

// ---------- component ----------
export default function DailyRecapCoach() {
  const { user } = useAuth();
  const ent = React.useContext(EntitlementsContext) || { isEntitled: false };
  const quota = useAiQuota('coach', 3);

  const [loading, setLoading] = useState(false);
  const [coach, setCoach] = useState(null);   // array of { message }
  const [err, setErr] = useState(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const todayISO = useMemo(() => isoDay(), []);
  const trainingIntent = useMemo(
    () => normalizeIntent(localStorage.getItem('training_intent') || 'general'),
    []
  );

  async function buildContext() {
    const currentUser = user || getSupabaseUserFromStorage();
    if (!currentUser?.id) return buildLocalContext();

    let burned = 0;
    let consumed = 0;
    const workouts = [];
    const meals = [];

    try {
      const dm = await getDailyMetricsRange(currentUser.id, todayISO, todayISO);
      const row = dm?.[0];
      burned = Math.round(row?.cals_burned || 0);
      consumed = Math.round(row?.cals_eaten || 0);
    } catch (e) {
      console.warn('[DailyRecapCoach] getDailyMetricsRange failed', e);
    }

    try {
      const ws = await getWorkouts(currentUser.id, { limit: 30 });
      const todays = ws.filter(w => (w.started_at || '').slice(0, 10) === todayISO);
      for (const w of todays) {
        const sets = await getWorkoutSetsFor(w.id, currentUser.id);
        const kcal = calcCaloriesFromSets(sets);
        if (Array.isArray(sets) && sets.length > 0) {
          for (const s of sets) {
            workouts.push({
              exercise_name: s.exercise_name,
              reps: s.reps || 0,
              weight: s.weight || 0,
              calories: kcal,
            });
          }
        } else {
          workouts.push({ exercise_name: 'Workout session', reps: 0, weight: 0, calories: kcal });
        }
      }
    } catch (e) {
      console.warn('[DailyRecapCoach] workouts fetch failed', e);
    }

    try {
      const mealsAll = await getMeals(currentUser.id, { from: todayISO, to: todayISO, limit: 100 });
      for (const m of mealsAll) {
        meals.push({
          title: m.title || 'Meal',
          total_calories: Math.round(m.total_calories || 0),
          items: [],
        });
      }
    } catch (e) {
      console.warn('[DailyRecapCoach] meals fetch failed', e);
    }

    return { burned, consumed, meals, workouts };
  }

  const handleGetRecap = useCallback(async () => {
    setErr(null);
    setCoach(null);

    // Local guard first (free only)
    if (!quota.isEntitled && quota.isCapped) {
      setShowUpgrade(true);
      return;
    }

    setLoading(true);
    try {
      // Make sure server agrees (prevents false gates after user starts trial)
      if (!quota.isEntitled) {
        const { gated } = await probeEntitlement('coach', {
          user_id: user?.id || getSupabaseUserFromStorage()?.id || null,
          constraints: { training_intent: trainingIntent },
          count: 1,
        });
        if (gated) {
          setShowUpgrade(true);
          setLoading(false);
          return;
        }
      }

      // Optionally compute local context (useful for your separate /api/openai route if desired)
      // Not required by /api/ai/generate — kept here in case you show the context later.
      await buildContext().catch(() => null);

      // Ask gateway for coach suggestions (server handles entitlement bypass)
      const data = await postAI('coach', {
        user_id: user?.id || getSupabaseUserFromStorage()?.id || null,
        constraints: { training_intent: trainingIntent },
        count: 3,
      });

      const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
      if (!suggestions.length) throw new Error('No recap available right now.');

      if (!quota.isEntitled) quota.inc();
      setCoach(suggestions);
    } catch (e) {
      if (e?.code === 402) {
        setShowUpgrade(true);
      } else {
        setErr(e?.message || 'Failed to get recap.');
      }
    } finally {
      setLoading(false);
    }
  }, [quota, trainingIntent, user?.id]);

  return (
    <Box sx={{ p: 2, maxWidth: 800, mx: 'auto' }}>
      <Card
        elevation={0}
        sx={{
          mb: 2.5,
          border: '1px solid rgba(2,6,23,0.08)',
          background: 'linear-gradient(180deg, #ffffff, #fbfdff)',
          borderRadius: 2,
        }}
      >
        <CardContent>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              Unlock AI Daily Recaps
            </Typography>
            <Chip
              size="small"
              color={quota.isEntitled ? 'primary' : 'default'}
              label={quota.isEntitled ? 'PRO/TRIAL' : 'FREE'}
            />
          </Stack>

          {!quota.isEntitled && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Free recaps used today: <strong>{Math.min(quota.used, 3)}</strong>/3
            </Typography>
          )}

          <Divider sx={{ my: 1.5 }} />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="center">
            <Button variant="contained" onClick={handleGetRecap} disabled={loading} sx={{ fontWeight: 800 }}>
              {loading ? <CircularProgress size={22} /> : 'Get Daily Recap'}
            </Button>
          </Stack>

          {err && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {err}
            </Alert>
          )}

          {Array.isArray(coach) && coach.length > 0 && (
            <Stack spacing={1.25} sx={{ mt: 2 }}>
              {coach.map((c, i) => (
                <Typography key={i} variant="body1">
                  • {c.message}
                </Typography>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>

      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        title="Upgrade to Slimcal Pro"
        description="Unlimited AI Daily Recaps plus saved recaps, smarter suggestions, and priority support."
      />
    </Box>
  );
}
