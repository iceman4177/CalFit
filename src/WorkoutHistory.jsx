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
import { getWorkouts } from './lib/db';
import ShareWorkoutModal from './ShareWorkoutModal';

import { ensureScopedFromLegacy, readScopedJSON, writeScopedJSON, KEYS } from './lib/scopedStorage.js';



function setsFromExercises(exercises = []) {
  const exArr = Array.isArray(exercises) ? exercises : [];
  const rows = [];
  for (const ex of exArr) {
    const name = String(ex?.name || ex?.exerciseName || '').trim();
    if (!name) continue;
    const nSets = Math.max(1, parseInt(ex?.sets, 10) || 1);
    const reps = ex?.reps != null ? Number(ex.reps) : 0;
    const weight = ex?.weight != null ? Number(ex.weight) : 0;
    const volume = ex?.volume != null ? Number(ex.volume) : 0; // minutes for cardio if used
    for (let i = 0; i < nSets; i += 1) {
      rows.push({
        exercise_name: name,
        reps: Number.isFinite(reps) ? reps : 0,
        weight: Number.isFinite(weight) ? weight : 0,
        volume: Number.isFinite(volume) ? volume : 0,
      });
    }
  }
  return rows;
}

function getExercisesFromWorkout(workout) {
  try {
    const items = workout?.items;
    if (items && typeof items === 'object') {
      const ex = items.exercises;
      if (Array.isArray(ex) && ex.length) return ex;
    }
  } catch (e) {}
  return null;
}

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

function formatDateTime(iso) { try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }); } catch (e) { return iso; } }
function formatDateOnly(iso) {
  try { return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }); }
  catch (e) { return iso; }
}
function toUS(iso) { try { return new Date(iso).toLocaleDateString('en-US'); } catch (e) { return iso; } }

// ---- local-day helpers (avoid UTC drift) ----
function localDayISO(d = new Date()) {
  try {
    const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return ld.toISOString().slice(0, 10);
  } catch (e) {
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
  } catch (e) {}

  // fallback to mealHistory
  try {
    const mh = JSON.parse(localStorage.getItem('mealHistory') || '[]') || [];
    const rec = mh.find(m => m?.date === todayUS || m?.date === todayISO);
    if (!rec?.meals?.length) return 0;
    return rec.meals.reduce((s, m) => s + safeNum(m?.calories, 0), 0);
  } catch (e) {}

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
  } catch (e) {}
}

