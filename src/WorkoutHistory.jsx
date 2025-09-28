// src/WorkoutHistory.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Container, Divider, List, ListItem, ListItemText,
  Typography, CircularProgress, Paper, Stack
} from '@mui/material';
import { useAuth } from './context/AuthProvider.jsx';
import { getWorkouts, getWorkoutSetsFor } from './lib/db';
import ShareWorkoutModal from './ShareWorkoutModal';

// --- Calorie estimator (proxy) ----------------------------------------------
const SCALE = 0.1; // kcal per (lb * rep); tweak if needed
function calcCaloriesFromSets(sets) {
  if (!Array.isArray(sets) || sets.length === 0) return 0;
  let vol = 0;
  for (const s of sets) {
    const w = Number(s.weight) || 0;
    const r = Number(s.reps) || 0;
    // prefer explicit calories if present on the set
    if (typeof s.calories === 'number' && !Number.isNaN(s.calories)) {
      vol += s.calories / (SCALE || 1); // convert back to “volume units”
      continue;
    }
    vol += w * r;
  }
  const est = Math.round(vol * SCALE);
  return Number.isFinite(est) ? est : 0;
}

function formatDateTime(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
function toUS(iso) {
  try { return new Date(iso).toLocaleDateString('en-US'); } catch { return iso; }
}

export default function WorkoutHistory({ onHistoryChange }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [rows, setRows]       = useState([]); // [{ id, started_at, ended_at, sets, total_calories?, shareLines }]
  const [shareOpen, setShareOpen] = useState(false);
  const [shareText, setShareText] = useState('');

  // Local fallback + lookup by date for calories/share text
  const localHistory = useMemo(() => {
    const arr = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const map = new Map();
    for (const sess of arr) {
      map.set(sess.date, sess); // { date, totalCalories, exercises:[{name,sets,reps,calories}] }
    }
    return { raw: arr, byDate: map };
  }, []);

  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!user) {
        // Pure local mode
        const asRows = localHistory.raw
          .slice()
          .sort((a,b) => new Date(b.date) - new Date(a.date))
          .map((h, idx) => ({
            id: `local-${idx}`,
            started_at: new Date(h.date).toISOString(),
            ended_at:   new Date(h.date).toISOString(),
            sets: (h.exercises || []).map(e => ({
              exercise_name: e.name,
              reps: e.reps ?? 0,
              weight: e.weight ?? 0,
              calories: typeof e.calories === 'number' ? e.calories : undefined,
            })),
            total_calories: Math.round(h.totalCalories || 0),
            shareLines: (h.exercises || []).map(e => `- ${e.name}: ${e.sets}×${e.reps} (${(e.calories||0).toFixed(0)} cal)`),
          }));
        if (!ignore) {
          setRows(asRows);
          if (onHistoryChange) onHistoryChange(hardSum(asRows));
        }
        return;
      }

      // Signed-in: fetch from Supabase; enhance with local fallback per day
      setLoading(true);
      try {
        const base = await getWorkouts(user.id, { limit: 100 });
        const withSets = await Promise.all(
          base.map(async w => {
            const sets = await getWorkoutSetsFor(w.id, user.id);
            const dayUS = toUS(w.started_at);
            const local = localHistory.byDate.get(dayUS);

            // Build share lines
            const shareLines =
              sets?.length
                ? sets.map(s => `- ${s.exercise_name}: ${s.reps||0} reps${s.weight ? ` × ${s.weight} lb` : ''}`)
                : (local?.exercises || []).map(e => `- ${e.name}: ${e.sets}×${e.reps} (${(e.calories||0).toFixed(0)} cal)`);

            // Prefer explicit total_calories if present on server
            let total = (typeof w.total_calories === 'number' && !Number.isNaN(w.total_calories))
              ? Math.round(w.total_calories)
              : calcCaloriesFromSets(sets);

            // 👉 NEW: if computed is 0 (e.g., no weights), fallback to local session total for that day
            if (!total || total <= 0) {
              const localTotal = Math.round(local?.totalCalories || 0);
              if (localTotal > 0) total = localTotal;
            }

            return { ...w, sets, total_calories: total, shareLines };
          })
        );
        if (!ignore) {
          setRows(withSets);
          if (onHistoryChange) onHistoryChange(hardSum(withSets));
        }
      } catch (err) {
        console.error('[WorkoutHistory] fetch failed, falling back to local', err);
        if (!ignore) {
          const asRows = localHistory.raw
            .slice()
            .sort((a,b) => new Date(b.date) - new Date(a.date))
            .map((h, idx) => ({
              id: `local-${idx}`,
              started_at: new Date(h.date).toISOString(),
              ended_at:   new Date(h.date).toISOString(),
              sets: (h.exercises || []).map(e => ({
                exercise_name: e.name, reps: e.reps ?? 0, weight: e.weight ?? 0,
                calories: typeof e.calories === 'number' ? e.calories : undefined,
              })),
              total_calories: Math.round(h.totalCalories || 0),
              shareLines: (h.exercises || []).map(e => `- ${e.name}: ${e.sets}×${e.reps} (${(e.calories||0).toFixed(0)} cal)`),
            }));
          setRows(asRows);
          if (onHistoryChange) onHistoryChange(hardSum(asRows));
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [user, onHistoryChange, localHistory]);

  function hardSum(list) {
    return (list || []).reduce((s, r) => s + (r.total_calories || 0), 0);
  }

  function openShareFor(row) {
    const date = formatDateTime(row.started_at);
    const total = Math.round(row.total_calories || 0);
    const header = `I just logged a workout on ${date} with Slimcal.ai — ${total} calories burned! #SlimcalAI`;
    const body = (row.shareLines || []).join('\n');
    setShareText(`${header}\n\n${body}`);
    setShareOpen(true);
  }

  return (
    <Container maxWidth="md" sx={{ py:4 }}>
      <Typography variant="h4" gutterBottom>Workout History</Typography>
      <Divider sx={{ mb:2 }} />
      {loading ? (
        <Box sx={{ display:'flex', justifyContent:'center', py:6 }}>
          <CircularProgress />
        </Box>
      ) : rows.length === 0 ? (
        <Typography>No workouts yet.</Typography>
      ) : (
        <List>
          {rows.map(w => (
            <Paper variant="outlined" sx={{ mb:2 }} key={w.id}>
              <ListItem alignItems="flex-start" sx={{ alignItems:'stretch' }}>
                <ListItemText
                  primary={
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="h6">{formatDateTime(w.started_at)}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        ~ {Math.round(w.total_calories || 0)} cals
                      </Typography>
                    </Stack>
                  }
                  secondary={
                    <Box sx={{ mt:1 }}>
                      {(w.sets || []).length > 0 ? (
                        w.sets.map((s, i) => (
                          <Typography key={i} variant="body2">
                            • {s.exercise_name} {s.reps ? `× ${s.reps}` : ''}{s.weight ? ` @ ${s.weight}` : ''}
                          </Typography>
                        ))
                      ) : (
                        (w.shareLines || []).map((line, i) => (
                          <Typography key={i} variant="body2">• {line.replace(/^- /,'')}</Typography>
                        ))
                      )}
                      <Box sx={{ mt:1 }}>
                        <Button size="small" variant="outlined" onClick={() => openShareFor(w)}>
                          Share
                        </Button>
                      </Box>
                    </Box>
                  }
                />
              </ListItem>
            </Paper>
          ))}
        </List>
      )}

      <ShareWorkoutModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        shareText={shareText}
        shareUrl={window.location.href}
      />
    </Container>
  );
}
