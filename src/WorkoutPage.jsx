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
import SaunaSection from './SaunaSection';
import WorkoutSummary from './WorkoutSummary';
import UpgradeModal from './components/UpgradeModal';
import ShareWorkoutModal from './ShareWorkoutModal';
import { useAuth } from './context/AuthProvider.jsx';
import { updateStreak } from './utils/streak';
import { calcExerciseCaloriesHybrid } from './analytics';
import { callAIGenerate } from './lib/ai';

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
    const ud = JSON.parse(localStorage.getItem('userData') || '{}') || {};
    const plan = String(ud?.plan_status || ud?.planStatus || '').toLowerCase();
    if (['active', 'trialing'].includes(plan)) return true;
  } catch { }
  return false;
};

function localDayISO(d = new Date()) {
  try {
    const dt = new Date(d);
    const localMidnight = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    return localMidnight.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

// ---- Stable client id per device ------------------------------------------------
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

// ✅ Stable draft workout session id (prevents duplicates + enables upsert while typing)
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

// Keep workoutHistory in sync for NetCalorieBanner + History UI.
function upsertWorkoutHistorySession(session, { draft = true } = {}) {
  try {
    const key = 'workoutHistory';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    const list = Array.isArray(arr) ? arr : [];

    const sid = session?.id || session?.client_id;
    if (!sid) return;

    const total = Number(session?.totalCalories ?? session?.total_calories ?? 0) || 0;

    const row = {
      ...session,
      id: sid,
      client_id: sid,
      totalCalories: total,
      total_calories: total,
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
    sets: '',
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

      // Only restore drafts from today (prevents yesterday lingering)
      const todayLocalIso = localDayISO(new Date());
      const draftDay = draft?.__local_day || draft?.local_day || null;
      if (draftDay && draftDay !== todayLocalIso) {
        clearDraftSession(sid);
        removeWorkoutHistorySession(sid);
        return;
      }

      const ex = draft?.draftExercises || draft?.exercises;
      if (Array.isArray(ex) && ex.length > 0) {
        const normalized = ex.map((e) => {
          if (e && typeof e === 'object') {
            if ('exerciseName' in e) return e;
            return {
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
              calories: e.calories ?? 0
            };
          }
          return e;
        });

        setCumulativeExercises(normalized);
        const totalRaw = normalized.reduce((s, e) => s + (Number(e?.calories) || 0), 0);
        setCurrentCalories(Math.round(totalRaw * 100) / 100);

        if (draft?.started_at || draft?.createdAt) {
          startedAtRef.current = draft.started_at || draft.createdAt;
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
    try { cb?.(); } catch { }
  };

  const handleBack = () => {
    setCurrentStep(1);
    setShowBackHelp(false);
  };

  const exerciseOptions = {
    cardio: ['Treadmill', 'Bike', 'Elliptical', 'Rowing Machine', 'Stair Climber'],
    machine: {
      Chest: ['Chest Press Machine', 'Cable Crossover/Functional Trainer'],
      Shoulders: ['Shoulder Press Machine'],
      Back: ['Seated Row Machine', 'Lat Pulldown Machine'],
      Legs: ['Leg Press Machine', 'Leg Extension Machine', 'Leg Curl Machine', 'Calf Raise Machine'],
      Arms: ['Bicep Curl Machine', 'Tricep Extension Machine']
    },
    freeweight: {
      Chest: ['Bench Press', 'Dumbbell Press', 'Incline Press'],
      Shoulders: ['Overhead Press', 'Dumbbell Shoulder Press', 'Lateral Raise'],
      Back: ['Deadlift', 'Bent Over Row', 'Pull-Up'],
      Legs: ['Squat', 'Lunge', 'Romanian Deadlift'],
      Arms: ['Bicep Curl', 'Tricep Extension', 'Hammer Curl']
    }
  };

  const handleAddExercise = useCallback(async () => {
    if (!newExercise.exerciseType) return;

    let calories = 0;

    // Cardio manual calories
    if (newExercise.exerciseType === 'cardio') {
      calories = parseFloat(newExercise.manualCalories) || 0;
    } else {
      // Strength formula hybrid
      calories = calcExerciseCaloriesHybrid({
        exerciseName: newExercise.exerciseName,
        weight: newExercise.weight,
        reps: newExercise.reps,
        sets: newExercise.sets,
        tempo: {
          concentric: newExercise.concentricTime,
          eccentric: newExercise.eccentricTime
        }
      });
    }

    const entry = {
      ...newExercise,
      calories: Math.round((calories || 0) * 100) / 100
    };

    setCumulativeExercises(prev => ([
      ...prev,
      entry
    ]));

    setNewExercise({
      exerciseType: '',
      cardioType: '',
      manualCalories: '',
      muscleGroup: '',
      exerciseName: '',
      weight: '',
      sets: '',
      reps: '',
      concentricTime: '',
      eccentricTime: ''
    });

    setCurrentStep(2);
  }, [newExercise]);

  const handleRemoveExercise = (index) => {
    setCumulativeExercises(prev => prev.filter((_, i) => i !== index));
  };

  const handleShowTemplate = () => setShowTemplate(true);
  const handleCloseTemplate = () => setShowTemplate(false);

  const handleShowSuggest = async () => {
    try {
      // paywall check
      if (!isProUser()) {
        setShowUpgrade(true);
        return;
      }

      setShowSuggestCard(true);

      const payload = {
        feature: 'workout',
        prompt: `Generate a workout plan template based on user preferences.`
      };

      await callAIGenerate(payload);
    } catch (e) {
      console.warn('[WorkoutPage] AI workout suggestion failed', e);
    }
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
      draftExercises: cumulativeExercises,

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

      // ✅ Also clear local draft + local workoutHistory so banner stays accurate
      try {
        const sid = activeWorkoutSessionIdRef.current;
        clearDraftSession(sid);
        removeWorkoutHistorySession(sid);
      } catch { }

      // ✅ Recompute banner totals (burned today) after clearing
      try {
        const now = new Date();
        const todayDisplay = now.toLocaleDateString('en-US');
        const todayLocalIso = localDayISO(now);
        syncBurnedTodayToDailyMetrics(todayDisplay, todayLocalIso);
      } catch { }

      return;
    }

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);

    autosaveTimerRef.current = setTimeout(async () => {
      try {
        const session = buildDraftWorkoutSession();

        // ✅ Persist draft locally so it never disappears on tab switch/refresh
        writeDraftSession(activeWorkoutSessionIdRef.current, session);

        // ✅ Keep local workoutHistory updated so banner + history match instantly
        upsertWorkoutHistorySession(session, { draft: true });

        // ✅ Optional cloud upsert (idempotent by user_id + client_id) — skip daily metrics here to prevent double counting
        await saveWorkoutLocalFirst({ ...session, skipDailyMetricsUpdate: true });

        // ✅ Recompute burned today from workoutHistory (includes the draft row we just upserted)
        await syncBurnedTodayToDailyMetrics(session.date, session.__local_day);
      } catch (e) {
        console.warn('[WorkoutPage] autosave draft failed', e);
      }
    }, 450);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [cumulativeExercises, buildDraftWorkoutSession, syncBurnedTodayToDailyMetrics, user?.id]);

  // ✅ Submit now finalizes + navigates to history
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

      // ✅ Finalize local history row (replaces draft)
      try {
        upsertWorkoutHistorySession(session, { draft: false });
        clearDraftSession(activeWorkoutSessionIdRef.current);
      } catch { }

      // ✅ Cloud upsert (idempotent) — skip daily metrics here (we recompute below to avoid double counting)
      await saveWorkoutLocalFirst({ ...session, skipDailyMetricsUpdate: true });

      try {
        updateStreak();
      } catch { }

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

    // Reset UI state for next workout
    setCumulativeExercises([]);
    setCurrentCalories(0);
    setShowSaunaSection(false);
    setSaunaTime('');
    setSaunaTemp('180');
    setCurrentStep(1);

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

  const totalCalories = useMemo(() => {
    const raw = cumulativeExercises.reduce((sum, ex) => sum + (Number(ex.calories) || 0), 0);
    return Math.round(raw * 100) / 100;
  }, [cumulativeExercises]);

  useEffect(() => {
    setCurrentCalories(totalCalories);
  }, [totalCalories]);

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <Stack spacing={2}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="h4" sx={{ fontWeight: 800 }}>
            Log Workout
          </Typography>

          <Stack direction="row" spacing={1}>
            <Chip label={`${currentCalories.toFixed(0)} cals`} />
          </Stack>
        </Stack>

        <Divider />

        {currentStep === 1 && (
          <Card sx={{ borderRadius: 3 }}>
            <CardContent>
              <ExerciseForm
                exercise={newExercise}
                setExercise={setNewExercise}
                onAdd={handleAddExercise}
                onBack={handleBack}
                exerciseOptions={exerciseOptions}
              />
              <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                <Button variant="outlined" onClick={handleShowTemplate}>
                  Templates
                </Button>
                <Button variant="outlined" onClick={handleShowSuggest}>
                  AI Suggest
                </Button>
              </Stack>
            </CardContent>
          </Card>
        )}

        {currentStep === 2 && (
          <WorkoutSummary
            exercises={cumulativeExercises}
            totalCalories={currentCalories}
            onRemove={handleRemoveExercise}
            onBack={() => setCurrentStep(1)}
          />
        )}

        <Paper sx={{ p: 2, borderRadius: 3 }}>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Actions
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={handleFinish}>
                Submit Workout
              </Button>
              <Button variant="outlined" onClick={handleNewWorkout}>
                New Workout
              </Button>
              <Button variant="outlined" onClick={handleShareWorkout}>
                Share
              </Button>
            </Stack>
          </Stack>

          <Divider sx={{ my: 2 }} />

          <SaunaSection
            showSaunaSection={showSaunaSection}
            setShowSaunaSection={setShowSaunaSection}
            saunaTime={saunaTime}
            setSaunaTime={setSaunaTime}
            saunaTemp={saunaTemp}
            setSaunaTemp={setSaunaTemp}
          />
        </Paper>
      </Stack>

      <Dialog open={showTemplate} onClose={handleCloseTemplate} fullWidth maxWidth="sm">
        <DialogTitle>Workout Templates</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Coming soon — quick add preset workouts.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseTemplate}>Close</Button>
        </DialogActions>
      </Dialog>

      <UpgradeModal open={showUpgrade} onClose={() => setShowUpgrade(false)} />

      <ShareWorkoutModal
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        workout={{
          date: new Date().toLocaleDateString('en-US'),
          totalCalories: currentCalories,
          exercises: cumulativeExercises
        }}
      />
    </Container>
  );
}
