// ExerciseForm.jsx
import React from 'react';
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
  onCalculate,
  onAddExercise,
  onDoneWithExercises,
  exerciseOptions
}) => {
  const handleInputChange = (field, value) => {
    setNewExercise((prev) => ({ ...prev, [field]: value }));
  };

  const getEquipmentTypes = () => Object.keys(exerciseOptions);

  const getMuscleGroups = () => {
    const groupsSet = new Set();
    Object.keys(exerciseOptions).forEach((equipment) => {
      Object.keys(exerciseOptions[equipment]).forEach((group) => groupsSet.add(group));
    });
    return Array.from(groupsSet);
  };

  const getExercisesForSelection = () => {
    if (!newExercise.exerciseType || !newExercise.muscleGroup) return [];
    return exerciseOptions[newExercise.exerciseType][newExercise.muscleGroup] || [];
  };

  // Provide dynamic helper text based on the selected exercise type and name.
  const getWeightHelperText = () => {
    if (newExercise.exerciseType === 'dumbbell') {
      return 'Enter weight per dumbbell';
    }
    if (
      newExercise.exerciseName &&
      newExercise.exerciseName.toLowerCase().includes('leg press')
    ) {
      return 'Enter total weight loaded (both sides)';
    }
    return '';
  };

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto', mt: 2 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Add New Exercise
      </Typography>

      {/* Equipment Type Selection */}
      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel id="equipment-label">Equipment Type</InputLabel>
        <MuiSelect
          labelId="equipment-label"
          value={newExercise.exerciseType || ''}
          label="Equipment Type"
          onChange={(e) => handleInputChange('exerciseType', e.target.value)}
        >
          <MenuItem value="">
            <em>Select Equipment Type</em>
          </MenuItem>
          {getEquipmentTypes().map((equipment) => (
            <MenuItem key={equipment} value={equipment}>
              {equipment.charAt(0).toUpperCase() + equipment.slice(1)}
            </MenuItem>
          ))}
        </MuiSelect>
      </FormControl>

      {/* Muscle Group Selection */}
      {newExercise.exerciseType && (
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel id="muscle-group-label">Muscle Group</InputLabel>
          <MuiSelect
            labelId="muscle-group-label"
            value={newExercise.muscleGroup || ''}
            label="Muscle Group"
            onChange={(e) => handleInputChange('muscleGroup', e.target.value)}
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
      )}

      {/* Exercise Selection */}
      {newExercise.muscleGroup && newExercise.exerciseType && (
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel id="exercise-label">Exercise</InputLabel>
          <MuiSelect
            labelId="exercise-label"
            value={newExercise.exerciseName || ''}
            label="Exercise"
            onChange={(e) => handleInputChange('exerciseName', e.target.value)}
          >
            <MenuItem value="">
              <em>Select an Exercise</em>
            </MenuItem>
            {getExercisesForSelection().map((exercise) => (
              <MenuItem key={exercise} value={exercise}>
                {exercise}
              </MenuItem>
            ))}
          </MuiSelect>
        </FormControl>
      )}

      {/* Weight Input with dynamic helper text */}
      <TextField
        label="Weight (lbs)"
        type="number"
        value={newExercise.weight || ''}
        onChange={(e) => handleInputChange('weight', e.target.value)}
        fullWidth
        sx={{ mb: 2 }}
        helperText={getWeightHelperText()}
      />

      {/* Sets Input */}
      <TextField
        label="Sets"
        type="number"
        value={newExercise.sets || ''}
        onChange={(e) => handleInputChange('sets', e.target.value)}
        fullWidth
        sx={{ mb: 2 }}
      />

      {/* Reps Input */}
      <TextField
        label="Reps"
        type="number"
        value={newExercise.reps || ''}
        onChange={(e) => handleInputChange('reps', e.target.value)}
        fullWidth
        sx={{ mb: 2 }}
      />

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Button variant="contained" onClick={onCalculate}>
          Calculate Calories Burned
        </Button>
        <Button variant="contained" onClick={onAddExercise}>
          Add Exercise
        </Button>
        <Button variant="outlined" onClick={onDoneWithExercises}>
          Done with Exercises
        </Button>
      </Box>

      <Box sx={{ mt: 2 }}>
        <Typography variant="h6">
          New Exercise Calories: {currentCalories.toFixed(2)}
        </Typography>
      </Box>
    </Box>
  );
};

export default ExerciseForm;
