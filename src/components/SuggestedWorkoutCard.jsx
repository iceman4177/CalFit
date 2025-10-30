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
import { supabase } from '../lib/supabaseClient'; // <-- fixed path

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

// ---- client id helper (per-device free passes) ----
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

// --- auth headers (so backend can resolve entitlement and bypass limits) ---
async function buildAuthHeaders() {
  let token = null;
  let userId = null;
  let email = null;

  try {
    const [{ data: sessionData }, { data: userData }] = await Promise.all([
      supabase.auth.getSession(),
      supabase.auth.getUser()
    ]);
    token = sessionData?.session?.access_token || null;
    userId = userData?.user?.id || null;
    email  = userData?.user?.email || null;
  } catch {
    // ignore — will fall back to anonymous client id
  }

  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(userId ? { 'x-supabase-user-id': userId } : {}),
    ...(email  ? { 'x-user-email': email } : {}),
    'x-client-id': getClientId()
  };
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

export default function SuggestedWorkoutCard({ userData, onAccept }) {
  const [pack, setPack] = useState([]);   // array of AI suggestions
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  // derive intent/goal/split defaults
  const trainingIntent = (localStorage.getItem('training_intent') || 'general').toLowerCase();
  const initialSplit = normalizeFocus(
    localStorage.getItem('training_split') ||
    localStorage.getItem('last_focus') ||
    'upper'
  );

  const [split, setSplit] = useState(initialSplit);
  const current = useMemo(() => pack[idx] || null, [pack, idx]);

  async function fetchAI(focusOverride) {
    setLoading(true);
    setErr(null);

    try {
      const intentLS      = localStorage.getItem('training_intent') || 'general';
      const fitnessGoal   = localStorage.getItem('fitness_goal') || (userData?.goalType || 'maintenance');
      const equipmentList = JSON.parse(localStorage.getItem('equipment_list') || '["dumbbell","barbell","machine","bodyweight"]');

      const focus = normalizeFocus(focusOverride || split || 'upper');

      // keep local prefs in sync for the rest of the app
      localStorage.setItem('training_split', focus);
      localStorage.setItem('last_focus', focus);

      const headers = await buildAuthHeaders();

      const resp = await fetch('/api/ai/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          feature: 'workout',
          goal: fitnessGoal,
          focus,
          equipment: equipmentList,
          constraints: { training_intent: intentLS },
          count: 5
        })
      });

      if (resp.status === 402) {
        // Free cap hit (only happens if entitlement not resolved) → show paywall
        setShowUpgrade(true);
        setPack([]);
        setLoading(false);
        return;
      }

      const raw = await resp.text();
      if (!resp.ok) throw new Error(`Server responded ${resp.status} ${raw ? `- ${raw}` : ''}`);

      const data = raw ? JSON.parse(raw) : {};
      const suggestions = Array.isArray(data?.suggestions)
        ? data.suggestions
        : Array.isArray(data) ? data : [];

      if (!suggestions.length) throw new Error('No workout suggestions returned');

      setPack(suggestions);
      setIdx(0);
    } catch (e) {
      console.error('[SuggestedWorkoutCard] fetchAI failed', e);
      setErr('Could not fetch a workout suggestion. Try again.');
      setPack([]);
    } finally {
      setLoading(false);
    }
  }

  // Fetch on mount and when userData changes
  useEffect(() => { fetchAI(); /* eslint-disable-next-line */ }, [userData]);

  const handleRefresh = () => {
    if (pack.length <= 1) {
      fetchAI();
    } else {
      setIdx((i) => (i + 1) % pack.length);
    }
  };

  const onPickSplit = (v) => {
    const focus = normalizeFocus(v);
    setSplit(focus);
    fetchAI(focus);
  };

  if (loading) {
    return (
      <Card sx={{ mb: 4 }}>
        <CardContent>
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
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6" color="error">{err}</Typography>
          <Button variant="outlined" sx={{ mt: 1 }} onClick={() => fetchAI()}>Try Again</Button>
        </CardContent>
      </Card>
    );
  }

  // If we hit the cap and cleared pack, still mount the modal
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
    <Card sx={{ mb: 4 }}>
      <CardContent>
        <Box sx={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <Typography variant="h5">Suggested Workout</Typography>
          <Box sx={{ display:'flex', gap:1 }}>
            <Chip size="small" label={(trainingIntent || 'general').replace('_',' ')} />
            <Chip size="small" label={(split || 'upper').replace('_',' ')} />
          </Box>
        </Box>

        {/* Goal-aware split picker */}
        <WorkoutTypePicker
          intent={trainingIntent}
          value={split}
          onChange={onPickSplit}
        />

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

        <Box sx={{ display:'flex', gap:1 }}>
          <Button variant="outlined" onClick={handleRefresh}>Refresh</Button>
          <Button
            variant="contained"
            onClick={() => { if (typeof onAccept === 'function') onAccept(localWorkout); }}
          >
            Accept Workout
          </Button>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          💡 Your plan is tuned by goal (<strong>{(trainingIntent || 'general').replace('_',' ')}</strong>) and today’s split (<strong>{(split || 'upper').replace('_',' ')}</strong>). Sets/reps are auto-biased to your style.
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
