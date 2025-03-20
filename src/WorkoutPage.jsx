import React, { useState, useEffect } from 'react';
import { Container, Typography, Divider } from '@mui/material';
import ExerciseForm from './ExerciseForm';
import SaunaForm from './SaunaForm';
import WorkoutSummary from './WorkoutSummary';

function WorkoutPage({ userData }) {
  // Step 1 = Exercises, Step 2 = Sauna, Step 3 = Summary
  const [currentStep, setCurrentStep] = useState(1);

  // Master list of exercises for this session
  const [cumulativeExercises, setCumulativeExercises] = useState([]);
  const [cumulativeTotal, setCumulativeTotal] = useState(0);

  // New Exercise
  const [newExercise, setNewExercise] = useState({
    exerciseType: '',
    muscleGroup: '',
    exerciseName: '',
    weight: '',
    sets: '1',
    reps: ''
  });
  const [currentCalories, setCurrentCalories] = useState(0);

  // Sauna
  const [saunaTime, setSaunaTime] = useState('');
  const [saunaTemp, setSaunaTemp] = useState('180');

  // Example exercise options
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

  // Calculate calories for a single exercise
  const calculateCalories = (exercise) => {
    const w = parseFloat(exercise.weight) || 0;
    const s = parseInt(exercise.sets) || 1;
    const r = parseInt(exercise.reps) || 0;
    let cals = w * s * r * 0.05;
    if (exercise.exerciseType === 'machine') {
      cals *= 1.5;
    } else if (exercise.exerciseType === 'dumbbell' || exercise.exerciseType === 'barbell') {
      cals *= 1.2;
    }
    return cals;
  };

  // Handler for the "Calculate Calories" button
  const handleCalculate = () => {
    const cals = calculateCalories(newExercise);
    setCurrentCalories(cals);
  };

  // Handler for "Add Exercise"
  const handleAddExercise = () => {
    // Make sure we have an updated calories value
    const cals = calculateCalories(newExercise);
    const exerciseToAdd = { ...newExercise, calories: cals };
    setCumulativeExercises((prev) => [...prev, exerciseToAdd]);
    setNewExercise({
      exerciseType: '',
      muscleGroup: '',
      exerciseName: '',
      weight: '',
      sets: '1',
      reps: ''
    });
    setCurrentCalories(0);
  };

  // Handler when user is done adding exercises => move to sauna step
  const handleDoneWithExercises = () => {
    setCurrentStep(2);
  };

  // Handler for finishing the entire workout
  const handleFinishWorkout = () => {
    // If user provided sauna data, calculate sauna cals
    let updatedExercises = [...cumulativeExercises];
    if (saunaTime.trim() !== '') {
      const saunaTimeVal = parseFloat(saunaTime) || 0;
      const saunaTempVal = parseFloat(saunaTemp) || 180;
      const userWeight = parseFloat(userData.weight) || 150; // fallback

      const weightFactor = userWeight / 150;
      const saunaCalories = saunaTimeVal * (saunaTempVal - 150) * 0.1 * weightFactor;

      updatedExercises.push({
        exerciseType: 'Sauna',
        exerciseName: 'Sauna Session',
        sets: '',
        reps: `${saunaTimeVal} min`,
        weight: '',
        calories: saunaCalories
      });
    }

    // Calculate total
    const total = updatedExercises.reduce((sum, ex) => sum + ex.calories, 0);
    setCumulativeExercises(updatedExercises);
    setCumulativeTotal(total);

    // Save the workout session to history
    const currentDate = new Date().toLocaleDateString('en-US'); // e.g. 3/19/2025
    const newSession = {
      date: currentDate,
      totalCalories: total,
      exercises: updatedExercises.map((ex) => ({
        name: ex.exerciseName || ex.exerciseType,
        sets: ex.sets,
        reps: ex.reps,
        calories: ex.calories
      }))
    };
    const existingHistory = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    existingHistory.push(newSession);
    localStorage.setItem('workoutHistory', JSON.stringify(existingHistory));

    // Move to summary step
    setCurrentStep(3);
  };

  // Remove a single exercise from the array
  const handleRemoveExercise = (index) => {
    const updated = [...cumulativeExercises];
    updated.splice(index, 1);
    setCumulativeExercises(updated);
  };

  // Clear all exercises
  const handleClearAll = () => {
    setCumulativeExercises([]);
    setCumulativeTotal(0);
  };

  // Start a new workout (back to step 1, clear data)
  const handleNewWorkout = () => {
    setCumulativeExercises([]);
    setCumulativeTotal(0);
    setSaunaTime('');
    setSaunaTemp('180');
    setCurrentStep(1);
  };

  // If user is at Step 3, show summary
  if (currentStep === 3) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Typography variant="h2" color="primary" align="center" gutterBottom>
          Workout Summary
        </Typography>
        <Divider sx={{ my: 3 }} />
        <WorkoutSummary
          cumulativeExercises={cumulativeExercises}
          cumulativeTotal={cumulativeTotal}
          onRemoveExercise={handleRemoveExercise}
          onClearAll={handleClearAll}
          onNewWorkout={handleNewWorkout}
        />
      </Container>
    );
  }

  // If user is at Step 2, show sauna form
  if (currentStep === 2) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Typography variant="h2" color="primary" align="center" gutterBottom>
          Sauna Session
        </Typography>
        <Divider sx={{ my: 3 }} />

        <SaunaForm
          saunaTime={saunaTime}
          saunaTemp={saunaTemp}
          setSaunaTime={setSaunaTime}
          setSaunaTemp={setSaunaTemp}
          onFinishWorkout={handleFinishWorkout}
          onBackToExercises={() => setCurrentStep(1)}
        />
      </Container>
    );
  }

  // Otherwise, user is at Step 1 (Exercises)
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h2" color="primary" align="center" gutterBottom>
        Workout Tracker
      </Typography>
      <Typography variant="body1" align="center" color="textSecondary">
        Welcome! You are {userData.age} years old and weigh {userData.weight} lbs.
      </Typography>
      <Divider sx={{ my: 3 }} />

      {/* Current Exercises */}
      {cumulativeExercises.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <Typography variant="h6">Current Exercises:</Typography>
          {cumulativeExercises.map((ex, idx) => (
            <Typography key={idx} variant="body2">
              {ex.exerciseName} - {ex.sets} sets x {ex.reps} reps (
              {ex.calories.toFixed(2)} cals)
              <button
                style={{ marginLeft: '10px' }}
                onClick={() => handleRemoveExercise(idx)}
              >
                Remove
              </button>
            </Typography>
          ))}
        </div>
      )}

      {/* Exercise Form */}
      <ExerciseForm
        newExercise={newExercise}
        setNewExercise={setNewExercise}
        currentCalories={currentCalories}
        setCurrentCalories={setCurrentCalories}
        onAddExercise={handleAddExercise}
        onCalculate={handleCalculate}
        onDoneWithExercises={handleDoneWithExercises}
        exerciseOptions={exerciseOptions}
      />
    </Container>
  );
}

export default WorkoutPage;
