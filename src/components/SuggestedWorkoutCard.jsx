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
      exerciseType: '',           // optional in your add flow
      muscleGroup: '',            // optional; AI may omit
      exerciseName: name,
      weight: '',                 // user fills if needed
      sets,
      reps,
      concentricTime: conc,
      eccentricTime: ecc
    };
  });

  return {
    name: title,
    exercises: exs
  };
}

export default function SuggestedWorkoutCard({ userData, onAccept }) {
  const [pack, setPack] = useState([]);   // array of AI suggestions
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  const current = useMemo(() => pack[idx] || null, [pack, idx]);

  async function fetchAI() {
    setLoading(true);
    setErr(null);

    try {
      const trainingIntent = localStorage.getItem('training_intent') || 'general';
      const fitnessGoal    = localStorage.getItem('fitness_goal') || (userData?.goalType || 'maintenance');
      const equipmentList  = JSON.parse(localStorage.getItem('equipment_list') || '["dumbbell","barbell","machine","bodyweight"]');
      const lastFocus      = localStorage.getItem('last_focus') || 'upper';

      const supaToken = JSON.parse(localStorage.getItem('supabase.auth.token') || 'null');
      const user_id   = supaToken?.user?.id || null;

      const resp = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature: 'workout',
          user_id,
          goal: fitnessGoal,
          focus: lastFocus,
          equipment: equipmentList,
          constraints: { training_intent: trainingIntent },
          count: 5
        })
      });

      if (resp.status === 402) {
        setShowUpgrade(true);
        setPack([]);
        return;
      }

      const raw = await resp.text();
      if (!resp.ok) throw new Error(`Server responded ${resp.status}`);
      const data = JSON.parse(raw);

      const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
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

  // Fetch a pack on mount + when userData changes
  useEffect(() => { fetchAI(); /* eslint-disable-next-line */ }, [userData]);

  const handleRefresh = () => {
    if (pack.length <= 1) {
      // pull a new pack if we only have one/none
      fetchAI();
    } else {
      setIdx((i) => (i + 1) % pack.length);
    }
  };

  if (loading) {
    return (
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Typography variant="h6">Generating a plan…</Typography>
          <Typography variant="body2" color="text.secondary">
            Personalizing based on your intent and equipment.
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
          <Button variant="outlined" sx={{ mt: 1 }} onClick={fetchAI}>Try Again</Button>
        </CardContent>
      </Card>
    );
  }

  if (!current) return null;

  const localWorkout = toLocalWorkout(current);

  return (
    <Card sx={{ mb: 4 }}>
      <CardContent>
        <Box sx={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <Typography variant="h5">Suggested Workout</Typography>
          {/* quick context chips for relatability */}
          <Box sx={{ display:'flex', gap:1 }}>
            <Chip size="small" label={(localStorage.getItem('training_intent') || 'general').replace('_',' ')} />
            <Chip size="small" label={localStorage.getItem('last_focus') || 'upper'} />
          </Box>
        </Box>

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

        {/* Tiny coach notes for trust (no new files) */}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          💡 Tuned for your intent. Bodybuilder → moderate reps & volume; Powerlifter → lower reps & longer rest; Yoga/Pilates → lighter strength + mobility emphasis.
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
