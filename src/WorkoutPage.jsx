import React, { useState, useEffect } from 'react';
import { Container, Typography, Box, Divider } from '@mui/material';
import ExerciseForm from './ExerciseForm';
import SaunaForm from './SaunaForm';
import WorkoutSummary from './WorkoutSummary';

function WorkoutPage({ userData }) {
  // Define grouped exercise options by equipment type and muscle group
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

  // --- Cumulative Data: loaded once from localStorage ---
  const [cumulativeExercises, setCumulativeExercises] = useState([]);
  const [cumulativeTotal, setCumulativeTotal] = useState(0);

  // --- New Exercise Form State & Current Calories ---
  const [newExercise, setNewExercise] = useState(() => {
    const saved = sessionStorage.getItem('newExerciseFields');
    return saved
      ? JSON.parse(saved)
      : { exerciseType: '', exerciseName: '', weight: '', sets: '1', reps: '' };
  });
  const [currentCalories, setCurrentCalories] = useState(() => {
    const savedCals = sessionStorage.getItem('currentWorkoutCalories');
    return savedCals ? parseFloat(savedCals) : 0;
  });

  // --- Sauna Session State ---
  const [saunaTime, setSaunaTime] = useState(() => sessionStorage.getItem('saunaTime') || '');
  const [saunaTemp, setSaunaTemp] = useState(() => sessionStorage.getItem('saunaTemp') || '180');

  // --- Flags stored in sessionStorage ---
  const [showSaunaForm, setShowSaunaForm] = useState(() => sessionStorage.getItem('showSaunaForm') === 'true');
  const [isFinished, setIsFinished] = useState(() => sessionStorage.getItem('workoutFinished') === 'true');

  // On mount, load cumulative data from localStorage
  useEffect(() => {
    const savedCum = localStorage.getItem('cumulativeWorkoutData');
    if (savedCum) {
      const parsed = JSON.parse(savedCum);
      if (parsed?.exercises) {
        setCumulativeExercises(parsed.exercises);
        const total = parsed.exercises.reduce((sum, ex) => sum + ex.calories, 0);
        setCumulativeTotal(total);
      }
    }
  }, []);

  // Keep flags in sessionStorage
  useEffect(() => {
    sessionStorage.setItem('showSaunaForm', showSaunaForm ? 'true' : 'false');
  }, [showSaunaForm]);

  useEffect(() => {
    sessionStorage.setItem('workoutFinished', isFinished ? 'true' : 'false');
  }, [isFinished]);

  // Update cumulative data
  const updateCumulativeData = (updatedExercises) => {
    setCumulativeExercises(updatedExercises);
    const newTotal = updatedExercises.reduce((sum, ex) => sum + ex.calories, 0);
    setCumulativeTotal(newTotal);
    localStorage.setItem('cumulativeWorkoutData', JSON.stringify({ exercises: updatedExercises }));
  };

  // Handlers
  const handleAddExercise = (e) => {
    e.preventDefault();
    const cals = parseFloat(sessionStorage.getItem('currentWorkoutCalories')) || 0;
    const exerciseToAdd = { ...newExercise, calories: cals };
    const updatedExercises = [...cumulativeExercises, exerciseToAdd];
    updateCumulativeData(updatedExercises);
    setNewExercise({ exerciseType: '', exerciseName: '', weight: '', sets: '1', reps: '' });
    setCurrentCalories(0);
    sessionStorage.removeItem('newExerciseFields');
    sessionStorage.removeItem('currentWorkoutCalories');
  };

  const handleFinishWorkout = (e) => {
    e.preventDefault();
    sessionStorage.removeItem('workoutFinished');
    setIsFinished(false);
    setShowSaunaForm(true);
  };

  const handleAddSauna = (e, time, temp) => {
    e.preventDefault();
    const saunaTimeVal = parseFloat(time);
    const saunaTempVal = parseFloat(temp);
    const safeTime = isNaN(saunaTimeVal) ? 0 : saunaTimeVal;
    const safeTemp = isNaN(saunaTempVal) ? 180 : saunaTempVal;
    const weightNum = parseFloat(userData.weight);
    const safeWeight = isNaN(weightNum) ? 0 : weightNum;
    const weightFactor = safeWeight > 0 ? safeWeight / 150 : 1;
    const saunaCalories = safeTime * (safeTemp - 150) * 0.1 * weightFactor;
    const finalCals = isNaN(saunaCalories) ? 0 : saunaCalories;
    const saunaEntry = {
      exerciseType: 'Sauna',
      exerciseName: 'Sauna Session',
      weight: '',
      sets: '',
      reps: `${safeTime} min`,
      calories: finalCals,
    };
    const updatedExercises = [...cumulativeExercises, saunaEntry];
    updateCumulativeData(updatedExercises);
    setSaunaTime('');
    setSaunaTemp('180');
    setShowSaunaForm(false);
    setIsFinished(true);
  };

  const handleSkipSauna = (e) => {
    e.preventDefault();
    setShowSaunaForm(false);
    setIsFinished(true);
  };

  const handleRemoveExercise = (index) => {
    const updatedExercises = [...cumulativeExercises];
    updatedExercises.splice(index, 1);
    updateCumulativeData(updatedExercises);
  };

  const handleClearAll = () => {
    updateCumulativeData([]);
    localStorage.removeItem('cumulativeWorkoutData');
    sessionStorage.removeItem('workoutFinished');
    setIsFinished(false);
  };

  if (isFinished) {
    return <WorkoutSummary cumulativeExercises={cumulativeExercises} cumulativeTotal={cumulativeTotal} onRemoveExercise={handleRemoveExercise} onClearAll={handleClearAll} />;
  }

  if (showSaunaForm) {
    return <SaunaForm saunaTime={saunaTime} saunaTemp={saunaTemp} setSaunaTime={setSaunaTime} setSaunaTemp={setSaunaTemp} onAddSauna={handleAddSauna} onSkipSauna={handleSkipSauna} />;
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

      <WorkoutSummary cumulativeExercises={cumulativeExercises} cumulativeTotal={cumulativeTotal} onRemoveExercise={handleRemoveExercise} onClearAll={handleClearAll} />
      <ExerciseForm newExercise={newExercise} setNewExercise={setNewExercise} currentCalories={currentCalories} setCurrentCalories={setCurrentCalories} onAddExercise={handleAddExercise} onFinishWorkout={handleFinishWorkout} exerciseOptions={exerciseOptions} />
    </Container>
  );
}

export default WorkoutPage;
