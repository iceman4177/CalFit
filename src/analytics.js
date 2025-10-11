// src/analytics.js
import ReactGA from 'react-ga4';

// Replace 'G-XXXXXXXXXX' with your actual GA4 Measurement ID
export function initGA() {
  ReactGA.initialize('G-0PBM0SW18X');
}

// Log a page view event to GA4
export function logPageView(page) {
  ReactGA.send({ hitType: 'pageview', page });
}

/* ----------------------------- WORKOUT PAGE ----------------------------- */
import React, { useState, useEffect } from 'react';
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
  Stack
} from '@mui/material';
import { useHistory } from 'react-router-dom';
import ExerciseForm from './ExerciseForm';
import SaunaForm from './SaunaForm';
import ShareWorkoutModal from './ShareWorkoutModal';
import TemplateSelector from './TemplateSelector';
import { MET_VALUES } from './exerciseMeta';
import { EXERCISE_ROM, G, EFFICIENCY } from './exerciseConstants';
import { updateStreak } from './utils/streak';
import SuggestedWorkoutCard from './components/SuggestedWorkoutCard';
import UpgradeModal from './components/UpgradeModal';

// ✅ NEW: auth + db
import { useAuth } from './context/AuthProvider.jsx';
import { saveWorkout, upsertDailyMetrics } from './lib/db';

// ---- Paywall helpers (localStorage-based until backend arrives) ----
const isProUser = () => {
  if (localStorage.getItem('isPro') === 'true') return true;
  const ud = JSON.parse(localStorage.getItem('userData') || '{}');
  return !!ud.isPremium;
};

const getAICount = () =>
  parseInt(localStorage.getItem('aiWorkoutCount') || '0', 10);

const incAICount = () =>
  localStorage.setItem('aiWorkoutCount', String(getAICount() + 1));

/* --------------------------- Hybrid Calc Helpers --------------------------- */
/**
 * Proprietary Hybrid “Mechanical + Physiological” Calorie‐burn:
 * total_kcal = MET_kcal + Mechanical_kcal
 * MET_kcal = MET * bodyKg * activeMinutes
 * Mechanical_kcal = (m(kg) * g * ROM(m) * reps*sets) / (4184 * EFFICIENCY)
 * Tempo-aware active time; intent-aware defaults & MET scaling.
 */

// Intent → default tempo [concentric, isometric, eccentric] and small MET bias
const INTENT_PROFILES = {
  bodybuilder:   { defaultTempo: [2, 1, 3], metFactor: 1.00 }, // slower eccentrics for hypertrophy
  powerlifter:   { defaultTempo: [1, 0, 2], metFactor: 1.05 }, // brief reps, higher peak effort/bracing
  endurance:     { defaultTempo: [2, 1, 2], metFactor: 1.10 }, // more sustained metabolic demand
  yoga_pilates:  { defaultTempo: [3, 1, 3], metFactor: 0.90 }, // lower global intensity
  general:       { defaultTempo: [2, 1, 2], metFactor: 1.00 },
};

function getIntentProfile(intent) {
  const key = String(intent || 'general').toLowerCase();
  return INTENT_PROFILES[key] || INTENT_PROFILES.general;
}

// Parse "8-12" → 12; "10" → 10
function parseReps(reps) {
  if (typeof reps === 'string' && reps.includes('-')) {
    const [a, b] = reps.split('-').map((x) => parseInt(x, 10));
    return Number.isFinite(b) ? b : (Number.isFinite(a) ? a : 0);
  }
  const n = parseInt(reps, 10);
  return Number.isFinite(n) ? n : 0;
}

// Parse tempo with intent-aware fallback
function parseTempoSeconds(tempo, conc, ecc, intentProfile) {
  // If an explicit tempo string exists (e.g., "2-1-2"), respect it.
  if (tempo && typeof tempo === 'string') {
    const parts = tempo.split(/[-–—x]/).map(s => parseFloat(s) || 0);
    if (parts.length === 3) {
      const [c, i, e] = parts;
      const sum = c + i + e;
      if (sum > 0) return sum;
    }
  }

  // Otherwise, build from provided phases or intent defaults
  const prof = intentProfile || INTENT_PROFILES.general;
  const c = Number(conc);
  const e = Number(ecc);
  const [dc, di, de] = prof.defaultTempo;

  const C = Number.isFinite(c) && c > 0 ? c : dc;
  const E = Number.isFinite(e) && e > 0 ? e : de;
  const I = di;

  return C + I + E; // seconds per rep
}

