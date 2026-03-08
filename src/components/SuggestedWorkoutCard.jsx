// src/components/SuggestedWorkoutCard.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Button,
  List,
  ListItem,
  Divider,
  Box,
  Chip
} from '@mui/material';
import UpgradeModal from './UpgradeModal';
import WorkoutTypePicker from './WorkoutTypePicker';
import FeatureUseBadge, { canUseDailyFeature, registerDailyFeatureUse, setDailyRemaining } from './FeatureUseBadge.jsx';
import { postAI, getAIQuotaStatus } from '../lib/ai';

// --- normalize split to server values ---
function normalizeFocus(focus) {
  const s = String(focus || '').toLowerCase().replace(/\s+/g, '_');
  const map = {
    upper_body: 'upper',
    lower_body: 'lower',
    full_body: 'full',
    chest_and_back: 'chest_back',
    shoulders_and_arms: 'shoulders_arms',
    glutes_and_hamstrings: 'glutes_hamstrings',
    quads_and_calves: 'quads_calves',
    push_pull: 'push',
    push_day: 'push',
    pull_day: 'pull',
    legs_day: 'legs',
    conditioning: 'cardio'
  };
  return map[s] || s || 'upper';
}

// Parse tempo like "2-1-2" -> { conc: '2', ecc: '2' }
function parseTempo(s) {
  if (!s || typeof s !== 'string') return { conc: '2', ecc: '2' };
  const dash = s.match(/(\d+)\s*-\s*\d+\s*-\s*(\d+)/);
  if (dash) return { conc: String(dash[1]), ecc: String(dash[2]) };
  const anySep = s.match(/(\d+)[^\d]+(\d+)[^\d]+(\d+)/);
  if (anySep) return { conc: String(anySep[1]), ecc: String(anySep[3]) };
  return { conc: '2', ecc: '2' };
}

// Map AI → local "Accept Workout" shape used by WorkoutPage.handleAcceptSuggested
function toLocalWorkout(ai) {
  const title = ai?.title || 'Suggested Workout';
  const blocks = Array.isArray(ai?.blocks) ? ai.blocks : [];
  const exs = blocks.map((b) => {
    const name = b?.exercise || b?.name || 'Exercise';
    const sets = String(b?.sets ?? 3);
    const reps = b?.reps != null ? String(b.reps) : '8-12';
    const { conc, ecc } = parseTempo(b?.tempo);

    return {
      exerciseType: '',
      muscleGroup: '',
      exerciseName: name,
      weight: '',
      sets,
      reps,
      concentricTime: conc,
      eccentricTime: ecc
    };
  });

  return { name: title, exercises: exs };
}

// ✅ helper (client-side hint only)
const isProUser = () => {
  if (localStorage.getItem('isPro') === 'true') return true;
  const ud = JSON.parse(localStorage.getItem('userData') || '{}');
  return !!ud.isPremium;
};

