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
// Only used as a LAST resort when we have no saved totals anywhere.
const SCALE = 0.1; // kcal per (lb * rep)
function calcCaloriesFromSets(sets) {
  if (!Array.isArray(sets) || sets.length === 0) return 0;
  let vol = 0;
  for (const s of sets) {
    if (typeof s.calories === 'number' && Number.isFinite(s.calories)) {
      // if the set already has calories, trust it directly
      vol += s.calories;
      continue;
    }
    const w = Number(s.weight) || 0;
    const r = Number(s.reps) || 0;
    vol += w * r * SCALE;
  }
  return Number.isFinite(vol) ? vol : 0;
}

function formatDateTime(iso) { try { return new Date(iso).toLocaleString(); } catch { return iso; } }
function toUS(iso) { try { return new Date(iso).toLocaleDateString('en-US'); } catch { return iso; } }

// --- Local matching helpers --------------------------------------------------
const normalizeName = s => (s || '').toLowerCase().trim();

function bestLocalMatch(candidates = [], supaSets = []) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const supaNames = new Set((supaSets || []).map(s => normalizeName(s.exercise_name)));
  let best = null;
  let bestScore = -1;

  for (const sess of candidates) {
    const locNames = new Set((sess.exercises || []).map(e => normalizeName(e.name)));
    let overlap = 0;
    for (const n of supaNames) if (n && locNames.has(n)) overlap++;
    const score = overlap * 1000 + (Number(sess.totalCalories) || 0); // tie-break by calories
    if (score > bestScore) { best = sess; bestScore = score; }
  }
  return bestScore > 0 ? best : null;
}