// Fuzzy MET lookup so different lifts get different intensities
function metForExercise(name) {
  if (!name) return MET_VALUES?.default ?? 6.0;
  if (MET_VALUES?.[name]) return MET_VALUES[name];

  const n = String(name).toLowerCase();
  const tokenMap = [
    [/deadlift/, 7.0],
    [/squat|front squat|back squat/, 6.5],
    [/bench|incline/, 6.0],
    [/overhead press|shoulder press|press\b/, 6.0],
    [/row(?!ing)|seated row|barbell row/, 5.5],
    [/pulldown|pull-down|lat pull/, 5.5],
    [/fly|cable fly/, 5.5],
    [/lunge|split squat/, 6.0],
    [/curl/, 5.0],
    [/triceps|pressdown|extension/, 5.0],
    [/lateral raise/, 5.0],
    [/kettlebell|swing/, 6.5],
    [/rowing machine|rower/, 7.0],
    [/bike|cycling/, 7.0],
    [/jump rope/, 11.8],
    [/plank|core/, 3.0],
    [/yoga|pilates/, 3.0],
    [/push-up|push up/, 4.0],
    [/pull-up|pull up/, 5.0],
  ];

  for (const [re, val] of tokenMap) {
    if (re.test(n)) return val;
  }
  return MET_VALUES?.default ?? 6.0;
}

/** Primary calculator: Hybrid MET + Mechanical Work (intent-aware)
 * entry: { exerciseName|name|exercise, sets, reps, tempo?, concentricTime?, eccentricTime?, weight }
 * user:  { weight (lbs) }
 * tables: { MET_VALUES, EXERCISE_ROM }
 * intent: 'bodybuilder' | 'powerlifter' | 'endurance' | 'yoga_pilates' | 'general'
 */
function calcExerciseCaloriesHybrid(entry, user, tables, intent = 'general') {
  const { MET_VALUES: _MET, EXERCISE_ROM: _ROM } = tables || {};
  const profile = getIntentProfile(intent);

  const bodyLbs = Number(user?.weight) || Number(user?.weight_lbs) || 0;
  const bodyKg  = bodyLbs > 0 ? bodyLbs * 0.453592 : 80; // default 80 kg
  const sets    = parseInt(entry?.sets,10) || 1;
  const reps    = parseReps(entry?.reps);

  // Intent-aware tempo fallback if none explicitly set
  const tempoS  = parseTempoSeconds(
    entry?.tempo,
    entry?.concentricTime,
    entry?.eccentricTime,
    profile
  );

  // 1) MET component with intent factor
  const baseMet = metForExercise(entry?.exerciseName || entry?.name || entry?.exercise);
  const met     = baseMet * profile.metFactor;
  const activeMin = (sets * reps * tempoS) / 60;
  const metCals = met * bodyKg * activeMin;            // (kcal)

  // 2) Mechanical-work component (physics-based)
  const loadKg  = (Number(entry?.weight) || 0) * 0.453592;
  const rom     = _ROM?.[entry?.exerciseName] ?? _ROM?.[entry?.name] ?? 0.5; // meters
  const workJ   = loadKg * G * rom * (sets * reps);    // Joules
  const mechCals= workJ / (4184 * EFFICIENCY);         // kcal

  const total   = metCals + mechCals;
  return Number.isFinite(total) && total > 0 ? total : 0;
}

/* ------------------------------ Component ------------------------------ */

