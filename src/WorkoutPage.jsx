// WorkoutPage.jsx
import React, { useState } from 'react';
import {
  Container,
  Typography,
  Divider,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import { useHistory } from 'react-router-dom';
import ExerciseForm from './ExerciseForm';
import SaunaForm from './SaunaForm';
import ShareWorkoutModal from './ShareWorkoutModal';

function WorkoutPage({ userData }) {
  const history = useHistory();

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
  const [showBackHelp, setShowBackHelp] = useState(false);
  const [showLogHelp, setShowLogHelp] = useState(false);
  const [showShareHelp, setShowShareHelp] = useState(false);
  const [showNewHelp, setShowNewHelp] = useState(false);

  const handleDismiss = (key, setter) => {
    localStorage.setItem(key, 'true');
    setter(false);
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

  const calculateCalories = () => {
    const w = parseFloat(newExercise.weight) || 0;
    const s = parseInt(newExercise.sets) || 1;
    const r = parseInt(newExercise.reps) || 0;
    let cals = w * s * r * 0.05;
    if (newExercise.exerciseType === 'machine') cals *= 1.5;
    else if (['dumbbell', 'barbell'].includes(newExercise.exerciseType)) cals *= 1.2;
    setCurrentCalories(cals);
    return cals;
  };

  const handleCalculate = () => {
    calculateCalories();
  };

  const handleAddExercise = () => {
    const weight = parseFloat(newExercise.weight);
    const reps = parseInt(newExercise.reps);
    if (!newExercise.exerciseName || !weight || weight <= 0 || !reps || reps <= 0) {
      alert('Please enter both a valid weight and number of reps.');
      return;
    }
    const cals = calculateCalories();
    const exerciseToAdd = { ...newExercise, calories: cals };
    setCumulativeExercises([...cumulativeExercises, exerciseToAdd]);
    setNewExercise({ ...newExercise, weight: '', sets: '1', reps: '' });
    setCurrentCalories(0);
  };

  const handleDoneWithExercises = () => {
    const weight = parseFloat(newExercise.weight);
    const reps = parseInt(newExercise.reps);
    if (newExercise.exerciseName && weight > 0 && reps > 0) handleAddExercise();
    setCurrentStep(2);
  };

  const handleNextFromSauna = () => {
    const filtered = cumulativeExercises.filter((ex) => ex.exerciseType !== 'Sauna');
    if (saunaTime.trim() !== '') {
      const saunaTimeVal = parseFloat(saunaTime) || 0;
      const saunaTempVal = parseFloat(saunaTemp) || 180;
      const userWeight = parseFloat(userData.weight) || 150;
      const saunaCalories = saunaTimeVal * (saunaTempVal - 150) * 0.1 * (userWeight / 150);
      filtered.push({
        exerciseType: 'Sauna',
        exerciseName: 'Sauna Session',
        sets: '',
        reps: `${saunaTimeVal} min`,
        weight: '',
        calories: saunaCalories
      });
    }
    setCumulativeExercises(filtered);
    setCurrentStep(3);
  };

  const handleRemoveExercise = (index) => {
    const updated = [...cumulativeExercises];
    updated.splice(index, 1);
    setCumulativeExercises(updated);
  };

  const handleBackToExercises = () => setCurrentStep(1);
  const handleBackToSauna = () => {
    const filtered = cumulativeExercises.filter((ex) => ex.exerciseType !== 'Sauna');
    setCumulativeExercises(filtered);
    setCurrentStep(2);
  };

  const handleFinish = () => {
    const total = cumulativeExercises.reduce((sum, ex) => sum + ex.calories, 0);
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

  const triggerOrHandle = (key, setPopup, callback) => {
    if (!localStorage.getItem(key)) {
      setPopup(true);
    } else {
      callback();
    }
  };

  if (currentStep === 3) {
    const total = cumulativeExercises.reduce((sum, ex) => sum + ex.calories, 0);
    const shareText = `I just logged a workout on ${new Date().toLocaleDateString('en-US')} with Slimcal.ai: ${cumulativeExercises.length} exercises burning a total of ${total.toFixed(2)} calories! #SlimcalAI`;
    const shareUrl = window.location.href;

    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Typography variant="h2" color="primary" align="center" gutterBottom>
          Workout Summary
        </Typography>
        <Divider sx={{ my: 3 }} />
        {cumulativeExercises.map((ex, idx) => (
          <Typography key={idx} variant="body1">
            {ex.exerciseName} - {ex.calories.toFixed(2)} cals
            <Button
              variant="text"
              color="error"
              size="small"
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

        <Button variant="outlined" sx={{ mt: 3, mr: 2 }} onClick={() => triggerOrHandle('hasSeenBackHelp', setShowBackHelp, handleBackToSauna)}>
          Back
        </Button>
        <Button variant="contained" sx={{ mt: 3, mr: 2 }} onClick={() => triggerOrHandle('hasSeenLogHelp', setShowLogHelp, handleFinish)}>
          Log Workout
        </Button>
        <Button variant="outlined" sx={{ mt: 3, mr: 2 }} onClick={() => triggerOrHandle('hasSeenShareHelp', setShowShareHelp, handleShareWorkout)}>
          Share Workout
        </Button>
        <Button variant="text" sx={{ mt: 3 }} onClick={() => triggerOrHandle('hasSeenNewHelp', setShowNewHelp, handleNewWorkout)}>
          Start New Workout
        </Button>

        <ShareWorkoutModal
          open={shareModalOpen}
          onClose={() => setShareModalOpen(false)}
          shareText={shareText}
          shareUrl={shareUrl}
        />

        {/* Button Help Popups */}
        {/* ...unchanged from baseline */}
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h2" color="primary" align="center" gutterBottom>
        Workout Tracker
      </Typography>
      <Typography variant="body1" align="center" color="textSecondary">
        Welcome! You are {userData.age} years old and weigh {userData.weight} lbs.
      </Typography>
      <Divider sx={{ my: 3 }} />
      {cumulativeExercises.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <Typography variant="h6">Current Exercises:</Typography>
          {cumulativeExercises
            .filter((ex) => ex.exerciseType !== 'Sauna')
            .map((ex, idx) => (
              <Typography key={idx} variant="body2">
                {ex.exerciseName} - {ex.sets} sets x {ex.reps} reps ({ex.calories.toFixed(2)} cals)
                <Button
                  variant="text"
                  color="error"
                  size="small"
                  onClick={() => handleRemoveExercise(idx)}
                  sx={{ ml: 2 }}
                >
                  Remove
                </Button>
              </Typography>
            ))}
        </div>
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
