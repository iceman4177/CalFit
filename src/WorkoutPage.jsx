// src/WorkoutPage.jsx
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Container,
  Typography,
  Divider,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Grid,
  Card,
  CardContent,
  Paper,
  Stack,
  Chip
} from '@mui/material';
import { useHistory } from 'react-router-dom';
import ExerciseForm from './ExerciseForm';
import SaunaForm from './SaunaForm';
import ShareWorkoutModal from './ShareWorkoutModal';
import TemplateSelector from './TemplateSelector';
import { MET_VALUES } from './exerciseMeta';
import { EXERCISE_ROM } from './exerciseConstants';
import { updateStreak } from './utils/streak';
import SuggestedWorkoutCard from './components/SuggestedWorkoutCard';
import UpgradeModal from './components/UpgradeModal';
import FeatureUseBadge, {
  canUseDailyFeature,
  registerDailyFeatureUse
} from './components/FeatureUseBadge.jsx';
import { useAuth } from './context/AuthProvider.jsx';
import { calcExerciseCaloriesHybrid } from './analytics';
import { callAIGenerate } from './lib/ai'; // ✅ identity-aware AI helper

// ✅ direct Supabase reads for lightweight "today" history hydration (mirrors meals behavior)
import { supabase } from './lib/supabaseClient';

// ✅ local-first wrappers (idempotent, queued sync, syncs to Supabase when signed in)
import {
  saveWorkoutLocalFirst,
  deleteWorkoutLocalFirst,
  upsertDailyMetricsLocalFirst
} from './lib/localFirst';

// ---- Paywall helpers ----
const isProUser = () => {
  try {
    if (localStorage.getItem('isPro') === 'true') return true;
    const ud = JSON.parse(localStorage.getItem('userData') || '{}');
    return !!ud.isPremium;
  } catch {
    return false;
  }
};


// ---- Cloud workout_sets helpers ------------------------------------------------
// workout_sets.workout_id historically references the workout's *client_id* (stable across devices).
const WORKOUT_SET_SCALE = 0.1; // kcal proxy per (lb*rep) if no explicit calories

function summarizeExercisesFromSetsCloud(sets = []) {
  if (!Array.isArray(sets) || sets.length === 0) return [];
  const map = new Map();
  for (const s of sets) {
    const name = String(s.exercise_name || 'Exercise').trim();
    const prev = map.get(name) || { name, sets: 0, reps: 0, weightMax: 0, calories: 0, exerciseType: undefined };
    prev.sets += 1;
    prev.reps += safeNum(s.reps, 0);
    const wt = safeNum(s.weight, 0);
    if (wt > prev.weightMax) prev.weightMax = wt;

    // calories: if volume looks like calories (cardio), use it; else proxy
    const c =
      (typeof s.volume === 'number' && Number.isFinite(s.volume) && safeNum(s.reps, 0) === 0 && safeNum(s.weight, 0) === 0)
        ? s.volume
        : (wt * safeNum(s.reps, 0) * WORKOUT_SET_SCALE);

    prev.calories += safeNum(c, 0);
    map.set(name, prev);
  }
  return Array.from(map.values())
    .sort((a, b) => (b.calories || 0) - (a.calories || 0))
    .map(x => ({
      name: x.name,
      sets: x.sets,
      reps: x.reps,
      weight: x.weightMax || 0,
      calories: Math.round((x.calories || 0) * 100) / 100,
      exerciseType: x.exerciseType
    }));
}

async function replaceWorkoutSetsCloud({ userId, workoutClientId, exercises = [] }) {
  if (!userId || !workoutClientId) return;
  const wid = String(workoutClientId);

  const rows = [];
  for (const ex of (exercises || [])) {
    const name = String(ex?.name || ex?.exerciseName || 'Exercise').trim();
    if (!name) continue;

    const type = ex?.exerciseType || '';
    if (type === 'cardio') {
      const cals = Number(ex?.calories);
      rows.push({
        user_id: userId,
        workout_id: wid,
        exercise_name: name,
        reps: null,
        weight: null,
        tempo: null,
        // store cardio calories in volume so it can be rendered cross-device without schema changes
        volume: Number.isFinite(cals) ? cals : null
      });
      continue;
    }

    const setsN = Math.max(1, parseInt(ex?.sets ?? 1, 10) || 1);
    const repsN = parseInt(ex?.reps ?? 0, 10) || 0;
    const weightN = Number(ex?.weight ?? 0) || 0;

    for (let i = 0; i < setsN; i++) {
      rows.push({
        user_id: userId,
        workout_id: wid,
        exercise_name: name,
        reps: repsN || null,
        weight: weightN || null,
        tempo: ex?.tempo || null,
        volume: null
      });
    }
  }

  const delRes = await supabase
    .from('workout_sets')
    .delete()
    .eq('user_id', userId)
    .eq('workout_id', wid);

  if (delRes?.error) throw delRes.error;

  if (rows.length === 0) return;
  const insRes = await supabase.from('workout_sets').insert(rows);
  if (insRes?.error) throw insRes.error;
}
// ---- formatting ----
function formatExerciseLine(ex) {
  const setsNum = parseInt(ex.sets, 10);
  const hasSets = Number.isFinite(setsNum) && setsNum > 0;

  let repsStr = '';
  if (typeof ex.reps === 'string') repsStr = ex.reps.trim();
  else {
    const r = parseInt(ex.reps, 10);
    repsStr = Number.isFinite(r) && r > 0 ? String(r) : '';
  }
  const hasReps = repsStr !== '' && repsStr !== '0';

  const weight = parseFloat(ex.weight);
  const hasWeight = Number.isFinite(weight) && weight > 0;

  const vol =
    hasSets && hasReps ? `${setsNum}×${repsStr}` :
      hasSets ? `${setsNum}×` :
        hasReps ? `×${repsStr}` : '';

  const wt = hasWeight ? ` @ ${weight} lb` : '';
  const name = ex.exerciseName || ex.name || 'Exercise';
  const kcals = ((+ex.calories) || 0).toFixed(2);

  if (!vol && !hasWeight) return `${name} — ${kcals} cals`;
  return `${name} — ${vol}${wt} — ${kcals} cals`;
}

// ---- Local-day ISO helper (local midnight; avoids UTC off-by-one) ----
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