export default function WorkoutPage({ userData, onWorkoutLogged }) {
  const history = useHistory();
  const { user } = useAuth();   // ✅ who is signed in (if any)

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
  const [showBackHelp, setShowBackHelp] = useState(false);
  const [showLogHelp, setShowLogHelp] = useState(false);
  const [showShareHelp, setShowShareHelp] = useState(false);
  const [showNewHelp, setShowNewHelp] = useState(false);

  // NEW: paywall modal state
  const [showUpgrade, setShowUpgrade] = useState(false);

  const handleDismiss = (key, setter, cb) => {
    localStorage.setItem(key, 'true');
    setter(false);
    if (cb) cb();
  };

  const handleLoadTemplate = exercises => {
    setCumulativeExercises(
      exercises.map(ex => ({
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

  // Updated per-exercise calculation (intent-aware)
  const calculateCalories = () => {
    if (!newExercise.exerciseName && newExercise.exerciseType !== 'cardio') {
      setCurrentCalories(0);
      return 0;
    }

    const entry = {
      exerciseName: newExercise.exerciseName || newExercise.exerciseType,
      sets: newExercise.sets,
      reps: newExercise.reps,
      // if user entered separate times, hybrid helper will combine; otherwise tempo string ok
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
      setCumulativeExercises([
        ...cumulativeExercises,
        { exerciseType: 'cardio', exerciseName: newExercise.cardioType || 'Cardio', calories: cal }
      ]);
      setNewExercise({ ...newExercise, cardioType: '', manualCalories: '' });
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
    setCumulativeExercises([...cumulativeExercises, { ...newExercise, calories: cals }]);
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
    const arr = [...cumulativeExercises];
    arr.splice(idx, 1);
    setCumulativeExercises(arr);
  };

  const handleSaveSauna = () => {
    if (saunaTime.trim()) {
      const t = parseFloat(saunaTime) || 0;
      const tmp = parseFloat(saunaTemp) || 180;
      const uw = parseFloat(userData.weight) || 150;
      const saunaCals = t * (tmp - 150) * 0.1 * (uw / 150);
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

  const handleFinish = async () => {
    const total = cumulativeExercises.reduce((sum, ex) => sum + ex.calories, 0);
    const newSession = {
      date: new Date().toLocaleDateString('en-US'),
      totalCalories: total,
      exercises: cumulativeExercises.map(ex => ({
        name: ex.exerciseName,
        sets: ex.sets,
        reps: ex.reps,
        calories: ex.calories
      }))
    };
    const existing = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    existing.push(newSession);
    localStorage.setItem('workoutHistory', JSON.stringify(existing));
    onWorkoutLogged(total);
    updateStreak();

    // ✅ Cloud write-through (if logged in)
    try {
      if (user?.id) {
        const nowISO = new Date().toISOString();
        await saveWorkout(
          user.id,
          { started_at: nowISO, ended_at: nowISO, goal: null, notes: null },
          (newSession.exercises || []).map(s => ({
            exercise_name: s.name,
            equipment: null,
            muscle_group: null,
            weight: null,
            reps: s.reps || null,
            tempo: null,
            volume: (s.reps || 0) * (s.sets || 0),
          }))
        );
        const day = new Date().toISOString().slice(0,10);
        await upsertDailyMetrics(user.id, day, total || 0, 0);
      }
    } catch (err) {
      console.error('[WorkoutPage] cloud save failed', err);
    }

    history.push('/history');
  };

  const handleNewWorkout = () => {
    setCumulativeExercises([]);
    setCurrentCalories(0);
    setShowSaunaSection(false);
    setSaunaTime('');
    setSaunaTemp('180');
    setCurrentStep(1);
  };

  const handleShareWorkout = () => setShareModalOpen(true);

  // ✅ Use the improved hybrid calc for AI-accepted workouts too (intent-aware)
  const handleAcceptSuggested = workout => {
    const intent = (localStorage.getItem('training_intent') || 'general').toLowerCase();
    const enriched = workout.exercises.map(ex => {
      const entry = {
        exerciseName: ex.exerciseName || ex.name || ex.exercise,
        sets: ex.sets || 3,
        reps: ex.reps || '8-12',
        tempo: ex.tempo, // if AI provided; helper will fallback to intent defaults otherwise
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

  // ---- PRO GATE: Suggest Workout (AI) button ----
  const handleSuggestAIClick = async () => {
    if (!showSuggestCard) {
      // client-side free cap
      if (!isProUser()) {
        const used = getAICount();
        if (used >= 3) {
          setShowUpgrade(true);
          return;
        }
      }

      // ✅ Server probe — if the gateway returns 402, show upgrade
      try {
        const trainingIntent = localStorage.getItem('training_intent') || 'general';
        const fitnessGoal    = localStorage.getItem('fitness_goal') || (userData?.goalType || 'maintenance');
        const equipmentList  = JSON.parse(localStorage.getItem('equipment_list') || '["dumbbell","barbell","machine","bodyweight"]');

        const resp = await fetch('/api/ai/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            feature: 'workout',
            user_id: user?.id || null,    // null → server will gate
            goal: fitnessGoal,
            focus: localStorage.getItem('last_focus') || 'upper',
            equipment: equipmentList,
            constraints: { training_intent: trainingIntent },
            count: 1 // probe only; the card fetches a full pack
          })
        });

        if (resp.status === 402) {
          setShowUpgrade(true);
          return;
        }
      } catch (e) {
        console.warn('[WorkoutPage] AI gateway probe failed; continuing with local UI', e);
      }

      if (!isProUser()) incAICount();
      setShowSuggestCard(true);
      return;
    }
    setShowSuggestCard(false);
  };

  if (currentStep === 3) {
    const total = cumulativeExercises.reduce((sum, ex) => sum + ex.calories, 0);
    const shareText = `I just logged a workout on ${new Date().toLocaleDateString(
      'en-US'
    )} with Slimcal.ai: ${cumulativeExercises.length} items, ${total.toFixed(2)} cals! #SlimcalAI`;

    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Typography variant="h2" align="center" gutterBottom>
          Workout Summary
        </Typography>
        <Divider sx={{ my: 3 }} />
        {cumulativeExercises.map((ex, idx) => (
          <Box
            key={idx}
            sx={{
              mb: 2,
              p: 1,
              border: '1px solid #eee',
              borderRadius: 1,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <Typography variant="body1">
              {ex.exerciseName} – {ex.calories.toFixed(2)} cals
            </Typography>
            <Button size="small" color="error" onClick={() => handleRemoveExercise(idx)}>
              Remove
            </Button>
          </Box>
        ))}
        <Typography variant="h5" align="center" sx={{ mt: 2 }}>
          Total Calories Burned: {total.toFixed(2)}
        </Typography>
        <Stack direction="row" spacing={2} justifyContent="center" sx={{ mt: 3 }}>
          <Button variant="contained" onClick={handleNewWorkout}>
            New Session
          </Button>
          <Button variant="contained" onClick={handleShareWorkout}>
            Share
          </Button>
          <Button variant="contained" onClick={handleFinish}>
            Log Workout
          </Button>
        </Stack>
        <ShareWorkoutModal
          open={shareModalOpen}
          onClose={() => setShareModalOpen(false)}
          shareText={shareText}
          shareUrl={window.location.href}
        />
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
          <DialogTitle>Log Workout</DialogTitle>
          <DialogContent>Saves your session to history.</DialogContent>
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

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h2" align="center" gutterBottom>
        Workout Tracker
      </Typography>
      <Grid container spacing={4}>
        <Grid item xs={12} md={4}>
          <Stack spacing={2}>
            <Button
              variant="contained"
              fullWidth
              onClick={handleSuggestAIClick}
            >
              Suggest a Workout (AI)
            </Button>
            {showSuggestCard && (
              <SuggestedWorkoutCard userData={userData} onAccept={handleAcceptSuggested} />
            )}
            <Card variant="outlined">
              <CardContent>
                <Button fullWidth variant="outlined" onClick={() => setShowTemplate(true)}>
                  Load Past Workout
                </Button>
                <Typography variant="body2" color="textSecondary" align="center" sx={{ mt: 1 }}>
                  Welcome! You are {userData?.age} years old and weigh {userData?.weight} lbs.
                </Typography>
              </CardContent>
            </Card>
          </Stack>
        </Grid>
        <Grid item xs={12} md={8}>
          <Stack spacing={3}>
            {cumulativeExercises.length > 0 && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="h6" gutterBottom>
                  Current Session Logs
                </Typography>
                {cumulativeExercises.map((ex, idx) => (
                  <Box
                    key={idx}
                    sx={{
                      mb: 1,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <Typography>
                      {ex.exerciseName} – {ex.calories.toFixed(2)} cals
                    </Typography>
                    <Button size="small" color="error" onClick={() => handleRemoveExercise(idx)}>
                      Remove
                    </Button>
                  </Box>
                ))}
              </Paper>
            )}
            <Paper variant="outlined" sx={{ p: 2 }}>
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
              <Paper variant="outlined" sx={{ p: 2 }}>
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
          FINISH WORKOUT
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
          .reduce((sum, ex) => sum + ex.calories, 0)
          .toFixed(2)} cals! #SlimcalAI`}
        shareUrl={window.location.href}
      />

      {/* Paywall modal shown after free cap */}
      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        title="Upgrade to Slimcal Pro"
        description="Unlock unlimited AI workout recommendations, AI meal suggestions, the Daily Recap Coach, and advanced insights."
      />
    </Container>
  );
}
