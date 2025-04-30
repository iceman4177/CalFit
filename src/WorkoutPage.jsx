// src/WorkoutPage.jsx
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
  Box
} from '@mui/material';
import { useHistory } from 'react-router-dom';
import ExerciseForm from './ExerciseForm';
import SaunaForm from './SaunaForm';
import ShareWorkoutModal from './ShareWorkoutModal';
import { MET_VALUES } from './exerciseMeta';
import { EXERCISE_ROM, G, EFFICIENCY } from './exerciseConstants';

function WorkoutPage({ userData, onWorkoutLogged }) {
  const history = useHistory();

  // Redirect to health form if userData is missing
  useEffect(() => {
    if (!userData) {
      history.replace('/edit-info');
    }
  }, [userData, history]);

  const [currentStep, setCurrentStep] = useState(1);
  const [cumulativeExercises, setCumulativeExercises] = useState([]);
  const [cumulativeTotal, setCumulativeTotal] = useState(0);
  const [newExercise, setNewExercise] = useState({
    exerciseType: '',
    muscleGroup: '',
    exerciseName: '',
    weight: '',
    sets: '1',
    reps: ''
  });
  const [currentCalories, setCurrentCalories] = useState(0);
  const [saunaTime, setSaunaTime] = useState('');
  const [saunaTemp, setSaunaTemp] = useState('180');
  const [shareModalOpen, setShareModalOpen] = useState(false);

  // Summary-tip state (all false initially)
  const [showBackHelp, setShowBackHelp] = useState(false);
  const [showLogHelp, setShowLogHelp] = useState(false);
  const [showShareHelp, setShowShareHelp] = useState(false);
  const [showNewHelp, setShowNewHelp] = useState(false);

  const handleDismiss = (key, setter, cb) => {
    localStorage.setItem(key, 'true');
    setter(false);
    if (cb) cb();
  };

  const triggerOrHandle = (key, setter, cb) => {
    if (!localStorage.getItem(key)) {
      setter(true);
    } else {
      cb();
    }
  };

  const exerciseOptions = {
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

  // Proprietary hybrid calorie calculation:
  // MET (body‐based) + mechanical work (load‐based)
  const calculateCalories = () => {
    // --- MET component ---
    const bodyWeightLbs = parseFloat(userData.weight) || 0;
    const reps          = parseInt(newExercise.reps, 10) || 0;
    const sets          = parseInt(newExercise.sets, 10) || 1;
    const exerciseKey   = newExercise.exerciseName || newExercise.exerciseType;

    // estimate time: assume 5 sec per rep
    const totalSeconds = reps * sets * 5;
    const durationMin  = totalSeconds / 60;

    // ← Updated fallback here:
    const met       = MET_VALUES[exerciseKey] ?? MET_VALUES.default;
    const bodyKg    = bodyWeightLbs * 0.453592;
    const metCals   = met * bodyKg * durationMin;

    // --- Mechanical work component ---
    const loadLbs      = parseFloat(newExercise.weight) || 0;
    const loadKg       = loadLbs * 0.453592;
    const rom          = EXERCISE_ROM[exerciseKey] ?? 0.5; // meters
    const workJ        = loadKg * G * rom * reps * sets;
    const mechCals     = workJ / (4184 * EFFICIENCY);

    const total = metCals + mechCals;
    setCurrentCalories(total);
    return total;
  };

  const handleCalculate = () => calculateCalories();

  const handleAddExercise = () => {
    const weight = parseFloat(newExercise.weight);
    const reps   = parseInt(newExercise.reps, 10);
    if (!newExercise.exerciseName || !weight || weight <= 0 || !reps || reps <= 0) {
      alert('Please enter both a valid weight and number of reps.');
      return;
    }
    const cals = calculateCalories();
    setCumulativeExercises([...cumulativeExercises, { ...newExercise, calories: cals }]);
    setNewExercise({ ...newExercise, weight: '', sets: '1', reps: '' });
    setCurrentCalories(0);
  };

  const handleDoneWithExercises = () => {
    const weight = parseFloat(newExercise.weight);
    const reps   = parseInt(newExercise.reps, 10);
    if (newExercise.exerciseName && weight > 0 && reps > 0) {
      handleAddExercise();
    }
    setCurrentStep(2);
  };

  const handleNextFromSauna = () => {
    const filtered = cumulativeExercises.filter((ex) => ex.exerciseType !== 'Sauna');
    if (saunaTime.trim()) {
      const t         = parseFloat(saunaTime) || 0;
      const tmp       = parseFloat(saunaTemp)  || 180;
      const uw        = parseFloat(userData.weight) || 150;
      const saunaCals = t * (tmp - 150) * 0.1 * (uw / 150);
      filtered.push({
        exerciseType: 'Sauna',
        exerciseName: 'Sauna Session',
        sets: '',
        reps: '',
        weight: '',
        calories: saunaCals
      });
    }
    setCumulativeExercises(filtered);
    setCurrentStep(3);
  };

  const handleRemoveExercise = (i) => {
    const u = [...cumulativeExercises];
    u.splice(i, 1);
    setCumulativeExercises(u);
  };

  const handleBackToExercises = () => setCurrentStep(1);
  const handleBackToSauna = () => {
    setCumulativeExercises(cumulativeExercises.filter((ex) => ex.exerciseType !== 'Sauna'));
    setCurrentStep(2);
  };

  const handleFinish = () => {
    const total = cumulativeExercises.reduce((sum, session) => sum + session.calories, 0);
    setCumulativeTotal(total);

    const newSession = {
      date: new Date().toLocaleDateString('en-US'),
      totalCalories: total,
      exercises: cumulativeExercises.map((ex) => ({
        name: ex.exerciseName || ex.exerciseType,
        sets: ex.sets,
        reps: ex.reps,
        calories: ex.calories
      }))
    };

    const existing = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    existing.push(newSession);
    localStorage.setItem('workoutHistory', JSON.stringify(existing));

    onWorkoutLogged(total);
    history.push('/history');
  };

  const handleNewWorkout = () => {
    setCumulativeExercises([]);
    setCurrentCalories(0);
    setSaunaTime('');
    setSaunaTemp('180');
    setCurrentStep(1);
  };

  const handleShareWorkout = () => setShareModalOpen(true);

  // --- Step 3: Summary screen ---
  if (currentStep === 3) {
    const total = cumulativeExercises.reduce((sum, ex) => sum + ex.calories, 0);
    const shareText = `I just logged a workout on ${new Date().toLocaleDateString(
      'en-US'
    )} with Slimcal.ai: ${cumulativeExercises.length} exercises burning a total of ${total.toFixed(
      2
    )} calories! #SlimcalAI`;

    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Typography variant="h2" align="center" color="primary" gutterBottom>
          Workout Summary
        </Typography>
        <Divider sx={{ my: 3 }} />

        {cumulativeExercises.map((ex, idx) => (
          <Typography key={idx} variant="body1" sx={{ mb: 1 }}>
            {ex.exerciseName}{' '}
            {ex.exerciseType === 'Sauna'
              ? `– ${ex.calories.toFixed(2)} cals`
              : `– ${ex.sets}×${ex.reps} (${ex.calories.toFixed(2)} cals)`} 
            <Button
              size="small"
              color="error"
              variant="text"
              onClick={() => handleRemoveExercise(idx)}
              sx={{ ml: 2 }}
            >
              Remove
            </Button>
          </Typography>
        ))}

        <Typography variant="h5" sx={{ mt: 2 }}>
          Total Calories Burned: {total.toFixed(2)}
        </Typography>

        <Box sx={{ mt: 3, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            onClick={() =>
              triggerOrHandle('hasSeenBackHelp', setShowBackHelp, handleBackToSauna)
            }
          >
            Back
          </Button>
          <Button
            variant="contained"
            onClick={() =>
              triggerOrHandle('hasSeenLogHelp', setShowLogHelp, handleFinish)
            }
          >
            Show Me the Burn!
          </Button>
          <Button
            variant="outlined"
            onClick={() =>
              triggerOrHandle('hasSeenShareHelp', setShowShareHelp, handleShareWorkout)
            }
          >
            Share Workout
          </Button>
          <Button
            variant="text"
            onClick={() =>
              triggerOrHandle('hasSeenNewHelp', setShowNewHelp, handleNewWorkout)
            }
          >
            Start New Workout
          </Button>
        </Box>

        <ShareWorkoutModal
          open={shareModalOpen}
          onClose={() => setShareModalOpen(false)}
          shareText={shareText}
          shareUrl={window.location.href}
        />

        {/* Helper Dialogs */}
        <Dialog
          open={showBackHelp}
          onClose={() => handleDismiss('hasSeenBackHelp', setShowBackHelp, handleBackToSauna)}
        >
          <DialogTitle>Go Back</DialogTitle>
          <DialogContent>This returns you to your sauna session to make changes.</DialogContent>
          <DialogActions>
            <Button
              onClick={() =>
                handleDismiss('hasSeenBackHelp', setShowBackHelp, handleBackToSauna)
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
          <DialogContent>Saves your workout to history so you can view your progress.</DialogContent>
          <DialogActions>
            <Button
              onClick={() =>
                handleDismiss('hasSeenLogHelp', setShowLogHelp, handleFinish)
              }
            >
              Got it
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={showShareHelp}
          onClose={() => handleDismiss('hasSeenShareHelp', setShowShareHelp, handleShareWorkout)}
        >
          <DialogTitle>Share Workout</DialogTitle>
          <DialogContent>
            Copy and paste your summary to share it online or with friends!
          </DialogContent>
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
          <DialogContent>
            This will reset your current session and allow you to begin a new one.
          </DialogContent>
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

  // Step 2: Sauna
  if (currentStep === 2) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Typography variant="h2" align="center" color="primary" gutterBottom>
          Sauna Session
        </Typography>
        <Divider sx={{ my: 3 }} />
        <SaunaForm
          saunaTime={saunaTime}
          saunaTemp={saunaTemp}
          setSaunaTime={setSaunaTime}
          setSaunaTemp={setSaunaTemp}
        />
        <Box sx={{ mt: 2, display: 'flex', gap: 2 }}>
          <Button variant="outlined" onClick={handleBackToExercises}>
            Back
          </Button>
          <Button variant="contained" onClick={handleNextFromSauna}>
            Next
          </Button>
        </Box>
      </Container>
    );
  }

  // Step 1: Exercise form
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h2" align="center" color="primary" gutterBottom>
        Workout Tracker
      </Typography>
      <Typography variant="body1" align="center" color="textSecondary">
        Welcome! You are {userData?.age} years old and weigh {userData?.weight} lbs.
      </Typography>
      <Divider sx={{ my: 3 }} />

      {cumulativeExercises.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6">Current Exercises:</Typography>
          {cumulativeExercises
            .filter((ex) => ex.exerciseType !== 'Sauna')
            .map((ex, idx) => (
              <Typography key={idx} variant="body2">
                {ex.exerciseName} – {ex.sets}×{ex.reps} ({ex.calories.toFixed(2)} cals)
                <Button
                  size="small"
                  color="error"
                  variant="text"
                  onClick={() => handleRemoveExercise(idx)}
                  sx={{ ml: 2 }}
                >
                  Remove
                </Button>
              </Typography>
            ))}
        </Box>
      )}

      <ExerciseForm
        newExercise={newExercise}
        setNewExercise={setNewExercise}
        currentCalories={currentCalories}
        onCalculate={handleCalculate}
        onAddExercise={handleAddExercise}
        onDoneWithExercises={handleDoneWithExercises}
        exerciseOptions={exerciseOptions}
      />
    </Container>
  );
}

export default WorkoutPage;