function tryHHMM(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

// ---- Stable device id (not workout session id) ----
function getOrCreateClientId() {
  try {
    let cid = localStorage.getItem('clientId');
    if (!cid) {
      cid = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : String(Date.now());
      localStorage.setItem('clientId', cid);
    }
    return cid;
  } catch {
    return 'anon';
  }
}

// ✅ Stable draft workout session id (THIS is what prevents duplicates + enables upsert while typing)
function getOrCreateActiveWorkoutSessionId() {
  try {
    let sid = localStorage.getItem('slimcal:activeWorkoutSessionId');
    if (!sid) {
      sid = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `w_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      localStorage.setItem('slimcal:activeWorkoutSessionId', sid);
    }
    return sid;
  } catch {
    return (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `w_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function clearActiveWorkoutSessionId() {
  try {
    localStorage.removeItem('slimcal:activeWorkoutSessionId');
  } catch { }
}

export default function WorkoutPage({ userData, onWorkoutLogged }) {
  const history = useHistory();
  const { user } = useAuth();

  useEffect(() => {
    if (!userData) history.replace('/edit-info');
  }, [userData, history]);

  const [currentStep, setCurrentStep] = useState(1);
  const [cumulativeExercises, setCumulativeExercises] = useState([]);
  const [newExercise, setNewExercise] = useState({
    exerciseType: '',
    cardioType: '',
    manualCalories: '',
    muscleGroup: '',
    exerciseName: '',
    weight: '',
    sets: '1',
    reps: '',
    concentricTime: '',
    eccentricTime: ''
  });
  const [currentCalories, setCurrentCalories] = useState(0);
  const [showSaunaSection, setShowSaunaSection] = useState(false);
  const [saunaTime, setSaunaTime] = useState('');
  const [saunaTemp, setSaunaTemp] = useState('180');
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [showSuggestCard, setShowSuggestCard] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showBackHelp, setShowBackHelp] = useState(false);
  const [showLogHelp, setShowLogHelp] = useState(false);
  const [showShareHelp, setShowShareHelp] = useState(false);
  const [showNewHelp, setShowNewHelp] = useState(false);

  // ✅ "Meals-style": show today's logged workouts at the bottom (no need to leave page)
  const [todaySessions, setTodaySessions] = useState([]);
  const [loadingTodaySessions, setLoadingTodaySessions] = useState(false);

  // ✅ stable draft id ref for this workout session
  const activeWorkoutSessionIdRef = useRef(getOrCreateActiveWorkoutSessionId());

  // ✅ stable "started_at" so autosaves don't constantly rewrite it
  const startedAtRef = useRef(new Date().toISOString());

  // ✅ debounce autosave timer
  const autosaveTimerRef = useRef(null);

  const readTodaySessionsFromLocal = useCallback(() => {
    const now = new Date();
    const todayUS = now.toLocaleDateString('en-US');
    const todayISO = localDayISO(now);
    try {
      const raw = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
      const list = Array.isArray(raw) ? raw : [];
      // --- De-dupe + normalize ---
      // Workouts can exist in localStorage with either `date` = todayUS or `date` = todayISO.
      // If both exist for the same session (same client_id), it shows twice and doubles burned.
      const byId = new Map();
      let sawDupes = false;

      const isToday = (d) => d === todayUS || d === todayISO;
      const score = (sess) => {
        const hasExercises = Array.isArray(sess?.exercises) && sess.exercises.length > 0;
        const total = safeNum(sess?.totalCalories ?? sess?.total_calories, 0);
        // prefer sessions with exercises, then higher total, then newer timestamp
        const t = new Date(sess?.started_at || sess?.createdAt || 0).getTime() || 0;
        return (hasExercises ? 1_000_000 : 0) + (total * 1000) + (t / 1000);
      };

      for (const w0 of list) {
        if (!w0) continue;
        const cid = String(w0?.client_id || w0?.id || '');
        if (!cid) continue;
        const w = {
          ...w0,
          // normalize totals for UI
          totalCalories: safeNum(w0?.totalCalories ?? w0?.total_calories, 0),
          total_calories: safeNum(w0?.total_calories ?? w0?.totalCalories, 0),
        };
        if (isToday(w?.date)) w.date = todayUS;

        const prev = byId.get(cid);
        if (!prev) byId.set(cid, w);
        else {
          sawDupes = true;
          byId.set(cid, score(w) >= score(prev) ? w : prev);
        }
      }

      let cleaned = Array.from(byId.values());
      // newest first
      cleaned.sort((a, b) => {
        const ta = new Date(a?.started_at || a?.createdAt || 0).getTime();
        const tb = new Date(b?.started_at || b?.createdAt || 0).getTime();
        return tb - ta;
      });

      // Today list (normalized to todayUS). Extra de-dupe by (time + kcal) to guard
      // against rare cases where two rows exist for the same workout but different ids.
      let today = cleaned.filter(w => w?.date === todayUS);
      if (today.length > 1) {
        const fpMap = new Map();
        const uniq = [];
        for (const w of today) {
          const total = safeNum(w?.totalCalories ?? w?.total_calories, 0);
          const hhmm = tryHHMM(w?.started_at || w?.createdAt || w?.ended_at);
          const fp = `${hhmm}|${Math.round(total * 10)}`;
          const prev = fpMap.get(fp);
          if (!prev) {
            fpMap.set(fp, w);
            uniq.push(w);
            continue;
          }
          // prefer the one with exercises detail
          const prevEx = Array.isArray(prev?.exercises) ? prev.exercises.length : 0;
          const curEx = Array.isArray(w?.exercises) ? w.exercises.length : 0;
          if (curEx > prevEx) {
            fpMap.set(fp, w);
            const idx = uniq.indexOf(prev);
            if (idx >= 0) uniq[idx] = w;
          } else {
            sawDupes = true;
          }
        }
        today = uniq;
        if (sawDupes) {
          // rebuild cleaned with today's unique sessions only
          const nonToday2 = cleaned.filter(w => w?.date !== todayUS);
          cleaned = [...today, ...nonToday2];
        }
      }

      setTodaySessions(today);

      // If we detected dupes / mixed date formats, write back a cleaned list + fix burned caches
      if (sawDupes) {
        try {
          localStorage.setItem('workoutHistory', JSON.stringify(cleaned.slice(0, 300)));
        } catch {}

        // Update burnedToday + dailyMetricsCache burned so banner doesn't flicker/double-count
        const burnedToday = today.reduce((s, w) => s + safeNum(w?.totalCalories ?? w?.total_calories, 0), 0);
        try {
          localStorage.setItem('burnedToday', String(Math.round(burnedToday || 0)));
        } catch {}
        try {
          const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
          const prev = cache[todayISO] || {};
          cache[todayISO] = {
            ...prev,
            burned: Math.round(burnedToday || 0),
            updated_at: new Date().toISOString()
          };
          localStorage.setItem('dailyMetricsCache', JSON.stringify(cache));
        } catch {}
        try {
          window.dispatchEvent(new CustomEvent('slimcal:burned:update', {
            detail: { date: todayISO, burned: Math.round(burnedToday || 0) }
          }));
        } catch {}
      }
    } catch {
      setTodaySessions([]);
    }
  }, []);

  const hydrateTodaySessionsFromCloud = useCallback(async () => {
    if (!user?.id || !supabase) return;
    const now = new Date();
    const dayISO = localDayISO(now);
    const todayUS = now.toLocaleDateString('en-US');
    const isTodayAny = (s) => {
      const d = String(s?.date || '');
      return d === String(todayUS) || d === String(dayISO);
    };
    const startLocal = new Date(`${dayISO}T00:00:00`);
    const nextLocal = new Date(startLocal.getTime() + 24 * 60 * 60 * 1000);

    setLoadingTodaySessions(true);
    try {
      // Prefer started_at range (same as meals)
      let data = null;
      let error = null;

      try {
        const res = await supabase
          .from('workouts')
          .select('id,client_id,total_calories,started_at,ended_at,created_at')
          .eq('user_id', user.id)
          .gte('started_at', startLocal.toISOString())
          .lt('started_at', nextLocal.toISOString());
        data = res?.data;
        error = res?.error;
      } catch {}

      // Fallback: created_at range
      if (error && /column .*started_at.* does not exist/i.test(error?.message || '')) {
        const res2 = await supabase
          .from('workouts')
          .select('id,client_id,total_calories,created_at')
          .eq('user_id', user.id)
          .gte('created_at', startLocal.toISOString())
          .lt('created_at', nextLocal.toISOString());
        data = res2?.data;
        error = res2?.error;
      }

      if (error) {
        console.warn('[WorkoutPage] hydrateTodaySessionsFromCloud failed', error);
        return;
      }

      const cloud = Array.isArray(data) ? data : [];
      if (cloud.length === 0) return;

      // Merge cloud sessions into local workoutHistory, preserving local exercise details if present
      try {
        const key = 'workoutHistory';
        const raw = JSON.parse(localStorage.getItem(key) || '[]');
        const list = Array.isArray(raw) ? raw : [];

        const map = new Map();
        for (const sess of list) {
          const cid = String(sess?.client_id || sess?.id || '');
          if (!cid) continue;
          map.set(cid, sess);
        }

        for (const w of cloud) {
          const cid = String(w?.client_id || w?.id || '');
          if (!cid) continue;

          const norm = {
            id: cid,
            client_id: cid,
            date: todayUS,
            started_at: w?.started_at || w?.created_at || new Date().toISOString(),
            ended_at: w?.ended_at || w?.started_at || w?.created_at || new Date().toISOString(),
            createdAt: w?.started_at || w?.created_at || new Date().toISOString(),
            totalCalories: safeNum(w?.total_calories, 0),
            total_calories: safeNum(w?.total_calories, 0),
            name: 'Workout',
            exercises: [],
            uploaded: true,
            __cloud: true
          };

          const existing = map.get(cid);
          if (existing) {
            const keepExercises = Array.isArray(existing?.exercises) && existing.exercises.length > 0;
            map.set(cid, {
              ...norm,
              ...existing,
              exercises: keepExercises ? existing.exercises : norm.exercises,
              totalCalories: safeNum(existing?.totalCalories ?? existing?.total_calories, norm.totalCalories),
              total_calories: safeNum(existing?.total_calories ?? existing?.totalCalories, norm.total_calories)
            });
          } else {
            map.set(cid, norm);
          }
        }

        const nonToday = list.filter(s => !isTodayAny(s));
        let todayMerged = Array.from(map.values()).filter(s => isTodayAny(s));

        // Normalize all today entries to use the US string (matches meals)
        todayMerged = todayMerged.map(s => ({ ...s, date: todayUS }));
        todayMerged.sort((a, b) => {
          const ta = new Date(a?.started_at || a?.createdAt || 0).getTime();
          const tb = new Date(b?.started_at || b?.createdAt || 0).getTime();
          return tb - ta;
        });

        // Extra guard: if two sessions have different ids but same time+calories,
        // treat as duplicate (prevents double-count + banner flicker).
        if (todayMerged.length > 1) {
          const seen = new Set();
          const uniq = [];
          for (const s of todayMerged) {
            const kcal = Math.round(safeNum(s?.totalCalories ?? s?.total_calories, 0) * 10) / 10;
            const hhmm = tryHHMM(s?.started_at || s?.createdAt || '');
            const fp = `${hhmm}|${kcal}`;
            if (hhmm && kcal > 0 && seen.has(fp)) continue;
            seen.add(fp);
            uniq.push(s);
          }
          todayMerged = uniq;
        }

        const next = [...todayMerged, ...nonToday];
        localStorage.setItem(key, JSON.stringify(next.slice(0, 300)));

        // Update burnedToday + cache so banner reflects sessions immediately
        const burnedToday = todayMerged.reduce((s, sess) => s + safeNum(sess?.totalCalories ?? sess?.total_calories, 0), 0);
        try {
          localStorage.setItem('burnedToday', String(Math.round(burnedToday || 0)));
        } catch {}

        try {
          const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
          const prev = cache[dayISO] || {};
          cache[dayISO] = {
            ...prev,
            burned: Math.round(burnedToday || 0),
            updated_at: new Date().toISOString()
          };
          localStorage.setItem('dailyMetricsCache', JSON.stringify(cache));
        } catch {}

        try {
          window.dispatchEvent(new CustomEvent('slimcal:burned:update', {
            detail: { date: dayISO, burned: Math.round(burnedToday || 0) }
          }));
        } catch {}
      } catch (e) {
        console.warn('[WorkoutPage] merge cloud workouts into local failed', e);
      }
    } finally {
      setLoadingTodaySessions(false);
    }
  }, [user?.id]);

  // ✅ Meals-style behavior: on load/focus, pull today's workouts from cloud into local
  // and keep the on-page history + banner consistent without needing to visit /history.
  useEffect(() => {
    readTodaySessionsFromLocal();
    hydrateTodaySessionsFromCloud();

    const onWorkoutHistoryUpdate = () => readTodaySessionsFromLocal();
    const onBurnedUpdate = () => readTodaySessionsFromLocal();
    const onStorage = (e) => {
      if (!e) return;
      if (e.key === 'workoutHistory') readTodaySessionsFromLocal();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        hydrateTodaySessionsFromCloud();
        readTodaySessionsFromLocal();
      }
    };

    window.addEventListener('slimcal:workoutHistory:update', onWorkoutHistoryUpdate);
    window.addEventListener('slimcal:burned:update', onBurnedUpdate);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.removeEventListener('slimcal:workoutHistory:update', onWorkoutHistoryUpdate);
      window.removeEventListener('slimcal:burned:update', onBurnedUpdate);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [readTodaySessionsFromLocal, hydrateTodaySessionsFromCloud]);

  const handleDismiss = (key, setter, cb) => {
    try {
      localStorage.setItem(key, 'true');
    } catch { }
    setter(false);
    if (cb) cb();
  };

  const handleLoadTemplate = exercises => {
    setCumulativeExercises(
      (exercises || []).map(ex => ({
        exerciseType: ex.exerciseType || '',
        muscleGroup: ex.muscleGroup || '',
        exerciseName: ex.name,
        weight: ex.weight || '',
        sets: ex.sets || '',
        reps: ex.reps || '',
        concentricTime: ex.concentricTime || '',
        eccentricTime: ex.eccentricTime || '',
        calories: ex.calories
      }))
    );
  };

  const exerciseOptions = {
    cardio: ['Treadmill', 'Bike', 'Elliptical', 'Rowing Machine', 'Stair Climber'],
    machine: {
      Chest: ['Chest Press Machine', 'Cable Crossover/Functional Trainer'],
      Shoulders: ['Shoulder Press Machine'],
      Back: ['Seated Row Machine', 'Lat Pulldown Machine'],
      Legs: ['Leg Press Machine', 'Leg Extension Machine', 'Leg Curl Machine'],
      Abs: ['Abdominal Crunch Machine'],
      Misc: ['Pec Fly / Rear Deltoid Machine', 'Assisted Pull-Up/Dip Machine']
    },
    dumbbell: {
      Chest: ['Dumbbell Bench Press', 'Dumbbell Flyes'],
      Shoulders: ['Dumbbell Shoulder Press', 'Dumbbell Lateral Raise'],
      Biceps: ['Dumbbell Bicep Curls', 'Hammer Curls'],
      Triceps: ['Dumbbell Triceps Extensions'],
      Back: ['Dumbbell Rows (One-Arm Row)'],
      Traps: ['Dumbbell Shrugs'],
      Legs: ['Dumbbell Squats', 'Dumbbell Lunges', 'Dumbbell Deadlifts', 'Dumbbell Step-Ups']
    },
    barbell: {
      Chest: ['Barbell Bench Press'],
      Shoulders: ['Overhead Press (Barbell Press)', 'Barbell Upright Row'],
      Back: ['Barbell Row'],
      Biceps: ['Barbell Bicep Curls'],
      Legs: ['Barbell Squat', 'Barbell Deadlift', 'Barbell Lunges'],
      Glutes: ['Barbell Hip Thrusts'],
      FullBody: ['Barbell Clean and Press / Power Clean'],
      Traps: ['Barbell Shrugs']
    }
  };

  const calculateCalories = () => {
    if (!newExercise.exerciseName && newExercise.exerciseType !== 'cardio') {
      setCurrentCalories(0);
      return 0;
    }
    const entry = {
      exerciseName: newExercise.exerciseName || newExercise.exerciseType,
      sets: newExercise.sets,
      reps: newExercise.reps,
      tempo: `${newExercise.concentricTime || 2}-1-${newExercise.eccentricTime || 2}`,
      weight: newExercise.weight
    };
    const intent = (localStorage.getItem('training_intent') || 'general').toLowerCase();
    const total = calcExerciseCaloriesHybrid(
      entry,
      { weight: userData?.weight },
      { MET_VALUES, EXERCISE_ROM },
      intent
    );
    setCurrentCalories(total);
    return total;
  };

  const handleCalculate = () => {
    if (newExercise.exerciseType === 'cardio') {
      const cal = parseFloat(newExercise.manualCalories);
      if (!cal || cal <= 0) {
        alert('Please enter valid calories for cardio.');
        return;
      }
      setCurrentCalories(cal);
    } else {
      calculateCalories();
    }
  };

  const handleAddExercise = () => {
    if (newExercise.exerciseType === 'cardio') {
      const cal = parseFloat(newExercise.manualCalories);
      if (!cal || cal <= 0) {
        alert('Please enter valid calories for cardio.');
        return;
      }
            const entry = { exerciseType: 'cardio', exerciseName: newExercise.cardioType || 'Cardio', calories: cal };
      const next = [...cumulativeExercises, entry];
      setCumulativeExercises(next);
      instantPersistWorkoutDraftToBanner(next);
setNewExercise(prev => ({ ...prev, cardioType: '', manualCalories: '' }));
      setCurrentCalories(0);
      return;
    }

    if (
      !newExercise.exerciseName ||
      parseFloat(newExercise.weight) <= 0 ||
      parseInt(newExercise.reps, 10) <= 0
    ) {
      alert('Please enter a valid exercise, weight, and reps.');
      return;
    }

    const cals = calculateCalories();
        const entry = { ...newExercise, calories: cals };
    const next = [...cumulativeExercises, entry];
    setCumulativeExercises(next);
    instantPersistWorkoutDraftToBanner(next);

setNewExercise({
      exerciseType: '',
      cardioType: '',
      manualCalories: '',
      muscleGroup: '',
      exerciseName: '',
      weight: '',
      sets: '1',
      reps: '',
      concentricTime: '',
      eccentricTime: ''
    });
    setCurrentCalories(0);
  };

  const handleDoneWithExercises = () => {
    if (
      (newExercise.exerciseType === 'cardio' && parseFloat(newExercise.manualCalories) > 0) ||
      (newExercise.exerciseName &&
        parseFloat(newExercise.weight) > 0 &&
        parseInt(newExercise.reps, 10) > 0)
    ) {
      handleAddExercise();
    }
    setCurrentStep(3);
  };

  const handleRemoveExercise = idx => {
    const next = (cumulativeExercises || []).filter((_, i) => i !== idx);
    setCumulativeExercises(next);
    instantPersistWorkoutDraftToBanner(next);
  };

  // ✅ Sauna logging
  const handleSaveSauna = () => {
    if (saunaTime.trim()) {
      const t = parseFloat(saunaTime) || 0;
      const tmp = parseFloat(saunaTemp) || 180;
      const uw = parseFloat(userData?.weight) || 150;

      // temperature-scaled MET model
      const weightKg = uw * 0.45359237;
      let met = 1.5 + (tmp - 160) * 0.02;
      met = Math.min(Math.max(met, 1.3), 2.5);
      const kcalPerMin = (met * 3.5 * weightKg) / 200;
      const saunaCals = kcalPerMin * t;

            const next = [
        ...(cumulativeExercises || []).filter(e => e.exerciseType !== 'Sauna'),
        { exerciseType: 'Sauna', exerciseName: 'Sauna Session', calories: saunaCals }
      ];
      setCumulativeExercises(next);
      instantPersistWorkoutDraftToBanner(next);

    }

    setShowSaunaSection(false);
    setSaunaTime('');
    setSaunaTemp('180');
  };

  const handleCancelSaunaForm = () => {
    setShowSaunaSection(false);
    setSaunaTime('');
    setSaunaTemp('180');
  };

  // ✅ build a draft workout session that gets upserted continuously
  const buildDraftWorkoutSession = useCallback(() => {
    const now = new Date();
    const startedAt = startedAtRef.current || now.toISOString();
    const endedAt = now.toISOString();

    const todayLocalIso = localDayISO(now);
    const todayDisplay = now.toLocaleDateString('en-US');

    const totalRaw = cumulativeExercises.reduce((sum, ex) => sum + (Number(ex.calories) || 0), 0);
    const total = Math.round(totalRaw * 100) / 100;

    return {
      // ✅ upsert key for device sync
      client_id: activeWorkoutSessionIdRef.current,
      user_id: user?.id || null,

      started_at: startedAt,
      ended_at: endedAt,
      total_calories: total,

      // local history fields (used by History UI)
      date: todayDisplay,
      name: (cumulativeExercises[0]?.exerciseName) || 'Workout',
      exercises: cumulativeExercises.map(ex => ({
        name: ex.exerciseName,
        sets: ex.sets,
        reps: ex.reps,
        weight: ex.weight || null,
        calories: ex.calories
      })),

      // local metadata
      id: activeWorkoutSessionIdRef.current,
      localId: `w_${getOrCreateClientId()}_${Date.now()}`,
      createdAt: startedAt,
      uploaded: false,

      // helper
      __local_day: todayLocalIso
    };
  }, [cumulativeExercises, user?.id]);

  // ✅ INSTANT banner update (workout = meal behavior)
  // Meals update instantly because MealTracker writes to localStorage immediately.
  // Workouts MUST do the same: as you add/remove exercises, immediately upsert a draft
  // session into localStorage.workoutHistory + update burnedToday + dispatch event.
  const instantPersistWorkoutDraftToBanner = useCallback((nextExercises) => {
    try {
      const now = new Date();
      const todayISO = localDayISO(now);
      const todayUS = now.toLocaleDateString('en-US');

      const cid = activeWorkoutSessionIdRef.current;

      const key = 'workoutHistory';
      const existing = JSON.parse(localStorage.getItem(key) || '[]');
      const list = Array.isArray(existing) ? existing : [];

      const filtered = list.filter(w => {
        const wDay = w?.date;
        const wCid = w?.client_id || w?.id;
        const isToday = (wDay === todayUS || wDay === todayISO);
        const same = String(wCid || '') === String(cid || '');
        return !(isToday && same);
      });

      let nextList = filtered;

      if (Array.isArray(nextExercises) && nextExercises.length > 0) {
        const startedAt = startedAtRef.current || now.toISOString();
        const endedAt = now.toISOString();

        const totalRaw = nextExercises.reduce((s, ex) => s + safeNum(ex?.calories, 0), 0);
        const total = Math.round(totalRaw * 100) / 100;

        const sess = {
          // stable keys
          id: cid,
          client_id: cid,

          // dates
          date: todayUS,
          started_at: startedAt,
          ended_at: endedAt,
          createdAt: startedAt,

          // totals
          totalCalories: total,
          total_calories: total,

          // display
          name: (nextExercises[0]?.exerciseName) || 'Workout',
          exercises: nextExercises.map(ex => ({
            name: ex.exerciseName,
            sets: ex.sets,
            reps: ex.reps,
            weight: ex.weight || null,
            calories: ex.calories
          })),

          // flags
          uploaded: false,
          __draft: true
        };

        nextList = [sess, ...filtered];
      }

      localStorage.setItem(key, JSON.stringify(nextList.slice(0, 300)));

      // burnedToday = sum of all sessions logged today (including draft)
      const burnedToday = (nextList || [])
        .filter(w => w?.date === todayUS || w?.date === todayISO)
        .reduce((s, w) => s + safeNum(w?.totalCalories ?? w?.total_calories, 0), 0);

      try {
        localStorage.setItem('burnedToday', String(Math.round(burnedToday || 0)));
      } catch {}

      // Update dailyMetricsCache burned WITHOUT touching consumed
      try {
        const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
        const prev = cache[todayISO] || {};
        cache[todayISO] = {
          ...prev,
          burned: Math.round(burnedToday || 0),
          updated_at: new Date().toISOString()
        };
        localStorage.setItem('dailyMetricsCache', JSON.stringify(cache));
      } catch {}

      // Dispatch so NetCalorieBanner updates instantly
      try {
        window.dispatchEvent(new CustomEvent('slimcal:burned:update', {
          detail: { date: todayISO, burned: Math.round(burnedToday || 0) }
        }));
      } catch {}
    } catch (e) {
      console.warn('[WorkoutPage] instantPersistWorkoutDraftToBanner failed', e);
    }
  }, []);


  // ✅ keeps daily_metrics in sync so calories carry over across devices
  const syncBurnedTodayToDailyMetrics = useCallback(async (todayDisplay, todayLocalIso) => {
    try {
      const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
      const burnedToday = workouts
        .filter(w => w.date === todayDisplay)
        .reduce((s, w) => s + (Number(w.totalCalories ?? w.total_calories) || 0), 0);

      const meals = JSON.parse(localStorage.getItem('mealHistory') || '[]');
      const todayMealRec = meals.find(m => m.date === todayDisplay);
      const consumedToday = todayMealRec
        ? (todayMealRec.meals || []).reduce((s, m) => s + (Number(m.calories) || 0), 0)
        : 0;

      // broadcast for UI
      try {
        window.dispatchEvent(new CustomEvent('slimcal:burned:update', {
          detail: { date: todayLocalIso, burned: burnedToday }
        }));
      } catch { }

      // ✅ FIX: localFirst expects { consumed, burned }
      await upsertDailyMetricsLocalFirst({
        user_id: user?.id || null,
        local_day: todayLocalIso,
        consumed: consumedToday,
        burned: burnedToday
      });
    } catch (e) {
      console.warn('[WorkoutPage] syncBurnedTodayToDailyMetrics failed', e);
    }
  }, [user?.id]);

  // ✅ AUTOSAVE draft workout while logging (meal-style behavior)
  useEffect(() => {
    // If the list is empty, do NOT delete cloud/local drafts automatically.
// On mobile/route changes this component remounts with an empty state before we rehydrate.
// Auto-deleting here causes the "workout appears then disappears" regression.
if (!Array.isArray(cumulativeExercises) || cumulativeExercises.length === 0) {
  if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
  autosaveTimerRef.current = null;

  try { instantPersistWorkoutDraftToBanner([]); } catch {}
  return;
}

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);

    autosaveTimerRef.current = setTimeout(async () => {
      try {
        const session = buildDraftWorkoutSession();
        await saveWorkoutLocalFirst(session);
        await syncBurnedTodayToDailyMetrics(session.date, session.__local_day);
      } catch (e) {
        console.warn('[WorkoutPage] autosave draft failed', e);
      }
    }, 450);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [cumulativeExercises, buildDraftWorkoutSession, syncBurnedTodayToDailyMetrics, user?.id]);

  // ✅ Submit now just finalizes (draft already saved) + navigates to history
  const handleFinish = async () => {
    // add partial exercise if valid
    if (
      (newExercise.exerciseType === 'cardio' && parseFloat(newExercise.manualCalories) > 0) ||
      (newExercise.exerciseName &&
        parseFloat(newExercise.weight) > 0 &&
        parseInt(newExercise.reps, 10) > 0)
    ) {
      handleAddExercise();
    }

    const totalRaw = cumulativeExercises.reduce((sum, ex) => sum + (Number(ex.calories) || 0), 0);
    if (!cumulativeExercises.length || totalRaw <= 0) {
      alert('Add at least 1 exercise before submitting.');
      return;
    }

    try {
      const session = buildDraftWorkoutSession();
      await saveWorkoutLocalFirst(session);
      try {
        await replaceWorkoutSetsCloud({
          userId: user?.id,
          workoutClientId: session.client_id,
          exercises: session.exercises || []
        });
      } catch (e2) {
        console.warn('[WorkoutPage] workout_sets sync failed (will still show from local)', e2);
      }

      updateStreak();

      if (typeof onWorkoutLogged === 'function') {
        const total = Math.round(totalRaw * 100) / 100;
        onWorkoutLogged(total);
      }

      await syncBurnedTodayToDailyMetrics(session.date, session.__local_day);
    } catch (e) {
      console.warn('[WorkoutPage] finalize save failed', e);
    }

    // ✅ start fresh next time
    clearActiveWorkoutSessionId();
    activeWorkoutSessionIdRef.current = getOrCreateActiveWorkoutSessionId();
    startedAtRef.current = new Date().toISOString();

    history.push('/history');
  };

  const handleNewWorkout = () => {
    setCumulativeExercises([]);
    setCurrentCalories(0);
    setShowSaunaSection(false);
    setSaunaTime('');
    setSaunaTemp('180');
    setCurrentStep(1);

    clearActiveWorkoutSessionId();
    activeWorkoutSessionIdRef.current = getOrCreateActiveWorkoutSessionId();
    startedAtRef.current = new Date().toISOString();
  };

  const handleShareWorkout = () => setShareModalOpen(true);

  const handleAcceptSuggested = workout => {
    const intent = (localStorage.getItem('training_intent') || 'general').toLowerCase();
    const enriched = (workout?.exercises || []).map(ex => {
      const entry = {
        exerciseName: ex.exerciseName || ex.name || ex.exercise,
        sets: ex.sets || 3,
        reps: ex.reps || '8-12',
        tempo: ex.tempo,
        weight: ex.weight || 0
      };
      return {
        exerciseType: ex.exerciseType || '',
        muscleGroup: ex.muscleGroup || '',
        exerciseName: entry.exerciseName,
        weight: entry.weight,
        sets: entry.sets,
        reps: entry.reps,
        concentricTime: ex.concentricTime,
        eccentricTime: ex.eccentricTime,
        calories: calcExerciseCaloriesHybrid(
          entry,
          { weight: userData?.weight },
          { MET_VALUES, EXERCISE_ROM },
          intent
        )
      };
    });
    setCumulativeExercises(enriched);
  };

  // ✅ Identity-aware AI call prevents false 402 for trial/Pro
  const handleSuggestAIClick = async () => {
    if (!showSuggestCard) {
      if (!isProUser() && !canUseDailyFeature('ai_workout')) {
        setShowUpgrade(true);
        return;
      }
      try {
        const trainingIntent = localStorage.getItem('training_intent') || 'general';
        const fitnessGoal = localStorage.getItem('fitness_goal') || (userData?.goalType || 'maintenance');
        const equipmentList = JSON.parse(localStorage.getItem('equipment_list') || '["dumbbell","barbell","machine","bodyweight"]');

        await callAIGenerate({
          feature: 'workout',
          user_id: user?.id || null,
          goal: fitnessGoal,
          focus: localStorage.getItem('last_focus') || 'upper',
          equipment: equipmentList,
          constraints: { training_intent: trainingIntent },
          count: 1
        });
      } catch (e) {
        if (e?.code === 402) {
          setShowUpgrade(true);
          return;
        }
        console.warn('[WorkoutPage] AI gateway probe failed; continuing with local UI', e);
      }
      if (!isProUser()) registerDailyFeatureUse('ai_workout');
      setShowSuggestCard(true);
      return;
    }
    setShowSuggestCard(false);
  };

  // ---- derived UI stats for a compact strip ----
  const sessionTotals = useMemo(() => {
    const total = cumulativeExercises.reduce((s, ex) => s + (Number(ex.calories) || 0), 0);
    const sets = cumulativeExercises.reduce((s, ex) => s + (parseInt(ex.sets, 10) || 0), 0);
    return {
      kcal: Math.round(total),
      exercises: cumulativeExercises.length,
      sets
    };
  }, [cumulativeExercises]);

  // --- summary step UI ---
  if (currentStep === 3) {
    const total = cumulativeExercises.reduce((sum, ex) => sum + (Number(ex.calories) || 0), 0);
    const shareText = `I just logged a workout on ${new Date().toLocaleDateString(
      'en-US'
    )} with Slimcal.ai: ${cumulativeExercises.length} items, ${total.toFixed(2)} cals! #SlimcalAI`;

    return (
      <Container maxWidth="md" sx={{ py: { xs: 3, md: 4 } }}>
        <Typography variant="h4" align="center" gutterBottom sx={{ fontWeight: 800 }}>
          Workout Summary
        </Typography>
        <Divider sx={{ my: 2.5 }} />

        {cumulativeExercises.map((ex, idx) => (
          <Card
            key={idx}
            variant="outlined"
            sx={{
              mb: 1.25,
              borderRadius: 2,
              border: '1px solid rgba(0,0,0,0.06)',
              boxShadow: '0 6px 18px rgba(0,0,0,0.04)'
            }}
          >
            <CardContent
              sx={{
                py: 1.1,
                px: 2,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 2
              }}
            >
              <Typography variant="body1" sx={{ fontWeight: 600 }}>
                {formatExerciseLine(ex)}
              </Typography>
              <Button size="small" color="error" onClick={() => handleRemoveExercise(idx)}>
                Remove
              </Button>
            </CardContent>
          </Card>
        ))}

        <Stack direction="row" spacing={1.25} justifyContent="center" sx={{ mt: 2 }}>
          <Chip label={`Total: ${total.toFixed(0)} kcal`} color="primary" />
          <Chip label={`${cumulativeExercises.length} exercises`} variant="outlined" />
          <Chip label={`${sessionTotals.sets} sets`} variant="outlined" />
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center" sx={{ mt: 3 }}>
          <Button variant="contained" onClick={handleNewWorkout} fullWidth>
            New Session
          </Button>
          <Button variant="contained" onClick={handleShareWorkout} fullWidth>
            Share
          </Button>
          <Button variant="contained" onClick={handleFinish} fullWidth>
            Submit Workout
          </Button>
        </Stack>

        <ShareWorkoutModal
          open={shareModalOpen}
          onClose={() => setShareModalOpen(false)}
          shareText={shareText}
          shareUrl={window.location.href}
        />

        {/* Help dialogs */}
        <Dialog
          open={showBackHelp}
          onClose={() =>
            handleDismiss('hasSeenBackHelp', setShowBackHelp, () => setCurrentStep(1))
          }
        >
          <DialogTitle>Go Back</DialogTitle>
          <DialogContent>Returns you to edit your inputs.</DialogContent>
          <DialogActions>
            <Button
              onClick={() =>
                handleDismiss('hasSeenBackHelp', setShowBackHelp, () => setCurrentStep(1))
              }
            >
              Got it
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={showLogHelp}
          onClose={() => handleDismiss('hasSeenLogHelp', setShowLogHelp, handleFinish)}
        >
          <DialogTitle>Submit Workout</DialogTitle>
          <DialogContent>Sends you to history. Your workout is already saved.</DialogContent>
          <DialogActions>
            <Button onClick={() => handleDismiss('hasSeenLogHelp', setShowLogHelp, handleFinish)}>
              Got it
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={showShareHelp}
          onClose={() =>
            handleDismiss('hasSeenShareHelp', setShowShareHelp, handleShareWorkout)
          }
        >
          <DialogTitle>Share Workout</DialogTitle>
          <DialogContent>Copy your summary to share.</DialogContent>
          <DialogActions>
            <Button
              onClick={() =>
                handleDismiss('hasSeenShareHelp', setShowShareHelp, handleShareWorkout)
              }
            >
              Got it
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={showNewHelp}
          onClose={() => handleDismiss('hasSeenNewHelp', setShowNewHelp, handleNewWorkout)}
        >
          <DialogTitle>Start New Workout</DialogTitle>
          <DialogContent>Clears this session for a fresh start.</DialogContent>
          <DialogActions>
            <Button
              onClick={() =>
                handleDismiss('hasSeenNewHelp', setShowNewHelp, handleNewWorkout)
              }
            >
              Got it
            </Button>
          </DialogActions>
        </Dialog>
      </Container>
    );
  }

  // --- main UI ---
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 4 } }}>
      <Typography variant="h4" align="center" gutterBottom sx={{ fontWeight: 800 }}>
        Workout Tracker
      </Typography>

      {/* Slim session stats strip */}
      <Box
        sx={{
          mb: 2.5,
          display: 'flex',
          justifyContent: 'center',
          gap: 1,
          flexWrap: 'wrap'
        }}
      >
        <Chip color="primary" label={`${sessionTotals.kcal} kcal`} sx={{ fontWeight: 700 }} />
        <Chip variant="outlined" label={`${sessionTotals.exercises} exercises`} />
        <Chip variant="outlined" label={`${sessionTotals.sets} sets`} />
      </Box>

      <Grid container spacing={{ xs: 3, md: 4 }}>
        <Grid item xs={12} md={4}>
          <Stack spacing={2}>
            <Box>
              {!isProUser() && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                  <FeatureUseBadge featureKey="ai_workout" isPro={false} />
                </Box>
              )}
              <Button
                variant="contained"
                fullWidth
                onClick={handleSuggestAIClick}
                sx={{ fontWeight: 700 }}
              >
                Suggest a Workout (AI)
              </Button>
            </Box>

            {showSuggestCard && (
              <SuggestedWorkoutCard userData={userData} onAccept={handleAcceptSuggested} />
            )}

            <Card
              variant="outlined"
              sx={{
                borderRadius: 2,
                border: '1px solid rgba(0,0,0,0.06)',
                boxShadow: '0 6px 18px rgba(0,0,0,0.04)'
              }}
            >
              <CardContent>
                <Button fullWidth variant="outlined" onClick={() => setShowTemplate(true)}>
                  Load Past Workout
                </Button>
                <Typography variant="body2" color="textSecondary" align="center" sx={{ mt: 1.25 }}>
                  Welcome! You are {userData?.age} years old and weigh {userData?.weight} lbs.
                </Typography>
              </CardContent>
            </Card>
          </Stack>
        </Grid>

        <Grid item xs={12} md={8}>
          <Stack spacing={3}>
            {cumulativeExercises.length > 0 && (
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  borderRadius: 2,
                  border: '1px solid rgba(0,0,0,0.06)',
                  boxShadow: '0 6px 18px rgba(0,0,0,0.04)'
                }}
              >
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 800 }}>
                  Current Session Logs
                </Typography>
                {cumulativeExercises.map((ex, idx) => (
                  <Box
                    key={idx}
                    sx={{
                      mb: 1,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 2
                    }}
                  >
                    <Typography sx={{ fontWeight: 600 }}>
                      {formatExerciseLine(ex)}
                    </Typography>
                    <Button size="small" color="error" onClick={() => handleRemoveExercise(idx)}>
                      Remove
                    </Button>
                  </Box>
                ))}
              </Paper>
            )}

            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 2,
                border: '1px solid rgba(0,0,0,0.06)',
                boxShadow: '0 6px 18px rgba(0,0,0,0.04)'
              }}
            >
              <ExerciseForm
                newExercise={newExercise}
                setNewExercise={setNewExercise}
                currentCalories={currentCalories}
                onCalculate={handleCalculate}
                onAddExercise={handleAddExercise}
                onDoneWithExercises={handleDoneWithExercises}
                exerciseOptions={exerciseOptions}
              />
            </Paper>

            <Box textAlign="center">
              <Button
                variant="contained"
                onClick={() => setShowSaunaSection(s => !s)}
              >
                {showSaunaSection ? 'Cancel Sauna Session' : 'Add Sauna Session'}
              </Button>
            </Box>

            {showSaunaSection && (
              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  borderRadius: 2,
                  border: '1px solid rgba(0,0,0,0.06)',
                  boxShadow: '0 6px 18px rgba(0,0,0,0.04)'
                }}
              >
                <SaunaForm
                  saunaTime={saunaTime}
                  saunaTemp={saunaTemp}
                  setSaunaTime={setSaunaTime}
                  setSaunaTemp={setSaunaTemp}
                />
                <Box sx={{ display: 'flex', gap: 2, mt: 2, justifyContent: 'center' }}>
                  <Button variant="contained" onClick={handleSaveSauna}>
                    Save Sauna
                  </Button>
                  <Button variant="contained" onClick={handleCancelSaunaForm}>
                    Cancel
                  </Button>
                </Box>
              </Paper>
            )}
          </Stack>
        </Grid>
      </Grid>

      {/* ✅ Meals-style: show today's logged workouts on-page so banner stays consistent */}
      <Paper
        variant="outlined"
        sx={{
          mt: 3,
          p: 2,
          borderRadius: 2,
          border: '1px solid rgba(0,0,0,0.06)',
          boxShadow: '0 6px 18px rgba(0,0,0,0.04)'
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Today’s Logged Workouts
          </Typography>
          {loadingTodaySessions && (
            <Typography variant="caption" color="textSecondary">
              Syncing…
            </Typography>
          )}
        </Stack>

        {(!todaySessions || todaySessions.length === 0) ? (
          <Typography variant="body2" color="textSecondary">
            No workouts logged today yet.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {todaySessions.map((sess, idx) => {
              const kcals = Math.round(safeNum(sess?.totalCalories ?? sess?.total_calories, 0));
              const exs = Array.isArray(sess?.exercises) ? sess.exercises : [];
              const hasDetails = exs.length > 0;
              const title =
                (hasDetails && exs.length === 1)
                  ? String(exs[0].name || exs[0].exerciseName || 'Workout')
                  : (sess?.name || 'Workout');

              const detailsLine = hasDetails
                ? exs
                    .slice(0, 3)
                    .map(e => {
                      const name = String(e?.name || e?.exerciseName || 'Exercise').trim();
                      const sets = parseInt(e?.sets ?? 0, 10) || 0;
                      const reps = parseInt(e?.reps ?? 0, 10) || 0;
                      const wt = Math.round(Number(e?.weight || 0));
                      const c = Math.round(Number(e?.calories || 0));
                      const parts = [];
                      if (sets > 0) parts.push(`${sets} sets`);
                      if (reps > 0) parts.push(`${reps} reps`);
                      if (wt > 0) parts.push(`${wt} lb max`);
                      if (c > 0) parts.push(`${c} kcal`);
                      return `${name}${parts.length ? ` • ${parts.join(' • ')}` : ''}`;
                    })
                    .join(' | ')
                : '';

              return (
                <Card
                  key={sess?.client_id || sess?.id || idx}
                  variant="outlined"
                  sx={{ borderRadius: 2, border: '1px solid rgba(0,0,0,0.06)' }}
                >
                  <CardContent sx={{ py: 1.25, px: 2 }}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ gap: 2 }}>
                      <Typography sx={{ fontWeight: 700 }}>{title}</Typography>
                      <Chip label={`${kcals} kcal`} color="primary" />
                    </Stack>
                    {hasDetails ? (
                      <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 0.5 }}>
                        {detailsLine || 'No details yet.'}
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 0.5 }}>
                        Details syncing…
                      </Typography>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        )}
      </Paper>

      <Box textAlign="center" sx={{ mt: 4 }}>
        <Button
          variant="contained"
          size="large"
          fullWidth
          onClick={handleFinish}
        >
          SUBMIT WORKOUT
        </Button>
      </Box>

      <TemplateSelector
        open={showTemplate}
        onClose={() => setShowTemplate(false)}
        onLoadTemplate={handleLoadTemplate}
      />

      <ShareWorkoutModal
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        shareText={`I just logged a workout on ${new Date().toLocaleDateString(
          'en-US'
        )} with Slimcal.ai: ${cumulativeExercises.length} items, ${cumulativeExercises
          .reduce((sum, ex) => sum + (Number(ex.calories) || 0), 0)
          .toFixed(2)} cals! #SlimcalAI`}
        shareUrl={window.location.href}
      />

      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        title="Upgrade to Slimcal Pro"
        description="Unlock unlimited AI workout recommendations, AI meal suggestions, the Daily Recap Coach, and advanced insights."
      />
    </Container>
  );
}