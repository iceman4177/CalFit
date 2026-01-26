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
import { saveWorkout as saveWorkoutDb } from './lib/db';
import { calcExerciseCaloriesHybrid } from './analytics';
import { callAIGenerate } from './lib/ai'; // ✅ identity-aware AI helper

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


// ---- Draft persistence (prevents losing exercises on tab switch/refresh) -----
function draftStorageKey(sessionId) {
  return `slimcal:workoutDraft:${sessionId}`;
}
function readDraftSession(sessionId) {
  try {
    const raw = localStorage.getItem(draftStorageKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}
function writeDraftSession(sessionId, session) {
  try {
    localStorage.setItem(draftStorageKey(sessionId), JSON.stringify(session));
  } catch { }
}
function clearDraftSession(sessionId) {
  try {
    localStorage.removeItem(draftStorageKey(sessionId));
  } catch { }
}

// ---- Local workoutHistory upsert (banner + history rely on this) -------------
function upsertWorkoutHistorySession(session, { draft = true } = {}) {
  try {
    const key = 'workoutHistory';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    const list = Array.isArray(arr) ? arr : [];

    const sid = session?.client_id || session?.id;
    if (!sid) return;

    const total = Number(session?.total_calories ?? session?.totalCalories ?? 0) || 0;

    const row = {
      // canonical
      id: sid,
      client_id: sid,
      date: session?.date || new Date(session?.started_at || Date.now()).toLocaleDateString('en-US'),
      totalCalories: total,
      total_calories: total,
      exercises: Array.isArray(session?.exercises) ? session.exercises : [],
      // metadata
      uploaded: !!session?.uploaded,
      createdAt: session?.started_at || session?.createdAt || new Date().toISOString(),
      __draft: !!draft
    };

    const next = [row, ...list.filter(w => (w?.id || w?.client_id) !== sid)];
    localStorage.setItem(key, JSON.stringify(next.slice(0, 250)));
  } catch { }
}

function removeWorkoutHistorySession(sessionId) {
  try {
    const key = 'workoutHistory';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    const list = Array.isArray(arr) ? arr : [];
    const next = list.filter(w => (w?.id || w?.client_id) !== sessionId);
    localStorage.setItem(key, JSON.stringify(next));
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

  // ✅ stable draft id ref for this workout session
  const activeWorkoutSessionIdRef = useRef(getOrCreateActiveWorkoutSessionId());

  // ✅ stable "started_at" so autosaves don't constantly rewrite it
  const startedAtRef = useRef(new Date().toISOString());

  // ✅ debounce autosave timer
  const autosaveTimerRef = useRef(null);

  // ✅ Rehydrate draft exercises if the user navigates away / refreshes mid-workout
  useEffect(() => {
    try {
      const sid = activeWorkoutSessionIdRef.current;
      const draft = readDraftSession(sid);
      if (!draft) return;

      // Only restore drafts from today (prevents stale drafts)
      const todayIso = localDayISO(new Date());
      const draftDay = draft?.__local_day || draft?.local_day || null;
      if (draftDay && draftDay !== todayIso) {
        clearDraftSession(sid);
        removeWorkoutHistorySession(sid);
        return;
      }

      const ex = Array.isArray(draft?.exercises) ? draft.exercises : [];
      if (ex.length > 0) {
        setCumulativeExercises(ex.map(e => ({
          exerciseType: e.exerciseType || '',
          cardioType: e.cardioType || '',
          manualCalories: e.manualCalories || '',
          muscleGroup: e.muscleGroup || '',
          exerciseName: e.exerciseName || e.name || '',
          weight: e.weight ?? '',
          sets: e.sets ?? '',
          reps: e.reps ?? '',
          concentricTime: e.concentricTime || '',
          eccentricTime: e.eccentricTime || '',
          calories: Number(e.calories) || 0
        })));

        const totalRaw = ex.reduce((s, e) => s + (Number(e.calories) || 0), 0);
        setCurrentCalories(Math.round(totalRaw * 100) / 100);

        if (draft?.started_at) {
          startedAtRef.current = draft.started_at;
        }
      }
    } catch { }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


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
      setCumulativeExercises(prev => ([
        ...prev,
        { exerciseType: 'cardio', exerciseName: newExercise.cardioType || 'Cardio', calories: cal }
      ]));
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
    setCumulativeExercises(prev => ([...prev, { ...newExercise, calories: cals }]));

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
    setCumulativeExercises(prev => {
      const arr = [...prev];
      arr.splice(idx, 1);
      return arr;
    });
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

      setCumulativeExercises(exs => [
        ...exs.filter(e => e.exerciseType !== 'Sauna'),
        { exerciseType: 'Sauna', exerciseName: 'Sauna Session', calories: saunaCals }
      ]);
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
    // If user removed everything, remove the draft workout so history isn't polluted
    if (!Array.isArray(cumulativeExercises) || cumulativeExercises.length === 0) {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;

      // best-effort: delete draft workout from cloud (if signed in)
      (async () => {
        try {
          const cid = activeWorkoutSessionIdRef.current;
          const userId = user?.id || null;
          if (cid && userId) {
            await deleteWorkoutLocalFirst({ user_id: userId, client_id: cid });
          }
        } catch { }
      })();

      // ✅ Clear local draft + local workoutHistory entry so banner doesn't drift
      try {
        const sid = activeWorkoutSessionIdRef.current;
        clearDraftSession(sid);
        removeWorkoutHistorySession(sid);
      } catch { }

      return;
    }

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);

    autosaveTimerRef.current = setTimeout(async () => {
      try {
        const session = buildDraftWorkoutSession();

        // ✅ Persist draft locally (prevents disappearing exercises)
        writeDraftSession(activeWorkoutSessionIdRef.current, session);

        // ✅ Keep local workoutHistory updated so banner + history match instantly
        upsertWorkoutHistorySession(session, { draft: true });

        // ✅ Cloud upsert is idempotent, but DO NOT stack daily calories on draft saves
        await saveWorkoutLocalFirst({ ...session, skipDailyMetricsUpdate: true });

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

      // ✅ Finalize local workoutHistory row (not a draft)
      upsertWorkoutHistorySession(session, { draft: false });
      clearDraftSession(activeWorkoutSessionIdRef.current);

      // ✅ Cloud upsert (idempotent) — don't stack daily calories here
      await saveWorkoutLocalFirst({ ...session, skipDailyMetricsUpdate: true });

      // ✅ Write workout sets once so history has real exercise names across devices
      try {
        const already = localStorage.getItem(`slimcal:workoutSetsSaved:${session.client_id}`);
        if (!already && user?.id) {
          const sets = (session.exercises || []).map((e) => ({
            exercise_name: e.name || e.exerciseName || 'Exercise',
            weight: e.weight ?? null,
            reps: e.reps ?? null,
            equipment: null,
            muscle_group: null,
            tempo: e.tempo ?? null,
            volume: null,
          }));

          await saveWorkoutDb(user.id, {
            client_id: session.client_id,
            started_at: session.started_at,
            ended_at: session.ended_at,
            total_calories: session.total_calories,
            goal: null,
            notes: null,
          }, sets);

          localStorage.setItem(`slimcal:workoutSetsSaved:${session.client_id}`, 'true');
        }
      } catch (e) {
        console.warn('[WorkoutPage] saveWorkoutDb (sets) failed', e);
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
    // ✅ wipe current draft session + remove from history
    try {
      const sid = activeWorkoutSessionIdRef.current;
      clearDraftSession(sid);
      removeWorkoutHistorySession(sid);
    } catch { }

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