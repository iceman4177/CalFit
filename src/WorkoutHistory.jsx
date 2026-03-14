// src/WorkoutHistory.jsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Box,
  Button,
  Container,
  Divider,
  Typography,
  CircularProgress,
  Paper,
  Stack,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import FitnessCenterRoundedIcon from '@mui/icons-material/FitnessCenterRounded';
import LocalFireDepartmentRoundedIcon from '@mui/icons-material/LocalFireDepartmentRounded';
import IosShareRoundedIcon from '@mui/icons-material/IosShareRounded';

import { useAuth } from './context/AuthProvider.jsx';
import { getWorkouts } from './lib/db';
import ShareWorkoutModal from './ShareWorkoutModal';
import { ensureScopedFromLegacy, readScopedJSON, writeScopedJSON, KEYS } from './lib/scopedStorage.js';
import { supabase } from './lib/supabaseClient';
import { upsertDailyMetricsLocalFirst } from './lib/localFirst';

function setsFromExercises(exercises = []) {
  const exArr = Array.isArray(exercises) ? exercises : [];
  const rows = [];
  for (const ex of exArr) {
    const name = String(ex?.name || ex?.exerciseName || '').trim();
    if (!name) continue;
    const nSets = Math.max(1, parseInt(ex?.sets, 10) || 1);
    const reps = ex?.reps != null ? Number(ex.reps) : 0;
    const weight = ex?.weight != null ? Number(ex.weight) : 0;
    const volume = ex?.volume != null ? Number(ex.volume) : 0;
    for (let i = 0; i < nSets; i += 1) {
      rows.push({ exercise_name: name, reps, weight, volume });
    }
  }
  return rows;
}

function getExercisesFromWorkout(workout) {
  try {
    const ex = workout?.items?.exercises;
    if (Array.isArray(ex) && ex.length) return ex;
  } catch (e) {}
  return null;
}

const SCALE = 0.1;

function calcCaloriesFromSets(sets) {
  if (!Array.isArray(sets) || sets.length === 0) return 0;
  let vol = 0;
  for (const s of sets) {
    const w = Number(s.weight) || 0;
    const r = Number(s.reps) || 0;
    vol += w * r * SCALE;
  }
  return Number.isFinite(vol) ? vol : 0;
}

function formatDateOnly(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return iso;
  }
}

function formatTimeOnly(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
}

function formatShareDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

function toUS(iso) {
  try { return new Date(iso).toLocaleDateString('en-US'); } catch { return iso; }
}

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
  try {
    const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
    const row = cache?.[todayISO];
    if (row) {
      const consumed = safeNum(row.consumed, NaN) ?? safeNum(row.eaten, NaN) ?? safeNum(row.calories_eaten, NaN);
      if (Number.isFinite(consumed)) return consumed;
    }
  } catch {}
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
      updated_at: new Date().toISOString(),
    };
    localStorage.setItem('dailyMetricsCache', JSON.stringify(cache));
  } catch {}
}