function dispatchBurnedUpdate(dayISO, burned) {
  try {
    window.dispatchEvent(
      new CustomEvent('slimcal:burned:update', {
        detail: { date: dayISO, burned: safeNum(burned, 0) }
      })
    );
  } catch (e) {}
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

  // --- User-scoped workout history (prevents cross-account contamination on same device) ---
  const userId = user?.id || null;

  const readWorkoutHistory = useCallback(() => {
    try {
      ensureScopedFromLegacy(KEYS.workoutHistory, userId);
      const list = readScopedJSON(KEYS.workoutHistory, userId, []);
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }, [userId]);

  const writeWorkoutHistory = useCallback((list) => {
    try {
      ensureScopedFromLegacy(KEYS.workoutHistory, userId);
      writeScopedJSON(KEYS.workoutHistory, userId, Array.isArray(list) ? list : []);
    } catch (e) {}
  }, [userId]);

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareText, setShareText] = useState('');
  const [shareExercises, setShareExercises] = useState([]);
  const [shareTotal, setShareTotal] = useState(0);
  const [shareStartedAt, setShareStartedAt] = useState('');

  // delete confirm dialog
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
      const wh = readWorkoutHistory();
      burnedToday = (wh || [])
        .filter(w => w?.date === todayUS || w?.date === todayISO)
        .reduce((s, w) => s + safeNum(w?.totalCalories ?? w?.total_calories, 0), 0);
    } catch (e) {}

    const consumedToday = readTodayConsumedFromLocal();

    // write caches so banner updates instantly
    writeDailyMetricsCache(todayISO, consumedToday, burnedToday);
    try {
      localStorage.setItem('burnedToday', String(Math.round(burnedToday || 0)));
    } catch (e) {}

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

    const header = `I just logged a workout on ${date} with Slimcal.ai — ${Math.round(total)} calories burned! #SlimcalAI`;

    const body = (row.shareLines || []).join('\n');
    setShareText(`${header}\n\n${body}`);
    setShareTotal(total);
    setShareStartedAt(date);
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
        const wh = readWorkoutHistory();

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

        writeWorkoutHistory(filtered);
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


      // Seed from local-first cache so History never goes blank while cloud fetch runs.
      try {
        const seeded = localIdx.raw
          .slice()
          .sort((a, b) => new Date(b.date) - new Date(a.date))
          .map((h, idx) => ({
            id: `seed-${idx}`,
            started_at: new Date(h.date || Date.now()).toISOString(),
            total_calories: safeNum(h.totalCalories, 0),
            __draft: !!h.__draft,
            __local: true,
            exercises: Array.isArray(h.exercises) ? h.exercises : (Array.isArray(h.items) ? h.items : (h.items?.exercises || [])),
            client_id: h.client_id || h.id
          }));
        if (!ignore && seeded.length) {
          setRows(seeded);
          if (onHistoryChange) onHistoryChange(sumTotals(seeded));
        }
      } catch (e) {}

      setLoading(true);
      try {
        const base = await getWorkouts(user.id, { limit: 200 });

        if (!Array.isArray(base) || base.length === 0) {
          // keep seeded local history; don't clobber
          setLoading(false);
          return;
        }

        const withSets = base.map(w => {
          const exercises = getExercisesFromWorkout(w);
          const sets = setsFromExercises(exercises);

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
          const exercisesForShare = (exercises || []).map(ex => ({
            exerciseName: ex.name || ex.exerciseName,
            sets: ex.sets,
            reps: ex.reps,
            weight: ex.weight || null,
            calories: ex.calories,
            exerciseType: ex.exerciseType || undefined,
          }));

          const shareLines = (exercises || []).map(ex =>
            `- ${ex.name || ex.exerciseName}: ${ex.sets || 1}×${ex.reps || ''}${ex.weight ? ` @ ${ex.weight} lb` : ''} (${(Number(ex.calories) || 0).toFixed(0)} cal)`
          );

          return {
            ...w,
            sets,
            total_calories: total,
            shareLines,
            exercisesForShare
          };
        });

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
    <Container maxWidth="md" sx={{ py: { xs: 2.5, md: 4 } }}>
      <Paper
        elevation={0}
        sx={{
          mb: { xs: 2.5, md: 4 },
          px: { xs: 3, sm: 5 },
          py: { xs: 4, sm: 4.5 },
          borderRadius: { xs: 8, md: 10 },
          background: 'linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)',
          border: '1px solid rgba(157,183,255,0.18)',
          boxShadow: '0 12px 36px rgba(15, 23, 42, 0.05)',
          textAlign: 'center',
        }}
      >
        <Typography
          sx={{
            fontWeight: 900,
            fontSize: { xs: '3rem', sm: '4rem', md: '4.3rem' },
            lineHeight: 0.98,
            letterSpacing: '-0.04em',
            color: '#0f172a',
          }}
        >
          Workout History
        </Typography>

        <Typography
          sx={{
            mt: 1.75,
            mx: 'auto',
            maxWidth: 880,
            color: '#64748b',
            fontSize: { xs: 18, sm: 21 },
            lineHeight: 1.55,
          }}
        >
          Review recent sessions, see what you completed, and keep your training streak feeling real.
        </Typography>

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.4}
          justifyContent="center"
          alignItems="center"
          sx={{ mt: 2.5 }}
        >
          <Chip
            icon={<span style={{ fontSize: 17 }}>🏋️</span>}
            label={`${totalSessions} sessions logged`}
            sx={{
              height: 42,
              borderRadius: 999,
              background: '#eef2ff',
              color: '#0f172a',
              fontWeight: 800,
              '& .MuiChip-label': { px: 2, fontSize: 15 },
            }}
          />
          <Chip
            icon={<span style={{ fontSize: 17 }}>🔥</span>}
            label={`${Math.round(totalCalories)} calories burned`}
            sx={{
              height: 42,
              borderRadius: 999,
              background: '#eaf7f2',
              color: '#0f172a',
              fontWeight: 800,
              '& .MuiChip-label': { px: 2, fontSize: 15 },
            }}
          />
        </Stack>
      </Paper>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : rows.length === 0 ? (
        <Paper
          elevation={0}
          sx={{
            borderRadius: 6,
            px: 3,
            py: 5,
            textAlign: 'center',
            border: '1px solid rgba(157,183,255,0.18)',
            boxShadow: '0 10px 30px rgba(15, 23, 42, 0.04)',
          }}
        >
          <Typography sx={{ fontSize: 26, fontWeight: 900, color: '#0f172a' }}>
            No workouts logged yet
          </Typography>
          <Typography sx={{ mt: 1, color: '#64748b', fontSize: 17 }}>
            Finish a session and it will show up here as part of your training record.
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={{ xs: 2.25, md: 3 }}>
          {rows.map(w => {
            const exerciseSummary = summarizeExercisesFromSets(w.sets || []);
            const exerciseCount = exerciseSummary.length || (w.exercisesForShare || []).length || 0;

            return (
              <Paper
                key={w.id}
                elevation={0}
                sx={{
                  p: { xs: 2.25, sm: 3 },
                  borderRadius: { xs: 6, md: 7 },
                  border: '1px solid rgba(157,183,255,0.18)',
                  boxShadow: '0 12px 34px rgba(15, 23, 42, 0.05)',
                  background: 'linear-gradient(180deg, #ffffff 0%, #fbfdff 100%)',
                }}
              >
                <Stack spacing={2}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    alignItems={{ xs: 'stretch', sm: 'flex-start' }}
                    justifyContent="space-between"
                    spacing={{ xs: 1.4, sm: 1.25 }}
                    sx={{ minWidth: 0 }}
                  >
                    <Box sx={{ minWidth: 0, flex: 1, pr: { xs: 0, sm: 1 } }}>
                      <Typography sx={{ fontWeight: 900, color: '#0f172a', fontSize: { xs: '2.05rem', sm: '2.5rem' }, lineHeight: 0.98 }}>
                        {formatDateOnly(w.started_at)}
                      </Typography>
                      <Typography sx={{ mt: 1, color: '#667085', fontSize: { xs: 16, sm: 18 } }}>
                        {formatDateTime(w.started_at)}
                      </Typography>
                    </Box>

                    <Stack
                      direction="row"
                      spacing={0.75}
                      alignItems="center"
                      justifyContent={{ xs: 'space-between', sm: 'flex-end' }}
                      sx={{
                        flexShrink: 0,
                        ml: { xs: 0, sm: 'auto' },
                        width: { xs: '100%', sm: 'auto' },
                        maxWidth: '100%',
                      }}
                    >
                      <Button
                        variant="outlined"
                        onClick={() => openShareFor(w)}
                        startIcon={<span style={{ fontSize: 18, lineHeight: 1 }}>⤴︎</span>}
                        sx={{
                          minWidth: 0,
                          whiteSpace: 'nowrap',
                          textTransform: 'none',
                          fontWeight: 800,
                          color: '#3367E8',
                          borderColor: '#9db7ff',
                          borderRadius: 999,
                          flex: { xs: 1, sm: '0 0 auto' },
                          justifyContent: 'center',
                          px: { xs: 1.25, sm: 2.1 },
                          py: { xs: 0.9, sm: 1.1 },
                          fontSize: { xs: 14, sm: 16 },
                          lineHeight: 1,
                          minHeight: { xs: 44, sm: 48 },
                          maxWidth: { xs: 'calc(100% - 52px)', sm: 'none' },
                          '& .MuiButton-startIcon': { mr: { xs: 0.4, sm: 0.75 }, ml: 0 },
                        }}
                      >
                        <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>Share</Box>
                        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Share Session</Box>
                      </Button>

                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => askDeleteRow(w)}
                        disabled={deleting}
                        sx={{
                          flexShrink: 0,
                          alignSelf: 'center',
                          width: 44,
                          height: 44,
                          ml: 0,
                          borderRadius: 999,
                          border: '1px solid rgba(239,68,68,0.18)',
                          background: 'rgba(254,242,242,0.92)',
                          '& svg': { fontSize: { xs: 23, sm: 22 } },
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </Stack>

                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip
                      label={`${Math.round(Number(w.total_calories) || 0)} cals`}
                      sx={{
                        height: 38,
                        borderRadius: 999,
                        background: '#eef2ff',
                        color: '#0f172a',
                        fontWeight: 800,
                        '& .MuiChip-label': { px: 1.8, fontSize: 14 },
                      }}
                    />
                    <Chip
                      label={`${exerciseCount} ${exerciseCount === 1 ? 'exercise' : 'exercises'}`}
                      variant="outlined"
                      sx={{
                        height: 38,
                        borderRadius: 999,
                        borderColor: 'rgba(15,23,42,0.22)',
                        color: '#0f172a',
                        fontWeight: 800,
                        '& .MuiChip-label': { px: 1.8, fontSize: 14 },
                      }}
                    />
                  </Stack>

                  <Divider />

                  <Stack spacing={1.5}>
                    {exerciseSummary.length > 0 ? (
                      exerciseSummary.map((e, i) => (
                        <Paper
                          key={i}
                          elevation={0}
                          sx={{
                            px: { xs: 2, sm: 2.5 },
                            py: { xs: 1.8, sm: 2.05 },
                            borderRadius: 999,
                            background: '#f8fbff',
                            border: '1px solid rgba(157,183,255,0.22)',
                          }}
                        >
                          <Typography sx={{ fontWeight: 900, color: '#0f172a', fontSize: { xs: 18, sm: 19 } }}>
                            {e.name}
                          </Typography>
                          <Typography sx={{ mt: 0.4, color: '#667085', fontSize: { xs: 16, sm: 17 } }}>
                            {e.minutes
                              ? `${Math.round(e.minutes)} min`
                              : `${e.sets} set${e.sets === 1 ? '' : 's'}`}
                          </Typography>
                        </Paper>
                      ))
                    ) : (
                      (w.shareLines || []).map((line, i) => (
                        <Paper
                          key={i}
                          elevation={0}
                          sx={{
                            px: { xs: 2, sm: 2.5 },
                            py: { xs: 1.6, sm: 1.85 },
                            borderRadius: 999,
                            background: '#f8fbff',
                            border: '1px solid rgba(157,183,255,0.22)',
                          }}
                        >
                          <Typography sx={{ color: '#0f172a', fontSize: { xs: 16, sm: 17 } }}>
                            {line.replace(/^- /, '')}
                          </Typography>
                        </Paper>
                      ))
                    )}
                  </Stack>
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
        startedAt={shareStartedAt}
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
