import React, { useState } from 'react';
import { Container, Typography, Divider, Button } from '@mui/material';
import ExerciseForm from './ExerciseForm';
import SaunaForm from './SaunaForm';
import { useHistory } from 'react-router-dom';

function WorkoutPage({ userData }) {
  // Wizard Steps: 1: Exercises, 2: Sauna, 3: Summary
  const [currentStep, setCurrentStep] = useState(1);
  const history = useHistory();

  // Master list of exercises for the session
  const [cumulativeExercises, setCumulativeExercises] = useState([]);
  const [cumulativeTotal, setCumulativeTotal] = useState(0);

  // New exercise state – includes selection and set details
  const [newExercise, setNewExercise] = useState({
    exerciseType: '',
    muscleGroup: '',
    exerciseName: '',
    weight: '',
    sets: '1',
    reps: ''
  });
  const [currentCalories, setCurrentCalories] = useState(0);

  // Sauna data
  const [saunaTime, setSaunaTime] = useState('');
  const [saunaTemp, setSaunaTemp] = useState('180');

  // Example exercise options grouped by equipment type
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

  // Calculate calories for a single exercise using a basic formula
  const calculateCalories = (exercise) => {
    const w = parseFloat(exercise.weight) || 0;
    const s = parseInt(exercise.sets) || 1;
    const r = parseInt(exercise.reps) || 0;
    let cals = w * s * r * 0.05;
    if (exercise.exerciseType === 'machine') {
      cals *= 1.5;
    } else if (
      exercise.exerciseType === 'dumbbell' ||
      exercise.exerciseType === 'barbell'
    ) {
      cals *= 1.2;
    }
    return cals;
  };

  // Handler for "Calculate Calories" button
  const handleCalculate = () => {
    const cals = calculateCalories(newExercise);
    setCurrentCalories(cals);
  };

  // Handler for adding a set – note we only clear the set details (weight, sets, reps)
  const handleAddExercise = () => {
    const cals = calculateCalories(newExercise);
    const exerciseToAdd = { ...newExercise, calories: cals };
    setCumulativeExercises([...cumulativeExercises, exerciseToAdd]);
    // Clear only the set-specific fields so the selection remains
    setNewExercise((prev) => ({
      ...prev,
      weight: '',
      sets: '1',
      reps: ''
    }));
    setCurrentCalories(0);
  };

  // Move to the Sauna step after finishing exercise entry
  const handleDoneWithExercises = () => {
    setCurrentStep(2);
  };

  // In the Sauna step, merge the sauna data (if any) and move to Summary
  const handleNextFromSauna = () => {
    const filtered = cumulativeExercises.filter(
      (ex) => ex.exerciseType !== 'Sauna'
    );
    if (saunaTime.trim() !== '') {
      const saunaTimeVal = parseFloat(saunaTime) || 0;
      const saunaTempVal = parseFloat(saunaTemp) || 180;
      const userWeight = parseFloat(userData.weight) || 150;
      const weightFactor = userWeight / 150;
      const saunaCalories = saunaTimeVal * (saunaTempVal - 150) * 0.1 * weightFactor;
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

  // Remove an exercise (or sauna entry) from the current session
  const handleRemoveExercise = (index) => {
    const updated = [...cumulativeExercises];
    updated.splice(index, 1);
    setCumulativeExercises(updated);
  };

  // Navigation: "Back" from Sauna returns to Exercises
  const handleBackToExercises = () => {
    setCurrentStep(1);
  };

  // Navigation: "Back" from Summary returns to Sauna (removing sauna entry)
  const handleBackToSauna = () => {
    const filtered = cumulativeExercises.filter(
      (ex) => ex.exerciseType !== 'Sauna'
    );
    setCumulativeExercises(filtered);
    setCurrentStep(2);
  };

  // Finalize the workout: save session to localStorage and navigate to Workout History
  const handleFinish = () => {
    const total = cumulativeExercises.reduce((sum, ex) => sum + ex.calories, 0);
    setCumulativeTotal(total);
    const currentDate = new Date().toLocaleDateString('en-US'); // e.g., "3/19/2025"
    const newSession = {
      date: currentDate,
      totalCalories: total,
      exercises: cumulativeExercises.map((ex) => ({
        name: ex.exerciseName || ex.exerciseType,
        sets: ex.sets,
        reps: ex.reps,
        calories: ex.calories
      }))
    };
    const existingHistory = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    existingHistory.push(newSession);
    localStorage.setItem('workoutHistory', JSON.stringify(existingHistory));
    history.push('/history');
  };

  // Allow the user to start a new workout (clears session data)
  const handleNewWorkout = () => {
    setCumulativeExercises([]);
    setCumulativeTotal(0);
    setSaunaTime('');
    setSaunaTemp('180');
    setCurrentStep(1);
  };

  // ---------------- Render Based on Step ----------------

  // Step 3: Summary – show list of exercises (including sauna) with total and navigation buttons
  if (currentStep === 3) {
    const total = cumulativeExercises.reduce((sum, ex) => sum + ex.calories, 0);
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
        <Button variant="outlined" sx={{ mt: 3, mr: 2 }} onClick={handleBackToSauna}>
          Back
        </Button>
        <Button variant="contained" sx={{ mt: 3, mr: 2 }} onClick={handleFinish}>
          Log Workout
        </Button>
        <Button variant="text" sx={{ mt: 3 }} onClick={handleNewWorkout}>
          Start New Workout
        </Button>
      </Container>
    );
  }

  // Step 2: Sauna – show sauna inputs with Back and Next buttons
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
        />
        <Button variant="outlined" sx={{ mt: 2, mr: 2 }} onClick={handleBackToExercises}>
          Back
        </Button>
        <Button variant="contained" sx={{ mt: 2 }} onClick={handleNextFromSauna}>
          Next
        </Button>
      </Container>
    );
  }

  // Step 1: Exercises – display current exercises and the ExerciseForm.
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