export default function SuggestedWorkoutCard({ userData, onAccept }) {
  const [pack, setPack] = useState([]); // array of AI suggestions
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const pro = isProUser();

  // derive intent/goal/split defaults
  const trainingIntent = (localStorage.getItem('training_intent') || 'general').toLowerCase();
  const initialSplit = normalizeFocus(
    localStorage.getItem('training_split') ||
      localStorage.getItem('last_focus') ||
      'upper'
  );

  const [split, setSplit] = useState(initialSplit);
  const current = useMemo(() => pack[idx] || null, [pack, idx]);

  useEffect(() => {
    let active = true;
    const syncQuota = async () => {
      if (pro) return;
      try {
        const q = await getAIQuotaStatus('ai_workout');
        if (!active) return;
        if (typeof q?.remaining === 'number') setDailyRemaining('ai_workout', q.remaining);
      } catch {}
    };
    syncQuota();
    window.addEventListener('focus', syncQuota);
    return () => {
      active = false;
      window.removeEventListener('focus', syncQuota);
    };
  }, [pro]);

  async function fetchAI(focusOverride, { countAsUse } = {}) {
    setLoading(true);
    setErr(null);

    try {
      const intentLS = localStorage.getItem('training_intent') || 'general';
      const fitnessGoal = localStorage.getItem('fitness_goal') || (userData?.goalType || 'maintenance');
      const equipmentList = JSON.parse(
        localStorage.getItem('equipment_list') || '["dumbbell","barbell","machine","bodyweight"]'
      );

      const focus = normalizeFocus(focusOverride || split || 'upper');
      localStorage.setItem('training_split', focus);
      localStorage.setItem('last_focus', focus);

      const data = await postAI('ai_workout', {
        goal: fitnessGoal,
        focus,
        equipment: equipmentList,
        constraints: { training_intent: intentLS },
        count: 5
      });

      const suggestions = Array.isArray(data?.suggestions)
        ? data.suggestions
        : Array.isArray(data)
          ? data
          : [];

      if (!suggestions.length) throw new Error('No workout suggestions returned');

      setPack(suggestions);
      setIdx(0);

      if (!pro && countAsUse) {
        if (typeof data?.remaining === 'number') setDailyRemaining('ai_workout', data.remaining);
        else registerDailyFeatureUse('ai_workout');
      }
    } catch (e) {
      console.error('[SuggestedWorkoutCard] fetchAI failed', e);
      if (e?.code === 402) {
        setShowUpgrade(true);
        setPack([]);
      } else {
        setErr('Could not fetch a workout suggestion. Try again.');
        setPack([]);
      }
    } finally {
      setLoading(false);
    }
  }

  // Fetch on mount and when userData changes — counts as a use (unless Pro)
  useEffect(() => {
    if (!pro && !canUseDailyFeature('ai_workout')) {
      setShowUpgrade(true);
      return;
    }
    fetchAI(undefined, { countAsUse: true });
    // eslint-disable-next-line
  }, [userData]);

  const handleRefresh = () => {
    // ✅ If we have extra suggestions already, cycling does NOT consume a use
    if (pack.length > 1) {
      setIdx((i) => (i + 1) % pack.length);
      return;
    }

    // ✅ Need to call server → enforce local free quota UX (server still final)
    if (!pro && !canUseDailyFeature('ai_workout')) {
      setShowUpgrade(true);
      return;
    }

    fetchAI(undefined, { countAsUse: true });
  };

  const onPickSplit = (v) => {
    const focus = normalizeFocus(v);
    setSplit(focus);

    if (!pro && !canUseDailyFeature('ai_workout')) {
      setShowUpgrade(true);
      return;
    }

    fetchAI(focus, { countAsUse: true });
  };

  if (loading) {
    return (
      <Card sx={{ mb: 4, overflow: 'visible' }}>
        <CardContent sx={{ overflow: 'visible' }}>
          <Typography variant="h6">Generating a plan…</Typography>
          <Typography variant="body2" color="text.secondary">
            Personalizing based on your goal, intent, equipment, and split.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  if (err) {
    return (
      <Card sx={{ mb: 4, overflow: 'visible' }}>
        <CardContent sx={{ overflow: 'visible' }}>
          <Typography variant="h6" color="error">
            {err}
          </Typography>
          <Button
            variant="outlined"
            sx={{ mt: 1 }}
            onClick={() => fetchAI(undefined, { countAsUse: true })}
          >
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!current) {
    return (
      <>
        <UpgradeModal
          open={showUpgrade}
          onClose={() => setShowUpgrade(false)}
          title="Upgrade to Slimcal Pro"
          description="You’ve reached your free daily AI limit. Upgrade for unlimited personalized workouts."
        />
      </>
    );
  }

  const localWorkout = toLocalWorkout(current);

  return (
    <Card sx={{ mb: 4, overflow: 'visible' }}>
      <CardContent sx={{ overflow: 'visible' }}>
        {/* Header */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 1,
            flexWrap: 'wrap',
          }}
        >
          <Typography variant="h5" sx={{ lineHeight: 1.2 }}>
            Suggested Workout
          </Typography>

          {/* Badges/Chips row */}
          <Box
            sx={{
              display: 'flex',
              gap: 1,
              flexWrap: 'wrap',
              justifyContent: { xs: 'flex-start', sm: 'flex-end' },
              alignItems: 'center',
              // give a little room so top-right chips don't feel cramped
              mt: { xs: 0.5, sm: 0 },
            }}
          >
            <FeatureUseBadge featureKey="ai_workout" isPro={pro} sx={{ flexShrink: 0 }} />
            <Chip
              size="small"
              label={(trainingIntent || 'general').replace('_', ' ')}
              sx={{ flexShrink: 0 }}
            />
            <Chip
              size="small"
              label={(split || 'upper').replace('_', ' ')}
              sx={{ flexShrink: 0 }}
            />
          </Box>
        </Box>

        <WorkoutTypePicker intent={trainingIntent} value={split} onChange={onPickSplit} />

        <Typography variant="subtitle1" gutterBottom sx={{ mt: 1 }}>
          {localWorkout.name}
        </Typography>

        <List dense>
          {localWorkout.exercises.map((ex, i) => (
            <ListItem key={i} sx={{ pl: 0 }}>
              • {ex.exerciseName} — {ex.sets}×{ex.reps}
            </ListItem>
          ))}
        </List>

        <Divider sx={{ my: 2 }} />

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={handleRefresh}>
            Refresh
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              if (typeof onAccept === 'function') onAccept(localWorkout);
            }}
          >
            Accept Workout
          </Button>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          💡 Your plan is tuned by goal (<strong>{(trainingIntent || 'general').replace('_', ' ')}</strong>)
          and today’s split (<strong>{(split || 'upper').replace('_', ' ')}</strong>).
        </Typography>
      </CardContent>

      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        title="Upgrade to Slimcal Pro"
        description="You’ve reached your free daily AI limit. Upgrade for unlimited personalized workouts."
      />
    </Card>
  );
}