export default function WorkoutHistory({ onHistoryChange }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [rows, setRows]       = useState([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareText, setShareText] = useState('');
  const [shareExercises, setShareExercises] = useState([]);
  const [shareTotal, setShareTotal] = useState(0);

  // Build local indexes: raw array and by-day
  const localIdx = useMemo(() => {
    const raw = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const byDay = new Map(); // dayUS -> [sessions...]
    for (const sess of raw) {
      const arr = byDay.get(sess.date) || [];
      arr.push(sess);
      byDay.set(sess.date, arr);
    }
    return { raw, byDay };
  }, []);

  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!user) {
        // Pure local mode
        const asRows = localIdx.raw
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
              exerciseType: e.exerciseType || undefined
            })),
            total_calories: Number(h.totalCalories) || 0,
            shareLines: (h.exercises || []).map(e =>
              `- ${e.name}: ${e.sets}×${e.reps}${e.weight ? ` @ ${e.weight} lb` : ''} (${(e.calories||0).toFixed(0)} cal)`
            ),
            exercisesForShare: (h.exercises || []).map(e => ({
              exerciseName: e.name,
              sets: e.sets, reps: e.reps, weight: e.weight, calories: e.calories,
              exerciseType: e.exerciseType || undefined
            }))
          }));
        if (!ignore) {
          setRows(asRows);
          if (onHistoryChange) onHistoryChange(sumTotals(asRows));
        }
        return;
      }

      // Signed in: fetch from Supabase; prefer local totals if server lacks them
      setLoading(true);
      try {
        const base = await getWorkouts(user.id, { limit: 100 });
        const withSets = await Promise.all(
          base.map(async w => {
            const sets = await getWorkoutSetsFor(w.id, user.id);
            const dayUS = toUS(w.started_at);
            const candidates = localIdx.byDay.get(dayUS) || [];
            const fallback = bestLocalMatch(candidates, sets);

            // Prefer server-provided total when present; else prefer local exact total; else last-resort proxy calc
            let total = (typeof w.total_calories === 'number' && Number.isFinite(w.total_calories))
              ? Number(w.total_calories)
              : (fallback && Number.isFinite(fallback.totalCalories))
              ? Number(fallback.totalCalories)
              : calcCaloriesFromSets(sets);

            // Build exercises list for sharing (structured)
            let exercisesForShare = [];
            if (sets && sets.length > 0) {
              exercisesForShare = sets.map(s => ({
                exerciseName: s.exercise_name,
                sets: null, // not tracked at set-row granularity
                reps: s.reps ?? 0,
                weight: s.weight ?? 0,
                calories: typeof s.calories === 'number' ? s.calories : undefined,
                exerciseType: s.exercise_type || undefined
              }));
            } else if (fallback?.exercises) {
              exercisesForShare = fallback.exercises.map(e => ({
                exerciseName: e.name,
                sets: e.sets, reps: e.reps, weight: e.weight, calories: e.calories,
                exerciseType: e.exerciseType || undefined
              }));
            }

            // Pretty lines for the list body
            const shareLines =
              exercisesForShare.length > 0
                ? exercisesForShare.map(e =>
                    `- ${e.exerciseName}${e.sets ? `: ${e.sets}×${e.reps || ''}` : e.reps ? `: ×${e.reps}` : ''}${e.weight ? ` @ ${e.weight} lb` : ''}${Number.isFinite(e.calories) ? ` (${Math.round(e.calories)} cal)` : ''}`
                  )
                : [];

            return { ...w, sets, total_calories: total, shareLines, exercisesForShare };
          })
        );
        if (!ignore) {
          setRows(withSets);
          if (onHistoryChange) onHistoryChange(sumTotals(withSets));
        }
      } catch (err) {
        console.error('[WorkoutHistory] fetch failed, falling back to local', err);
        if (!ignore) {
          const asRows = localIdx.raw
            .slice()
            .sort((a,b) => new Date(b.date) - new Date(a.date))
            .map((h, idx) => ({
              id: `local-${idx}`,
              started_at: new Date(h.date).toISOString(),
              ended_at:   new Date(h.date).toISOString(),
              sets: (h.exercises || []).map(e => ({
                exercise_name: e.name, reps: e.reps ?? 0, weight: e.weight ?? 0,
                calories: typeof e.calories === 'number' ? e.calories : undefined,
                exerciseType: e.exerciseType || undefined
              })),
              total_calories: Number(h.totalCalories) || 0,
              shareLines: (h.exercises || []).map(e =>
                `- ${e.name}: ${e.sets}×${e.reps}${e.weight ? ` @ ${e.weight} lb` : ''} (${(e.calories||0).toFixed(0)} cal)`
              ),
              exercisesForShare: (h.exercises || []).map(e => ({
                exerciseName: e.name,
                sets: e.sets, reps: e.reps, weight: e.weight, calories: e.calories,
                exerciseType: e.exerciseType || undefined
              }))
            }));
          setRows(asRows);
          if (onHistoryChange) onHistoryChange(sumTotals(asRows));
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [user, onHistoryChange, localIdx]);

  function sumTotals(list) {
    return (list || []).reduce((s, r) => s + (Number(r.total_calories) || 0), 0);
  }

  function openShareFor(row) {
    const date = formatDateTime(row.started_at);
    const total = Number(row.total_calories) || 0;
    const header = `I just logged a workout on ${date} with Slimcal.ai — ${total.toFixed(2)} calories burned! #SlimcalAI`;
    const body = (row.shareLines || []).join('\n');

    setShareText(`${header}\n\n${body}`);
    setShareTotal(total);
    setShareExercises(row.exercisesForShare || []);
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
                        {(Number(w.total_calories) || 0).toFixed(2)} cals
                      </Typography>
                    </Stack>
                  }
                  secondary={
                    <Box sx={{ mt:1 }}>
                      {(w.sets || []).length > 0 ? (
                        w.sets.map((s, i) => (
                          <Typography key={i} variant="body2">
                            • {s.exercise_name} {s.reps ? `× ${s.reps}` : ''}
                            {s.weight ? ` @ ${s.weight}` : ''}
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
        // NEW: pass exact row data so modal doesn't use an old session
        exercises={shareExercises}
        totalCalories={shareTotal}
      />
    </Container>
  );
}
