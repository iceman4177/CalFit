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
import TemplateSelector from './TemplateSelector';
import { MET_VALUES } from './exerciseMeta';
import { EXERCISE_ROM, G, EFFICIENCY } from './exerciseConstants';
import { updateStreak } from './utils/streak';

export default function WorkoutPage({ userData, onWorkoutLogged }) {
  const history = useHistory();

  // Redirect if missing userData
  useEffect(() => {
    if (!userData) history.replace('/edit-info');
  }, [userData, history]);

  const [currentStep, setCurrentStep] = useState(1);
  const [cumulativeExercises, setCumulativeExercises] = useState([]);
  const [cumulativeTotal, setCumulativeTotal] = useState(0);

  const [newExercise, setNewExercise] = useState({
    exerciseType:    '',
    cardioType:      '',
    manualCalories:  '',
    muscleGroup:     '',
    exerciseName:    '',
    weight:          '',
    sets:            '1',
    reps:            '',
    concentricTime:  '',
    eccentricTime:   ''
  });
  const [currentCalories, setCurrentCalories] = useState(0);

  // Inline sauna controls
  const [showSaunaSection, setShowSaunaSection] = useState(false);
  const [saunaTime,        setSaunaTime]        = useState('');
  const [saunaTemp,        setSaunaTemp]        = useState('180');

  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [showTemplate,   setShowTemplate]   = useState(false);

  // First-time summary dialogs
  const [showBackHelp,  setShowBackHelp]  = useState(false);
  const [showLogHelp,   setShowLogHelp]   = useState(false);
  const [showShareHelp, setShowShareHelp] = useState(false);
  const [showNewHelp,   setShowNewHelp]   = useState(false);

  const handleDismiss = (key, setter, cb) => {
    localStorage.setItem(key, 'true');
    setter(false);
    if (cb) cb();
  };
  const triggerOrHandle = (key, setter, cb) => {
    if (!localStorage.getItem(key)) setter(true);
    else cb();
  };

  // Load a saved template
  const handleLoadTemplate = exercises => {
    setCumulativeExercises(
      exercises.map(ex => ({
        exerciseType:    ex.exerciseType || '',
        muscleGroup:     ex.muscleGroup   || '',
        exerciseName:    ex.name,
        weight:          ex.weight        || '',
        sets:            ex.sets          || '',
        reps:            ex.reps          || '',
        concentricTime:  ex.concentricTime|| '',
        eccentricTime:   ex.eccentricTime || '',
        calories:        ex.calories
      }))
    );
  };

  // Full exerciseOptions with machine block restored
  const exerciseOptions = {
    cardio: ['Treadmill','Bike','Elliptical','Rowing Machine','Stair Climber'],
    machine: {
      Chest:     ['Chest Press Machine','Cable Crossover/Functional Trainer'],
      Shoulders: ['Shoulder Press Machine'],
      Back:      ['Seated Row Machine','Lat Pulldown Machine'],
      Legs:      ['Leg Press Machine','Leg Extension Machine','Leg Curl Machine'],
      Abs:       ['Abdominal Crunch Machine'],
      Misc:      ['Pec Fly / Rear Deltoid Machine','Assisted Pull-Up/Dip Machine']
    },
    dumbbell: {
      Chest:     ['Dumbbell Bench Press','Dumbbell Flyes'],
      Shoulders: ['Dumbbell Shoulder Press','Dumbbell Lateral Raise'],
      Biceps:    ['Dumbbell Bicep Curls','Hammer Curls'],
      Triceps:   ['Dumbbell Triceps Extensions'],
      Back:      ['Dumbbell Rows (One-Arm Row)'],
      Traps:     ['Dumbbell Shrugs'],
      Legs:      ['Dumbbell Squats','Dumbbell Lunges','Dumbbell Deadlifts','Dumbbell Step-Ups']
    },
    barbell: {
      Chest:     ['Barbell Bench Press'],
      Shoulders: ['Overhead Press (Barbell Press)','Barbell Upright Row'],
      Back:      ['Barbell Row'],
      Biceps:    ['Barbell Bicep Curls'],
      Legs:      ['Barbell Squat','Barbell Deadlift','Barbell Lunges'],
      Glutes:    ['Barbell Hip Thrusts'],
      FullBody:  ['Barbell Clean and Press / Power Clean'],
      Traps:     ['Barbell Shrugs']
    }
  };

  // Calorie calculation
  const calculateCalories = () => {
    const bwLbs = parseFloat(userData.weight) || 0;
    const reps  = parseInt(newExercise.reps, 10) || 0;
    const sets  = parseInt(newExercise.sets, 10) || 1;
    const key   = newExercise.exerciseName || newExercise.exerciseType;

    const concSec   = parseFloat(newExercise.concentricTime) || 2;
    const eccSec    = parseFloat(newExercise.eccentricTime)  || 2;
    const activeMin = (reps * sets * (concSec + eccSec)) / 60;

    const met    = MET_VALUES[key] ?? MET_VALUES.default;
    const bodyKg = bwLbs * 0.453592;
    const metCals = met * bodyKg * activeMin;

    const loadKg   = (parseFloat(newExercise.weight) || 0) * 0.453592;
    const rom      = EXERCISE_ROM[key] ?? 0.5;
    const workJ    = loadKg * G * rom * reps * sets;
    const mechCals = workJ / (4184 * EFFICIENCY);

    const total = metCals + mechCals;
    setCurrentCalories(total);
    return total;
  };

  // Handlers
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
        alert('Please enter a valid calories amount for cardio.');
        return;
      }
      setCumulativeExercises([
        ...cumulativeExercises,
        {
          exerciseType: 'cardio',
          exerciseName: newExercise.cardioType || 'Cardio',
          calories:     cal
        }
      ]);
      setNewExercise({
        ...newExercise,
        cardioType:     '',
        manualCalories: ''
      });
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
    setCumulativeExercises([
      ...cumulativeExercises,
      { ...newExercise, calories: cals }
    ]);
    setNewExercise({
      exerciseType:    '',
      cardioType:      '',
      manualCalories:  '',
      muscleGroup:     '',
      exerciseName:    '',
      weight:          '',
      sets:            '1',
      reps:            '',
      concentricTime:  '',
      eccentricTime:   ''
    });
    setCurrentCalories(0);
  };

  const handleDoneWithExercises = () => {
    if (
      newExercise.exerciseType === 'cardio' &&
      parseFloat(newExercise.manualCalories) > 0
    ) {
      handleAddExercise();
    } else if (
      newExercise.exerciseName &&
      parseFloat(newExercise.weight) > 0 &&
      parseInt(newExercise.reps, 10) > 0
    ) {
      handleAddExercise();
    }
    setCurrentStep(3);
  };

  const handleRemoveExercise = i => {
    const arr = [...cumulativeExercises];
    arr.splice(i, 1);
    setCumulativeExercises(arr);
  };

  const handleSaveSauna = () => {
    if (saunaTime.trim()) {
      const t   = parseFloat(saunaTime) || 0;
      const tmp = parseFloat(saunaTemp) || 180;
      const uw  = parseFloat(userData.weight) || 150;
      const saunaCals = t * (tmp - 150) * 0.1 * (uw / 150);
      setCumulativeExercises(exs =>
        [
          ...exs.filter(e => e.exerciseType !== 'Sauna'),
          { exerciseType:'Sauna', exerciseName:'Sauna Session', calories:saunaCals }
        ]
      );
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

  const handleFinish = () => {
    const total = cumulativeExercises.reduce((sum, ex) => sum + ex.calories, 0);
    setCumulativeTotal(total);

    const newSession = {
      date:          new Date().toLocaleDateString('en-US'),
      totalCalories: total,
      exercises:     cumulativeExercises.map(ex => ({
        name:     ex.exerciseName,
        sets:     ex.sets,
        reps:     ex.reps,
        calories: ex.calories
      }))
    };
    const existing = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    existing.push(newSession);
    localStorage.setItem('workoutHistory', JSON.stringify(existing));

    onWorkoutLogged(total);
    updateStreak();
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

  // ---- Step 3: Summary ----
  if (currentStep === 3) {
    const total     = cumulativeExercises.reduce((sum, ex) => sum + ex.calories, 0);
    const shareText = `I just logged a workout on ${new Date().toLocaleDateString(
      'en-US'
    )} with Slimcal.ai: ${cumulativeExercises.length} items, ${total.toFixed(
      2
    )} cals! #SlimcalAI`;

    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Typography variant="h2" align="center" color="primary" gutterBottom>
          Workout Summary
        </Typography>
        <Divider sx={{ my: 3 }} />

        {cumulativeExercises.map((ex, idx) => (
          <Typography key={idx} variant="body1" sx={{ mb: 1 }}>
            {ex.exerciseName} – {ex.calories.toFixed(2)} cals
            <Button
              size="small"
              color="error"
              variant="text"
              sx={{ ml: 2 }}
              onClick={() => handleRemoveExercise(idx)}
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
              triggerOrHandle('hasSeenBackHelp', setShowBackHelp, () => setCurrentStep(1))
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

        <Dialog
          open={showBackHelp}
          onClose={() =>
            handleDismiss('hasSeenBackHelp', setShowBackHelp, () => setCurrentStep(1))
          }
        >
          <DialogTitle>Go Back</DialogTitle>
          <DialogContent>Returns you to edit your inputs.</DialogContent>
          <DialogActions>
            <Button onClick={() =>
              handleDismiss('hasSeenBackHelp', setShowBackHelp, () => setCurrentStep(1))
            }>Got it</Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={showLogHelp}
          onClose={() =>
            handleDismiss('hasSeenLogHelp', setShowLogHelp, handleFinish)
          }
        >
          <DialogTitle>Log Workout</DialogTitle>
          <DialogContent>Saves your session to history.</DialogContent>
          <DialogActions>
            <Button onClick={() =>
              handleDismiss('hasSeenLogHelp', setShowLogHelp, handleFinish)
            }>Got it</Button>
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
            <Button onClick={() =>
              handleDismiss('hasSeenShareHelp', setShowShareHelp, handleShareWorkout)
            }>Got it</Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={showNewHelp}
          onClose={() =>
            handleDismiss('hasSeenNewHelp', setShowNewHelp, handleNewWorkout)
          }
        >
          <DialogTitle>Start New Workout</DialogTitle>
          <DialogContent>Clears this session for a fresh start.</DialogContent>
          <DialogActions>
            <Button onClick={() =>
              handleDismiss('hasSeenNewHelp', setShowNewHelp, handleNewWorkout)
            }>Got it</Button>
          </DialogActions>
        </Dialog>
      </Container>
    );
  }

  // ---- Step 1: Exercise + Sauna Inline ----
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h2" align="center" color="primary" gutterBottom>
        Workout Tracker
      </Typography>

      <Box textAlign="center" mb={2}>
        <Button variant="outlined" onClick={() => setShowTemplate(true)}>
          Load Past Workout
        </Button>
      </Box>

      <Typography align="center" color="textSecondary" gutterBottom>
        Welcome! You are {userData?.age} years old and weigh {userData?.weight} lbs.
      </Typography>
      <Divider sx={{ my: 3 }} />

      {cumulativeExercises.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6">Current Session Logs:</Typography>
          {cumulativeExercises.map((ex, idx) => (
            <Typography key={idx} variant="body2">
              {ex.exerciseName} – {ex.calories.toFixed(2)} cals
              <Button
                size="small"
                color="error"
                variant="text"
                sx={{ ml: 2 }}
                onClick={() => handleRemoveExercise(idx)}
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

      <Box textAlign="center" my={2}>
        <Button variant="text" onClick={() => setShowSaunaSection(s => !s)}>
          {showSaunaSection ? 'Cancel Sauna' : 'Add Sauna Session (Optional)'}
        </Button>
      </Box>

      {showSaunaSection && (
        <Box sx={{ mb: 3 }}>
          <SaunaForm
            saunaTime={saunaTime}
            saunaTemp={saunaTemp}
            setSaunaTime={setSaunaTime}
            setSaunaTemp={setSaunaTemp}
          />
          <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
            <Button variant="contained" onClick={handleSaveSauna}>
              Save Sauna
            </Button>
            <Button variant="outlined" onClick={handleCancelSaunaForm}>
              Cancel
            </Button>
          </Box>
        </Box>
      )}

      <TemplateSelector
        open={showTemplate}
        onClose={() => setShowTemplate(false)}
        onLoadTemplate={handleLoadTemplate}
      />
    </Container>
  );
}
