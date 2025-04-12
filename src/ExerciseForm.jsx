import React from 'react';
import {
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select as MuiSelect,
  TextField,
  Typography,
  Tooltip
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
        <Tooltip title="Choose the type of equipment you're using (e.g. machine, dumbbell, barbell)">
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
        </Tooltip>
      </FormControl>

      {/* Muscle Group Selection */}
      {newExercise.exerciseType && (
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel id="muscle-group-label">Muscle Group</InputLabel>
          <Tooltip title="Pick the muscle group you're targeting (e.g. chest, legs)">
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
          </Tooltip>
        </FormControl>
      )}

      {/* Exercise Selection */}
      {newExercise.muscleGroup && newExercise.exerciseType && (
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel id="exercise-label">Exercise</InputLabel>
          <Tooltip title="Choose a specific exercise from the selected group and equipment">
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
          </Tooltip>
        </FormControl>
      )}

      {/* Weight Input */}
      <Tooltip title="Enter the amount of weight used per set (in pounds)">
        <TextField
          label="Weight (lbs)"
          type="number"
          value={newExercise.weight || ''}
          onChange={(e) => handleInputChange('weight', e.target.value)}
          fullWidth
          sx={{ mb: 2 }}
          helperText={getWeightHelperText()}
        />
      </Tooltip>

      {/* Sets Input */}
      <Tooltip title="How many sets you completed for this exercise">
        <TextField
          label="Sets"
          type="number"
          value={newExercise.sets || ''}
          onChange={(e) => handleInputChange('sets', e.target.value)}
          fullWidth
          sx={{ mb: 2 }}
        />
      </Tooltip>

      {/* Reps Input */}
      <Tooltip title="How many repetitions per set you performed">
        <TextField
          label="Reps"
          type="number"
          value={newExercise.reps || ''}
          onChange={(e) => handleInputChange('reps', e.target.value)}
          fullWidth
          sx={{ mb: 2 }}
        />
      </Tooltip>

      {/* Buttons */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Tooltip title="Estimate how many calories this exercise will burn">
          <Button variant="contained" onClick={onCalculate}>
            Calculate Calories Burned
          </Button>
        </Tooltip>
        <Tooltip title="Add this exercise to your workout list">
          <Button variant="contained" onClick={onAddExercise}>
            Add Exercise
          </Button>
        </Tooltip>
        <Tooltip title="Move on to the sauna session (optional)">
          <Button variant="outlined" onClick={onDoneWithExercises}>
            Done with Exercises
          </Button>
        </Tooltip>
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