function dispatchBurnedUpdate(dayISO, burned) {
  try {
    window.dispatchEvent(new CustomEvent('slimcal:burned:update', { detail: { date: dayISO, burned: safeNum(burned, 0) } }));
  } catch {}
}

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
    if (vol && w === 0 && r === 0) prev.minutes += vol;
    by.set(name, prev);
  }
  return Array.from(by.values());
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
  const userId = user?.id || null;

  const readWorkoutHistory = useCallback(() => {
    try {
      ensureScopedFromLegacy(KEYS.workoutHistory, userId);
      const list = readScopedJSON(KEYS.workoutHistory, userId, []);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }, [userId]);

  const writeWorkoutHistory = useCallback((list) => {
    try {
      ensureScopedFromLegacy(KEYS.workoutHistory, userId);
      writeScopedJSON(KEYS.workoutHistory, userId, Array.isArray(list) ? list : []);
    } catch {}
  }, [userId]);

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareText, setShareText] = useState('');
  const [shareExercises, setShareExercises] = useState([]);
  const [shareTotal, setShareTotal] = useState(0);
  const [shareDate, setShareDate] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDeleteRow, setPendingDeleteRow] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const localIdx = useMemo(() => {
    const raw = readWorkoutHistory();
    const byDay = new Map();
    for (const sess of raw) {
      const arr = byDay.get(sess.date) || [];
      arr.push(sess);
      byDay.set(sess.date, arr);
    }
    return { raw, byDay };
  }, [readWorkoutHistory]);

  const totalSessions = rows.length;
  const totalCalories = useMemo(() => rows.reduce((s, r) => s + (Number(r.total_calories) || 0), 0), [rows]);
  const sumTotals = useCallback((list) => (list || []).reduce((s, r) => s + (Number(r.total_calories) || 0), 0), []);

  const recomputeBurnedTodayAndSync = useCallback(async () => {
    const todayUS = new Date().toLocaleDateString('en-US');
    const todayISO = localDayISO(new Date());
    let burnedToday = 0;
    try {
      const wh = readWorkoutHistory();
      burnedToday = (wh || []).filter(w => w?.date === todayUS || w?.date === todayISO).reduce((s, w) => s + safeNum(w?.totalCalories ?? w?.total_calories, 0), 0);
    } catch {}
    const consumedToday = readTodayConsumedFromLocal();
    writeDailyMetricsCache(todayISO, consumedToday, burnedToday);
    try { localStorage.setItem('burnedToday', String(Math.round(burnedToday || 0))); } catch {}
    dispatchBurnedUpdate(todayISO, burnedToday);
    try {
      if (user?.id) {
        await upsertDailyMetricsLocalFirst({ user_id: user.id, local_day: todayISO, consumed: consumedToday, burned: burnedToday });
      }
    } catch (e) {
      console.warn('[WorkoutHistory] upsertDailyMetricsLocalFirst failed after delete', e);
    }
  }, [readWorkoutHistory, user?.id]);

  function openShareFor(row) {
    const total = Number(row.total_calories) || 0;
    setShareText((row.shareLines || []).join('\n'));
    setShareTotal(total);
    setShareExercises(row.exercisesForShare || []);
    setShareDate(formatShareDate(row.started_at));
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
      if (user?.id && supabase && row.id && String(row.id).startsWith('local-') === false) {
        const res = await supabase.from('workouts').delete().eq('user_id', user.id).eq('id', row.id);
        if (res?.error) console.warn('[WorkoutHistory] cloud delete failed', res.error);
      }
      try {
        const wh = readWorkoutHistory();
        const rowDayUS = toUS(row.started_at);
        const rowTotal = safeNum(row.total_calories, 0);
        const filtered = (wh || []).filter(sess => {
          const sameId =
            (row.client_id && (sess.id === row.client_id || sess.client_id === row.client_id)) ||
            (row.id && (sess.id === row.id || sess.client_id === row.id));
          if (sameId) return false;
          const sameDay = sess?.date === rowDayUS;
          const sameTotal = Math.abs(safeNum(sess?.totalCalories ?? sess?.total_calories, 0) - rowTotal) < 0.01;
          if (!row.client_id && !row.id && sameDay && sameTotal) return false;
          return true;
        });
        writeWorkoutHistory(filtered);
      } catch (e) {
        console.warn('[WorkoutHistory] local delete failed', e);
      }
      setRows(prev => prev.filter(r => r.id !== row.id));
      await recomputeBurnedTodayAndSync();
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!user) {
        const asRows = localIdx.raw.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).map((h, idx) => ({
          id: `local-${idx}`,
          started_at: new Date(h.date).toISOString(),
          ended_at: new Date(h.date).toISOString(),
          sets: (h.exercises || []).map(e => ({ exercise_name: e.name, reps: e.reps ?? 0, weight: e.weight ?? 0, calories: typeof e.calories === 'number' ? e.calories : undefined, exerciseType: e.exerciseType || undefined })),
          total_calories: Number(h.totalCalories) || 0,
          shareLines: (h.exercises || []).map(e => `- ${e.name}: ${e.sets}×${e.reps}${e.weight ? ` @ ${e.weight} lb` : ''} (${(e.calories || 0).toFixed(0)} cal)`),
          exercisesForShare: (h.exercises || []).map(e => ({ exerciseName: e.name, sets: e.sets, reps: e.reps, weight: e.weight, calories: e.calories, exerciseType: e.exerciseType || undefined })),
        }));
        if (!ignore) {
          setRows(asRows);
          if (onHistoryChange) onHistoryChange(sumTotals(asRows));
        }
        return;
      }

      try {
        const seeded = localIdx.raw.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).map((h, idx) => ({
          id: `seed-${idx}`,
          started_at: new Date(h.date || Date.now()).toISOString(),
          total_calories: safeNum(h.totalCalories, 0),
          __draft: !!h.__draft,
          __local: true,
          exercises: Array.isArray(h.exercises) ? h.exercises : (Array.isArray(h.items) ? h.items : (h.items?.exercises || [])),
          client_id: h.client_id || h.id,
        }));
        if (!ignore && seeded.length) {
          setRows(seeded);
          if (onHistoryChange) onHistoryChange(sumTotals(seeded));
        }
      } catch {}

      setLoading(true);
      try {
        const base = await getWorkouts(user.id, { limit: 200 });
        if (!Array.isArray(base) || base.length === 0) {
          setLoading(false);
          return;
        }
        const withSets = base.map(w => {
          const exercises = getExercisesFromWorkout(w);
          const sets = setsFromExercises(exercises);
          const dayUS = toUS(w.started_at);
          const candidates = localIdx.byDay.get(dayUS) || [];
          const fallback = bestLocalMatch(candidates, sets);
          const total = (typeof w.total_calories === 'number' && Number.isFinite(w.total_calories))
            ? Number(w.total_calories)
            : (fallback && Number.isFinite(fallback.totalCalories))
              ? Number(fallback.totalCalories)
              : calcCaloriesFromSets(sets);
          const exercisesForShare = (exercises || []).map(ex => ({
            exerciseName: ex.name || ex.exerciseName,
            sets: ex.sets,
            reps: ex.reps,
            weight: ex.weight || null,
            calories: ex.calories,
            exerciseType: ex.exerciseType || undefined,
          }));
          const shareLines = (exercises || []).map(ex => `- ${ex.name || ex.exerciseName}: ${ex.sets || 1}×${ex.reps || ''}${ex.weight ? ` @ ${ex.weight} lb` : ''} (${(Number(ex.calories) || 0).toFixed(0)} cal)`);
          return { ...w, sets, total_calories: total, shareLines, exercisesForShare };
        });
        if (!ignore) {
          setRows(withSets);
          if (onHistoryChange) onHistoryChange(sumTotals(withSets));
        }
      } catch (err) {
        console.error('[WorkoutHistory] fetch failed, falling back to local', err);
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [user, onHistoryChange, localIdx, sumTotals]);

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 2, md: 4 } }}>
      <Paper
        variant="outlined"
        sx={{
          mb: 3,
          p: { xs: 2.25, md: 3 },
          borderRadius: 6,
          border: '1px solid rgba(16,24,40,0.06)',
          boxShadow: '0 10px 34px rgba(15,23,42,0.05)',
          textAlign: 'center',
        }}
      >
        <Typography sx={{ fontWeight: 900, fontSize: { xs: '2.2rem', md: '3rem' }, lineHeight: 1.05, mb: 1 }}>
          Workout History
        </Typography>
        <Typography sx={{ color: 'text.secondary', maxWidth: 760, mx: 'auto', fontSize: { xs: '1rem', md: '1.1rem' }, mb: 2 }}>
          Review recent sessions, see what you completed, and keep your training streak feeling real.
        </Typography>
        <Stack direction="row" spacing={1} justifyContent="center" flexWrap="wrap" useFlexGap>
          <Chip icon={<FitnessCenterRoundedIcon />} label={`${totalSessions} sessions logged`} sx={{ fontWeight: 700 }} />
          <Chip icon={<LocalFireDepartmentRoundedIcon />} label={`${Math.round(totalCalories)} calories burned`} sx={{ fontWeight: 700 }} />
        </Stack>
      </Paper>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : rows.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, borderRadius: 5, textAlign: 'center' }}>
          <Typography sx={{ fontWeight: 800, fontSize: '1.4rem', mb: 1 }}>No workouts logged yet</Typography>
          <Typography color="text.secondary">Your recent sessions will show up here once you start logging workouts.</Typography>
        </Paper>
      ) : (
        <Stack spacing={2.5}>
          {rows.map((w) => {
            const exerciseSummary = summarizeExercisesFromSets(w.sets || []);
            const total = Math.round(Number(w.total_calories) || 0);
            const exerciseCount = exerciseSummary.length || (w.exercisesForShare || []).length || 0;
            return (
              <Paper
                key={w.id}
                variant="outlined"
                sx={{
                  p: { xs: 2, md: 2.5 },
                  borderRadius: 5,
                  border: '1px solid rgba(16,24,40,0.06)',
                  boxShadow: '0 10px 28px rgba(15,23,42,0.04)',
                }}
              >
                <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontWeight: 900, fontSize: { xs: '1.45rem', md: '1.65rem' }, lineHeight: 1.1 }}>
                      {formatDateOnly(w.started_at)}
                    </Typography>
                    <Typography sx={{ color: 'text.secondary', mt: 0.5, mb: 1.5 }}>
                      {formatTimeOnly(w.started_at)}
                    </Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.75 }}>
                      <Chip label={`${total} cals`} sx={{ fontWeight: 700 }} />
                      <Chip label={`${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}`} variant="outlined" sx={{ fontWeight: 700 }} />
                    </Stack>
                  </Box>

                  <Stack direction="row" spacing={0.5} alignItems="flex-start" justifyContent={{ xs: 'flex-start', md: 'flex-end' }}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<IosShareRoundedIcon />}
                      onClick={() => openShareFor(w)}
                      sx={{ borderRadius: 999 }}
                    >
                      Share Session
                    </Button>
                    <IconButton color="error" onClick={() => askDeleteRow(w)} disabled={deleting}>
                      <DeleteIcon />
                    </IconButton>
                  </Stack>
                </Stack>

                <Divider sx={{ my: 1.5 }} />

                <Stack spacing={1.2}>
                  {exerciseSummary.length > 0 ? exerciseSummary.map((e, i) => (
                    <Paper
                      key={`${w.id}-${e.name}-${i}`}
                      variant="outlined"
                      sx={{
                        p: 1.5,
                        borderRadius: 4,
                        background: 'rgba(248,250,252,0.95)',
                        border: '1px solid rgba(59,130,246,0.10)',
                      }}
                    >
                      <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', mb: 0.4 }}>{e.name}</Typography>
                      <Typography sx={{ color: 'text.secondary' }}>
                        {e.minutes
                          ? `${Math.round(e.minutes)} min`
                          : `${e.sets} set${e.sets === 1 ? '' : 's'}${e.reps ? ` • ${e.reps} reps` : ''}${e.topWeight ? ` • top ${Math.round(e.topWeight)} lb` : ''}`}
                      </Typography>
                    </Paper>
                  )) : (
                    (w.shareLines || []).map((line, i) => (
                      <Paper key={`${w.id}-fallback-${i}`} variant="outlined" sx={{ p: 1.5, borderRadius: 4 }}>
                        <Typography sx={{ color: 'text.secondary' }}>• {line.replace(/^- /, '')}</Typography>
                      </Paper>
                    ))
                  )}
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}

      <ShareWorkoutModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        shareText={shareText}
        exercises={shareExercises}
        totalCalories={shareTotal}
        workoutDate={shareDate}
      />

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Delete workout?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            This will remove the workout from your history and update today’s burned calories.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={deleting}>Cancel</Button>
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
