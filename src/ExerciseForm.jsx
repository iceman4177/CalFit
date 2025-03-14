import React, { useState, useEffect } from 'react';
import Select from 'react-select';
import {
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select as MuiSelect,
  TextField,
  Typography
} from '@mui/material';

const ExerciseForm = ({
  newExercise,
  setNewExercise,
  currentCalories,
  setCurrentCalories,
  onAddExercise,
  onFinishWorkout,
  exerciseOptions
}) => {
  // Local state to manage the chosen muscle group
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState('');

  // Persist currentCalories to sessionStorage
  useEffect(() => {
    sessionStorage.setItem('currentWorkoutCalories', currentCalories.toString());
  }, [currentCalories]);

  // When the muscle group changes, clear the chosen exercise and equipment info
  useEffect(() => {
    setNewExercise({ ...newExercise, exerciseName: '', equipment: '' });
  }, [selectedMuscleGroup]);

  // Helper: Calculate calories for the new exercise (including sets)
  const calculateCalories = (exercise) => {
    const w = parseFloat(exercise.weight) || 0;
    const s = parseInt(exercise.sets) || 1; // default to 1 if not provided
    const r = parseInt(exercise.reps) || 0;
    let cals = w * s * r * 0.05;
    if (exercise.equipment === 'machine') {
      cals *= 1.5;
    } else if (exercise.equipment === 'dumbbell' || exercise.equipment === 'barbell') {
      cals *= 1.2;
    }
    return cals;
  };

  const handleCalculate = (e) => {
    e.preventDefault();
    const cals = calculateCalories(newExercise);
    setCurrentCalories(cals);
  };

  // Get the unique muscle groups from the grouped exerciseOptions across equipment types
  const getMuscleGroups = () => {
    if (!exerciseOptions) return [];
    const groupsSet = new Set();
    Object.keys(exerciseOptions).forEach((equipment) => {
      Object.keys(exerciseOptions[equipment]).forEach((group) => {
        groupsSet.add(group);
      });
    });
    return Array.from(groupsSet);
  };

  // Merge exercises from all equipment types for the selected muscle group.
  // Each option includes the exercise name and its equipment.
  const getExercisesForMuscleGroup = (muscleGroup) => {
    let merged = [];
    Object.keys(exerciseOptions).forEach((equipment) => {
      if (exerciseOptions[equipment][muscleGroup]) {
        merged = merged.concat(
          exerciseOptions[equipment][muscleGroup].map((ex) => ({
            label: `${ex} (${equipment})`,
            value: ex,
            equipment: equipment
          }))
        );
      }
    });
    return merged;
  };

  // Options for react-select for exercises
  const exerciseSelectOptions = selectedMuscleGroup
    ? getExercisesForMuscleGroup(selectedMuscleGroup)
    : [];

  // Determine weight label based on selected exercise's equipment
  const weightLabel =
    newExercise.equipment === 'dumbbell'
      ? 'Weight (lbs per dumbbell):'
      : 'Weight (lbs):';

  // When an exercise is selected from the dropdown, store both its name and equipment.
  const handleExerciseSelectChange = (selectedOption) => {
    setNewExercise({
      ...newExercise,
      exerciseName: selectedOption.value,
      equipment: selectedOption.equipment
    });
  };

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto', mt: 2 }}>
      <h3>Add New Exercise</h3>
      <form>
        {/* Step 1: Muscle Group Selection */}
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel id="muscle-group-label">Muscle Group</InputLabel>
          <MuiSelect
            labelId="muscle-group-label"
            value={selectedMuscleGroup}
            label="Muscle Group"
            onChange={(e) => setSelectedMuscleGroup(e.target.value)}
            required
          >
            <MenuItem value="">
              <em>Select Muscle Group</em>
            </MenuItem>
            {getMuscleGroups().map((group) => (
              <MenuItem key={group} value={group}>
                {group}
              </MenuItem>
            ))}
          </MuiSelect>
        </FormControl>

        {/* Step 2: Exercise Selection */}
        {selectedMuscleGroup && (
          <FormControl fullWidth sx={{ mb: 2 }}>
            {/* Use Typography as a label to avoid overlapping */}
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              Select Exercise
            </Typography>
            <Select
              value={
                newExercise.exerciseName
                  ? {
                      label: `${newExercise.exerciseName} (${newExercise.equipment})`,
                      value: newExercise.exerciseName
                    }
                  : null
              }
              onChange={handleExerciseSelectChange}
              options={exerciseSelectOptions}
              placeholder="Search and select exercise"
              isSearchable
              required
            />
          </FormControl>
        )}

        {/* Weight Input */}
        <TextField
          label={weightLabel}
          type="number"
          value={newExercise.weight}
          onChange={(e) => setNewExercise({ ...newExercise, weight: e.target.value })}
          fullWidth
          sx={{ mb: 2 }}
          required
        />

        {/* Sets Input */}
        <TextField
          label="Sets"
          type="number"
          value={newExercise.sets}
          onChange={(e) => setNewExercise({ ...newExercise, sets: e.target.value })}
          fullWidth
          sx={{ mb: 2 }}
          required
        />

        {/* Reps Input */}
        <TextField
          label="Reps"
          type="number"
          value={newExercise.reps}
          onChange={(e) => setNewExercise({ ...newExercise, reps: e.target.value })}
          fullWidth
          sx={{ mb: 2 }}
          required
        />

        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button variant="contained" onClick={handleCalculate}>
            Calculate Calories Burned
          </Button>
          <Button variant="contained" onClick={onAddExercise}>
            Add Exercise
          </Button>
          <Button variant="outlined" onClick={onFinishWorkout}>
            Finish Workout
          </Button>
        </Box>
      </form>

      <Box sx={{ mt: 2 }}>
        <h3>New Exercise Calories: {currentCalories.toFixed(2)}</h3>
      </Box>
    </Box>
  );
};

export default ExerciseForm;
