// src/WorkoutHistory.jsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Box,
  Button,
  Container,
  Divider,
  List,
  ListItem,
  ListItemText,
  Typography,
  CircularProgress,
  Paper,
  Stack,
  Chip,
  IconButton,  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';

import { useAuth } from './context/AuthProvider.jsx';
import { getWorkouts, getWorkoutSetsFor } from './lib/db';
import ShareWorkoutModal from './ShareWorkoutModal';

// ✅ We use Supabase directly here to delete cloud rows safely
import { supabase } from './lib/supabaseClient';

// ✅ Update daily metrics after deletion so banner matches instantly
import { upsertDailyMetricsLocalFirst } from './lib/localFirst';

const SCALE = 0.1;

function calcCaloriesFromSets(sets) {
  if (!Array.isArray(sets) || sets.length === 0) return 0;
  let vol = 0;
  for (const s of sets) {
    if (typeof s.calories === 'number' && Number.isFinite(s.calories)) {
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
function formatDateOnly(iso) {
  try { return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }); }
  catch { return iso; }
}
function toUS(iso) { try { return new Date(iso).toLocaleDateString('en-US'); } catch { return iso; } }

// ---- local-day helpers (avoid UTC drift) ----
function localDayISO(d = new Date()) {
  try {
    const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return ld.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function safeNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function readTodayConsumedFromLocal() {
  const todayUS = new Date().toLocaleDateString('en-US');
  const todayISO = localDayISO(new Date());

  // prefer dailyMetricsCache if present
  try {
    const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
    const row = cache?.[todayISO];
    if (row) {
      const consumed =
        safeNum(row.consumed, NaN) ??
        safeNum(row.eaten, NaN) ??
        safeNum(row.calories_eaten, NaN);
      if (Number.isFinite(consumed)) return consumed;
    }
  } catch {}

  // fallback to mealHistory
  try {
    const mh = JSON.parse(localStorage.getItem('mealHistory') || '[]') || [];
    const rec = mh.find(m => m?.date === todayUS || m?.date === todayISO);
    if (!rec?.meals?.length) return 0;
    return rec.meals.reduce((s, m) => s + safeNum(m?.calories, 0), 0);
  } catch {}

  return 0;
}

function writeDailyMetricsCache(dayISO, consumed, burned) {
  try {
    const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
    cache[dayISO] = {
      eaten: safeNum(consumed, 0),
      burned: safeNum(burned, 0),
      net: safeNum(consumed, 0) - safeNum(burned, 0),
      updated_at: new Date().toISOString()
    };
    localStorage.setItem('dailyMetricsCache', JSON.stringify(cache));
  } catch {}
}

function dispatchBurnedUpdate(dayISO, burned) {
  try {
    window.dispatchEvent(
      new CustomEvent('slimcal:burned:update', {
        detail: { date: dayISO, burned: safeNum(burned, 0) }
      })
    );
  } catch {}
}

// --- Better display: show per-exercise summary instead of set-by-set "12 cals"
function summarizeExercisesFromSets(sets = []) {
  const arr = Array.isArray(sets) ? sets : [];
  const by = new Map();

  for (const s of arr) {
    const name = String(s?.exercise_name || s?.name || 'Exercise').trim() || 'Exercise';
    const prev = by.get(name) || { name, sets: 0, reps: 0, topWeight: 0, minutes: 0 };

    prev.sets += 1;

    const w = safeNum(s?.weight, 0);
    const r = safeNum(s?.reps, 0);
    if (w > prev.topWeight) prev.topWeight = w;
    if (r) prev.reps += r;

    const vol = safeNum(s?.volume, 0);
    // Treat `volume` as minutes for cardio/timed entries when there are no strength numbers.
    if (vol && w === 0 && r === 0) prev.minutes += vol;

    by.set(name, prev);
  }

  return Array.from(by.values()).sort((a, b) => {
    // Prefer minutes (cardio) then sets (strength)
    const as = (a.minutes || 0) * 1000 + (a.sets || 0);
    const bs = (b.minutes || 0) * 1000 + (b.sets || 0);
    return bs - as;
  });
}

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
    const score = overlap * 1000 + (Number(sess.totalCalories) || 0);
    if (score > bestScore) { best = sess; bestScore = score; }
  }
  return bestScore > 0 ? best : null;
}

export default function WorkoutHistory({ onHistoryChange }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareText, setShareText] = useState('');
  const [shareExercises, setShareExercises] = useState([]);
  const [shareTotal, setShareTotal] = useState(0);

  // delete confirm dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDeleteRow, setPendingDeleteRow] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const localIdx = useMemo(() => {
    const raw = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const byDay = new Map();
    for (const sess of raw) {
      const arr = byDay.get(sess.date) || [];
      arr.push(sess);
      byDay.set(sess.date, arr);
    }
    return { raw, byDay };
  }, []);

  const totalSessions = rows.length;
  const totalCalories = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.total_calories) || 0), 0),
    [rows]
  );

  const sumTotals = useCallback((list) => {
    return (list || []).reduce((s, r) => s + (Number(r.total_calories) || 0), 0);
  }, []);

  const recomputeBurnedTodayAndSync = useCallback(async () => {
    const todayUS = new Date().toLocaleDateString('en-US');
    const todayISO = localDayISO(new Date());

    // burned today from local history (source of truth for UI)
    let burnedToday = 0;
    try {
      const wh = JSON.parse(localStorage.getItem('workoutHistory') || '[]') || [];
      burnedToday = (wh || [])
        .filter(w => w?.date === todayUS || w?.date === todayISO)
        .reduce((s, w) => s + safeNum(w?.totalCalories ?? w?.total_calories, 0), 0);
    } catch {}

    const consumedToday = readTodayConsumedFromLocal();

    // write caches so banner updates instantly
    writeDailyMetricsCache(todayISO, consumedToday, burnedToday);
    try {
      localStorage.setItem('burnedToday', String(Math.round(burnedToday || 0)));
    } catch {}

    dispatchBurnedUpdate(todayISO, burnedToday);

    // if logged in, also update daily_metrics cloud via localFirst wrapper
    try {
      if (user?.id) {
        await upsertDailyMetricsLocalFirst({
          user_id: user.id,
          local_day: todayISO,
          consumed: consumedToday,
          burned: burnedToday
        });
      }
    } catch (e) {
      console.warn('[WorkoutHistory] upsertDailyMetricsLocalFirst failed after delete', e);
    }
  }, [user?.id]);

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

  function askDeleteRow(row) {
    setPendingDeleteRow(row);
    setConfirmOpen(true);
  }

  async function performDeleteRow(row) {
    if (!row) return;

    setDeleting(true);
    try {
      // 1) Delete from Supabase if logged in
      if (user?.id && supabase && row.id && String(row.id).startsWith('local-') === false) {
        // safest: delete by workout "id" + user_id (RLS safe)
        const res = await supabase
          .from('workouts')
          .delete()
          .eq('user_id', user.id)
          .eq('id', row.id);

        if (res?.error) {
          console.warn('[WorkoutHistory] cloud delete failed', res.error);
        }
      }

      // 2) Delete from localStorage workoutHistory
      try {
        const wh = JSON.parse(localStorage.getItem('workoutHistory') || '[]') || [];

        // match strategy:
        // - if row has client_id -> remove matching local session id/client_id
        // - else fallback by started day + total calories
        const rowDayUS = toUS(row.started_at);
        const rowTotal = safeNum(row.total_calories, 0);

        const filtered = (wh || []).filter(sess => {
          const sameId =
            (row.client_id && (sess.id === row.client_id || sess.client_id === row.client_id)) ||
            (row.id && (sess.id === row.id || sess.client_id === row.id));

          if (sameId) return false;

          const sameDay = sess?.date === rowDayUS;
          const sameTotal = Math.abs(safeNum(sess?.totalCalories ?? sess?.total_calories, 0) - rowTotal) < 0.01;

          // only remove by day+total if it's a clear match and there's no id
          if (!row.client_id && !row.id && sameDay && sameTotal) return false;

          return true;
        });

        localStorage.setItem('workoutHistory', JSON.stringify(filtered));
      } catch (e) {
        console.warn('[WorkoutHistory] local delete failed', e);
      }

      // 3) Update UI list
      setRows(prev => prev.filter(r => r.id !== row.id));

      // 4) Update banner totals instantly
      await recomputeBurnedTodayAndSync();
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    let ignore = false;

    (async () => {
      if (!user) {
        const asRows = localIdx.raw
          .slice()
          .sort((a, b) => new Date(b.date) - new Date(a.date))
          .map((h, idx) => ({
            id: `local-${idx}`,
            started_at: new Date(h.date).toISOString(),
            ended_at: new Date(h.date).toISOString(),
            sets: (h.exercises || []).map(e => ({
              exercise_name: e.name,
              reps: e.reps ?? 0,
              weight: e.weight ?? 0,
              calories: typeof e.calories === 'number' ? e.calories : undefined,
              exerciseType: e.exerciseType || undefined
            })),
            total_calories: Number(h.totalCalories) || 0,
            shareLines: (h.exercises || []).map(e =>
              `- ${e.name}: ${e.sets}×${e.reps}${e.weight ? ` @ ${e.weight} lb` : ''} (${(e.calories || 0).toFixed(0)} cal)`
            ),
            exercisesForShare: (h.exercises || []).map(e => ({
              exerciseName: e.name,
              sets: e.sets,
              reps: e.reps,
              weight: e.weight,
              calories: e.calories,
              exerciseType: e.exerciseType || undefined
            }))
          }));

        if (!ignore) {
          setRows(asRows);
          if (onHistoryChange) onHistoryChange(sumTotals(asRows));
        }
        return;
      }

      setLoading(true);
      try {
        const base = await getWorkouts(user.id, { limit: 200 });

        const withSets = await Promise.all(
          base.map(async w => {
            const sets = await getWorkoutSetsFor(w.id, user.id, w.client_id);

            const dayUS = toUS(w.started_at);
            const candidates = localIdx.byDay.get(dayUS) || [];
            const fallback = bestLocalMatch(candidates, sets);

            let total =
              (typeof w.total_calories === 'number' && Number.isFinite(w.total_calories))
                ? Number(w.total_calories)
                : (fallback && Number.isFinite(fallback.totalCalories))
                  ? Number(fallback.totalCalories)
                  : calcCaloriesFromSets(sets);

            // clean share / list formatting
            let exercisesForShare = [];
            if (sets && sets.length > 0) {
              exercisesForShare = sets.map(s => ({
                exerciseName: s.exercise_name,
                sets: null,
                reps: s.reps ?? 0,
                weight: s.weight ?? 0,
                calories: typeof s.calories === 'number' ? s.calories : undefined,
                exerciseType: s.exercise_type || undefined
              }));
            } else if (fallback?.exercises) {
              exercisesForShare = fallback.exercises.map(e => ({
                exerciseName: e.name,
                sets: e.sets,
                reps: e.reps,
                weight: e.weight,
                calories: e.calories,
                exerciseType: e.exerciseType || undefined
              }));
            }

            const shareLines =
              exercisesForShare.length > 0
                ? exercisesForShare.map(e =>
                  `- ${e.exerciseName}${e.sets ? `: ${e.sets}×${e.reps || ''}` : e.reps ? `: ×${e.reps}` : ''}${e.weight ? ` @ ${e.weight} lb` : ''}${Number.isFinite(e.calories) ? ` (${Math.round(e.calories)} cal)` : ''}`
                )
                : [];

            return {
              ...w,
              sets,
              total_calories: total,
              shareLines,
              exercisesForShare
            };
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
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .map((h, idx) => ({
              id: `local-${idx}`,
              started_at: new Date(h.date).toISOString(),
              ended_at: new Date(h.date).toISOString(),
              sets: (h.exercises || []).map(e => ({
                exercise_name: e.name,
                reps: e.reps ?? 0,
                weight: e.weight ?? 0,
                calories: typeof e.calories === 'number' ? e.calories : undefined,
                exerciseType: e.exerciseType || undefined
              })),
              total_calories: Number(h.totalCalories) || 0,
              shareLines: (h.exercises || []).map(e =>
                `- ${e.name}: ${e.sets}×${e.reps}${e.weight ? ` @ ${e.weight} lb` : ''} (${(e.calories || 0).toFixed(0)} cal)`
              ),
              exercisesForShare: (h.exercises || []).map(e => ({
                exerciseName: e.name,
                sets: e.sets,
                reps: e.reps,
                weight: e.weight,
                calories: e.calories,
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
  }, [user, onHistoryChange, localIdx, sumTotals]);

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        justifyContent="space-between"
        spacing={1}
        sx={{ mb: 2 }}
      >
        <Typography variant="h4" sx={{ fontWeight: 800 }}>Workout History</Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap">
          <Chip label={`${totalSessions} sessions`} />
          <Chip label={`${totalCalories.toFixed(0)} total cals`} />
        </Stack>
      </Stack>

      <Divider sx={{ mb: 2 }} />

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : rows.length === 0 ? (
        <Typography>No workouts yet.</Typography>
      ) : (
        <List sx={{ pt: 0 }}>
          {rows.map(w => {
            const exerciseSummary = summarizeExercisesFromSets(w.sets || []);

            return (
              <Paper
                variant="outlined"
                sx={{
                  mb: 2,
                  borderRadius: 2,
                  border: '1px solid rgba(0,0,0,0.06)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.03)'
                }}
                key={w.id}
              >
                <ListItem alignItems="flex-start" sx={{ alignItems: 'stretch' }}>
                  <ListItemText
                    primary={
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="h6" sx={{ fontWeight: 700 }}>
                          {formatDateOnly(w.started_at)}
                        </Typography>

                        <Stack direction="row" alignItems="center" spacing={1}>
                          <Typography variant="body2" color="text.secondary">
                            {(Number(w.total_calories) || 0).toFixed(2)} cals
                          </Typography>

                          <span><IconButton
                                size="small"
                                color="error"
                                onClick={() => askDeleteRow(w)}
                                disabled={deleting}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton></span>
                        </Stack>
                      </Stack>
                    }
                    secondary={
                      <Box sx={{ mt: 1 }}>
                        {/* ✅ FIX: show clean per-exercise summary instead of "12 cals" per set */}
                        {exerciseSummary.length > 0 ? (
                          exerciseSummary.map((e, i) => (
                            <Typography key={i} variant="body2">
                              • {e.name} — {e.minutes
                                ? `${Math.round(e.minutes)} min`
                                : `${e.sets} set${e.sets === 1 ? '' : 's'}${e.reps ? ` • ${e.reps} reps` : ''}${e.topWeight ? ` • top ${Math.round(e.topWeight)} lb` : ''}`}
                            </Typography>
                          ))
                        ) : (
                          (w.shareLines || []).map((line, i) => (
                            <Typography key={i} variant="body2">
                              • {line.replace(/^- /, '')}
                            </Typography>
                          ))
                        )}

                        <Box sx={{ mt: 1 }}>
                          <Button size="small" variant="outlined" onClick={() => openShareFor(w)}>
                            Share
                          </Button>
                        </Box>
                      </Box>
                    }
                  />
                </ListItem>
              </Paper>
            );
          })}
        </List>
      )}

      <ShareWorkoutModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        shareText={shareText}
        shareUrl={window.location.href}
        exercises={shareExercises}
        totalCalories={shareTotal}
      />

      {/* ✅ Delete confirm dialog */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Delete workout?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            This will remove the workout from your history and update today’s burned calories.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setConfirmOpen(false)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleting}
            onClick={async () => {
              const row = pendingDeleteRow;
              setConfirmOpen(false);
              setPendingDeleteRow(null);
              await performDeleteRow(row);
            }}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
