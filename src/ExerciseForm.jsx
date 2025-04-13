import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select as MuiSelect,
  TextField,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
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
  // Helper popups for fields
  const [showEquipmentHelp, setShowEquipmentHelp] = useState(false);
  const [showMuscleHelp, setShowMuscleHelp] = useState(false);
  const [showExerciseHelp, setShowExerciseHelp] = useState(false);
  // Remove the combined weight & reps popup and use separate ones:
  const [showWeightHelp, setShowWeightHelp] = useState(false);
  const [showRepsHelp, setShowRepsHelp] = useState(false);

  // Helper popups for buttons
  const [showCalcHelp, setShowCalcHelp] = useState(false);
  const [showAddHelp, setShowAddHelp] = useState(false);
  const [showDoneHelp, setShowDoneHelp] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('hasSeenEquipmentHelp')) {
      setShowEquipmentHelp(true);
    }
  }, []);

  const handleDismiss = (key, setter) => {
    localStorage.setItem(key, 'true');
    setter(false);
  };

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

  // Helper text for weight (if needed)
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

  // Handlers for buttons with helper popups
  const handleCalculateClick = () => {
    if (!localStorage.getItem('hasSeenCalcHelp')) {
      setShowCalcHelp(true);
    } else {
      onCalculate();
    }
  };

  const handleAddClick = () => {
    if (!localStorage.getItem('hasSeenAddHelp')) {
      setShowAddHelp(true);
      return;
    }
    onAddExercise();
  };

  const handleDoneClick = () => {
    if (!localStorage.getItem('hasSeenDoneHelp')) {
      setShowDoneHelp(true);
      return;
    }
    onDoneWithExercises();
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
          onChange={(e) => {
            handleInputChange('exerciseType', e.target.value);
            if (!localStorage.getItem('hasSeenMuscleHelp')) setShowMuscleHelp(true);
          }}
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
            onChange={(e) => {
              handleInputChange('muscleGroup', e.target.value);
              if (!localStorage.getItem('hasSeenExerciseHelp')) setShowExerciseHelp(true);
            }}
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

      {/* Weight Input with separate helper popup */}
      <TextField
        label="Weight (lbs)"
        type="number"
        value={newExercise.weight || ''}
        onFocus={() => {
          if (!localStorage.getItem('hasSeenWeightFieldHelp')) {
            setShowWeightHelp(true);
          }
        }}
        onChange={(e) => handleInputChange('weight', e.target.value)}
        fullWidth
        sx={{ mb: 2 }}
        helperText={getWeightHelperText()}
      />

      {/* Reps Input with separate helper popup */}
      <TextField
        label="Reps"
        type="number"
        value={newExercise.reps || ''}
        onFocus={() => {
          if (!localStorage.getItem('hasSeenRepsFieldHelp')) {
            setShowRepsHelp(true);
          }
        }}
        onChange={(e) => handleInputChange('reps', e.target.value)}
        fullWidth
        sx={{ mb: 2 }}
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

      {/* Action Buttons with Helper Popups */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Button variant="contained" onClick={handleCalculateClick}>
          Calculate Calories Burned
        </Button>
        <Button variant="contained" onClick={handleAddClick}>
          Add Exercise
        </Button>
        <Button variant="outlined" onClick={handleDoneClick}>
          Done with Exercises
        </Button>
      </Box>

      <Box sx={{ mt: 2 }}>
        <Typography variant="h6">
          New Exercise Calories: {currentCalories.toFixed(2)}
        </Typography>
      </Box>

      {/* Field Helper Popups */}
      <Dialog open={showEquipmentHelp} onClose={() => handleDismiss('hasSeenEquipmentHelp', setShowEquipmentHelp)}>
        <DialogTitle>Choose Equipment Type</DialogTitle>
        <DialogContent>
          This helps narrow down the exercise options you’ll see next.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => handleDismiss('hasSeenEquipmentHelp', setShowEquipmentHelp)}>Got it</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={showMuscleHelp} onClose={() => handleDismiss('hasSeenMuscleHelp', setShowMuscleHelp)}>
        <DialogTitle>Select a Muscle Group</DialogTitle>
        <DialogContent>
          Choose which muscle you're targeting for this workout. Exercises will update based on your selection.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => handleDismiss('hasSeenMuscleHelp', setShowMuscleHelp)}>Got it</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={showExerciseHelp} onClose={() => handleDismiss('hasSeenExerciseHelp', setShowExerciseHelp)}>
        <DialogTitle>Pick Your Exercise</DialogTitle>
        <DialogContent>
          Choose a specific movement from the list based on your equipment and muscle group.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => handleDismiss('hasSeenExerciseHelp', setShowExerciseHelp)}>Got it</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={showWeightHelp} onClose={() => handleDismiss('hasSeenWeightFieldHelp', setShowWeightHelp)}>
        <DialogTitle>Enter Your Weight</DialogTitle>
        <DialogContent>
          Provide the weight in pounds for your exercise. This is used to calculate calories burned.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => handleDismiss('hasSeenWeightFieldHelp', setShowWeightHelp)}>Got it</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={showRepsHelp} onClose={() => handleDismiss('hasSeenRepsFieldHelp', setShowRepsHelp)}>
        <DialogTitle>Enter Number of Reps</DialogTitle>
        <DialogContent>
          Enter the number of repetitions you performed. This value, along with weight and sets, is used to estimate calories burned.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => handleDismiss('hasSeenRepsFieldHelp', setShowRepsHelp)}>Got it</Button>
        </DialogActions>
      </Dialog>

      {/* Button Helper Popups */}
      <Dialog open={showCalcHelp} onClose={() => handleDismiss('hasSeenCalcHelp', setShowCalcHelp)}>
        <DialogTitle>Calculate Calories</DialogTitle>
        <DialogContent>
          This estimates how many calories you’ll burn based on your sets, reps, and weight.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { handleDismiss('hasSeenCalcHelp', setShowCalcHelp); onCalculate(); }}>Got it</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={showAddHelp} onClose={() => handleDismiss('hasSeenAddHelp', setShowAddHelp)}>
        <DialogTitle>Add Exercise</DialogTitle>
        <DialogContent>
          This adds your selected exercise and its calorie burn to your workout session.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { handleDismiss('hasSeenAddHelp', setShowAddHelp); onAddExercise(); }}>Got it</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={showDoneHelp} onClose={() => handleDismiss('hasSeenDoneHelp', setShowDoneHelp)}>
        <DialogTitle>Done with Exercises</DialogTitle>
        <DialogContent>
          Finalize your exercise entries and move to the next step.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { handleDismiss('hasSeenDoneHelp', setShowDoneHelp); onDoneWithExercises(); }}>Got it</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ExerciseForm;
