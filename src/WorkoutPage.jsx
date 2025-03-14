import React, { useState, useEffect } from 'react';
import ExerciseForm from './ExerciseForm';
import SaunaForm from './SaunaForm';
import WorkoutSummary from './WorkoutSummary';

function WorkoutPage({ userData }) {
  // Define grouped exercise options
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

  // --- New Exercise Form State & Current Calories (handled by ExerciseForm) ---
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

  // --- Sauna Session State (handled by SaunaForm) ---
  const [saunaTime, setSaunaTime] = useState(() => {
    const saved = sessionStorage.getItem('saunaTime');
    return saved ? saved : '';
  });
  const [saunaTemp, setSaunaTemp] = useState(() => {
    const saved = sessionStorage.getItem('saunaTemp');
    return saved ? saved : '180';
  });

  // --- Flags stored in sessionStorage ---
  const [showSaunaForm, setShowSaunaForm] = useState(() => {
    const saved = sessionStorage.getItem('showSaunaForm');
    return saved === 'true';
  });
  const [isFinished, setIsFinished] = useState(() => {
    const finished = sessionStorage.getItem('workoutFinished');
    return finished === 'true';
  });

  // On mount, load cumulative data from localStorage (if available)
  useEffect(() => {
    const savedCum = localStorage.getItem('cumulativeWorkoutData');
    if (savedCum) {
      const parsed = JSON.parse(savedCum);
      if (parsed && parsed.exercises) {
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

  // Helper: update cumulative data
  const updateCumulativeData = (updatedExercises) => {
    setCumulativeExercises(updatedExercises);
    const newTotal = updatedExercises.reduce((sum, ex) => sum + ex.calories, 0);
    setCumulativeTotal(newTotal);
    localStorage.setItem('cumulativeWorkoutData', JSON.stringify({ exercises: updatedExercises }));
  };

  // Handler for "Add New Exercise" (passed to ExerciseForm)
  const handleAddExercise = (e) => {
    e.preventDefault();
    const cals = parseFloat(sessionStorage.getItem('currentWorkoutCalories')) || 0;
    const exerciseToAdd = { ...newExercise, calories: cals };
    const updatedExercises = [...cumulativeExercises, exerciseToAdd];
    updateCumulativeData(updatedExercises);
    // Reset new exercise form (default sets set to "1")
    setNewExercise({ exerciseType: '', exerciseName: '', weight: '', sets: '1', reps: '' });
    setCurrentCalories(0);
    sessionStorage.removeItem('newExerciseFields');
    sessionStorage.removeItem('currentWorkoutCalories');
  };

  // Handler for "Finish Workout" (passed to ExerciseForm)
  const handleFinishWorkout = (e) => {
    e.preventDefault();
    // Remove any finished flag so we start fresh for this session
    sessionStorage.removeItem('workoutFinished');
    setIsFinished(false);
    setShowSaunaForm(true);
  };

  // Handlers for SaunaForm
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
      sets: '', // not applicable for sauna
      reps: `${safeTime} min`,
      calories: finalCals,
    };
    const updatedExercises = [...cumulativeExercises, saunaEntry];
    updateCumulativeData(updatedExercises);
    // Clear sauna fields
    setSaunaTime('');
    setSaunaTemp('180');
    // Finalize workout
    setShowSaunaForm(false);
    setIsFinished(true);
    sessionStorage.setItem('workoutFinished', 'true');
    sessionStorage.removeItem('saunaTime');
    sessionStorage.removeItem('saunaTemp');
    sessionStorage.removeItem('showSaunaForm');
  };

  const handleSkipSauna = (e) => {
    e.preventDefault();
    setShowSaunaForm(false);
    setIsFinished(true);
    sessionStorage.setItem('workoutFinished', 'true');
    sessionStorage.removeItem('saunaTime');
    sessionStorage.removeItem('saunaTemp');
    sessionStorage.removeItem('showSaunaForm');
  };

  // Handler for removing an individual exercise (passed to WorkoutSummary)
  const handleRemoveExercise = (index) => {
    const updatedExercises = [...cumulativeExercises];
    updatedExercises.splice(index, 1);
    updateCumulativeData(updatedExercises);
  };

  // Handler for clearing all exercises (passed to WorkoutSummary)
  const handleClearAll = () => {
    updateCumulativeData([]);
    localStorage.removeItem('cumulativeWorkoutData');
    sessionStorage.removeItem('workoutFinished');
    setIsFinished(false);
  };

  if (isFinished) {
    return (
      <WorkoutSummary
        cumulativeExercises={cumulativeExercises}
        cumulativeTotal={cumulativeTotal}
        onRemoveExercise={handleRemoveExercise}
        onClearAll={handleClearAll}
      />
    );
  }

  if (showSaunaForm) {
    return (
      <SaunaForm
        saunaTime={saunaTime}
        saunaTemp={saunaTemp}
        setSaunaTime={setSaunaTime}
        setSaunaTemp={setSaunaTemp}
        onAddSauna={handleAddSauna}
        onSkipSauna={handleSkipSauna}
      />
    );
  }

  return (
    <div>
      <h2>Workout Page</h2>
      <p>
        Welcome! You are {userData.age} years old and weigh {userData.weight} lbs.
      </p>
      <div>
        <h3>Cumulative Calories: {cumulativeTotal.toFixed(2)}</h3>
        <WorkoutSummary
          cumulativeExercises={cumulativeExercises}
          cumulativeTotal={cumulativeTotal}
          onRemoveExercise={handleRemoveExercise}
          onClearAll={handleClearAll}
        />
      </div>
      <hr />
      <ExerciseForm
        newExercise={newExercise}
        setNewExercise={setNewExercise}
        currentCalories={currentCalories}
        setCurrentCalories={setCurrentCalories}
        onAddExercise={handleAddExercise}
        onFinishWorkout={handleFinishWorkout}
        exerciseOptions={exerciseOptions}
      />
    </div>
  );
}

export default WorkoutPage;
