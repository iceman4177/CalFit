// src/WorkoutHistory.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Container, Divider, List, ListItem, ListItemText,
  Typography, CircularProgress, Paper, Stack
} from '@mui/material';
import { useAuth } from './context/AuthProvider.jsx';
import { getWorkouts, getWorkoutSetsFor } from './lib/db';

function formatDateTime(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function computeCaloriesApprox(sets) {
  // Fallback: if you don’t store calories per set in Supabase, estimate by volume
  // You can replace this with your actual per-set calories if you later store them.
  const vol = (sets || []).reduce((s, x) => s + ((x.weight || 0) * (x.reps || 0)), 0);
  return Math.round(vol * 0.1); // naive proxy; adjust or remove if you later persist calories
}

export default function WorkoutHistory({ onHistoryChange }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [rows, setRows]       = useState([]); // [{ id, started_at, ended_at, sets: [...] }]

  // Local fallback (existing structure)
  const localHistory = useMemo(() => {
    const arr = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    // shape: { date, totalCalories, exercises:[{name, sets, reps, calories}] }
    return arr
      .slice()
      .sort((a,b) => new Date(b.date) - new Date(a.date))
      .map((h, idx) => ({
        id: `local-${idx}`,
        started_at: new Date(h.date).toISOString(),
        ended_at:   new Date(h.date).toISOString(),
        local_total: h.totalCalories || 0,
        sets: (h.exercises || []).map(e => ({
          exercise_name: e.name,
          reps: e.reps,
          weight: null,
          tempo: null,
          volume: (e.reps || 0) * (e.sets || 0),
          calories: e.calories || 0,
        }))
      }));
  }, []);

  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!user) {
        setRows(localHistory);
        if (onHistoryChange) {
          const total = localHistory.reduce((s,r) =>
            s + (r.local_total || computeCaloriesApprox(r.sets)), 0);
          onHistoryChange(total);
        }
        return;
      }
      setLoading(true);
      try {
        const base = await getWorkouts(user.id, { limit: 100 });
        const withSets = await Promise.all(
          base.map(async w => ({
            ...w,
            sets: await getWorkoutSetsFor(w.id, user.id)
          }))
        );
        if (!ignore) {
          setRows(withSets);
          if (onHistoryChange) {
            onHistoryChange(0); // not used by your UI, but we keep the prop contract
          }
        }
      } catch (err) {
        console.error('[WorkoutHistory] fetch failed, falling back to local', err);
        if (!ignore) setRows(localHistory);
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [user, onHistoryChange, localHistory]);

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
          {rows.map(w => {
            const total = w.local_total ?? computeCaloriesApprox(w.sets);
            return (
              <Paper variant="outlined" sx={{ mb:2 }} key={w.id}>
                <ListItem alignItems="flex-start">
                  <ListItemText
                    primary={
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="h6">
                          {formatDateTime(w.started_at)}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          ~ {total} cals
                        </Typography>
                      </Stack>
                    }
                    secondary={
                      <Box sx={{ mt:1 }}>
                        {(w.sets || []).map((s, i) => (
                          <Typography key={i} variant="body2">
                            • {s.exercise_name} {s.reps ? `× ${s.reps}` : ''}{s.weight ? ` @ ${s.weight}` : ''}
                          </Typography>
                        ))}
                      </Box>
                    }
                  />
                </ListItem>
              </Paper>
            );
          })}
        </List>
      )}
      <Box sx={{ textAlign:'center', mt:2 }}>
        <Button variant="outlined" onClick={() => window.scrollTo({ top:0, behavior:'smooth' })}>
          Back to top
        </Button>
      </Box>
    </Container>
  );
}
