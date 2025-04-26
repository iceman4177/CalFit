import React, { useState } from 'react';
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
import useFirstTimeTip from './hooks/useFirstTimeTip';

export default function ExerciseForm({
  newExercise,
  setNewExercise,
  currentCalories,
  onCalculate,
  onAddExercise,
  onDoneWithExercises,
  exerciseOptions
}) {
  // Manual tips + dropdown control
  const [EquipTip, triggerEquipTip]     = useFirstTimeTip('tip_equipment', 'Select equipment first.');
  const [MuscleTip, triggerMuscleTip]   = useFirstTimeTip('tip_muscle', 'Then pick a muscle group.');
  const [ExTip, triggerExTip]           = useFirstTimeTip('tip_exercise', 'Choose an exercise.');
  const [WeightTip, triggerWeightTip]   = useFirstTimeTip('tip_weightField', 'Enter the weight (lbs).');
  const [RepsTip, triggerRepsTip]       = useFirstTimeTip('tip_repsField', 'Enter number of reps.');
  const [SetsTip, triggerSetsTip]       = useFirstTimeTip('tip_setsField', 'Enter number of sets.');
  const [CalcTip, triggerCalcTip]       = useFirstTimeTip('tip_calcBtn', 'Tap to calculate calories.');
  const [AddTip, triggerAddTip]         = useFirstTimeTip('tip_addBtn', 'Tap to add the exercise.');
  const [DoneTip, triggerDoneTip]       = useFirstTimeTip('tip_doneBtn', 'Tap when you’re done.');
  const [equipOpen, setEquipOpen]       = useState(false);
  const [muscleOpen, setMuscleOpen]     = useState(false);
  const [exerciseOpen, setExerciseOpen] = useState(false);

  const handleInputChange = (field, value) =>
    setNewExercise(prev => ({ ...prev, [field]: value }));

  const equipmentTypes = Object.keys(exerciseOptions);
  const muscleGroups = Array.from(new Set(
    equipmentTypes.flatMap(e => Object.keys(exerciseOptions[e]))
  ));
  const exList = newExercise.exerciseType && newExercise.muscleGroup
    ? exerciseOptions[newExercise.exerciseType][newExercise.muscleGroup] || []
    : [];

  return (
    <Box sx={{ maxWidth:600, mx:'auto', mt:2 }}>
      <EquipTip />
      <MuscleTip />
      <ExTip />
      <WeightTip />
      <RepsTip />
      <SetsTip />
      <CalcTip />
      <AddTip />
      <DoneTip />

      <Typography variant="h5" sx={{ mb:2 }}>
        Add New Exercise
      </Typography>

      <FormControl fullWidth sx={{ mb:2 }}>
        <InputLabel id="equipment-label">Equipment Type</InputLabel>
        <MuiSelect
          labelId="equipment-label"
          open={equipOpen}
          onOpen={() => triggerEquipTip(() => setEquipOpen(true))}
          onClose={() => setEquipOpen(false)}
          value={newExercise.exerciseType || ''}
          label="Equipment Type"
          onChange={e => handleInputChange('exerciseType', e.target.value)}
        >
          <MenuItem value=""><em>Select Equipment Type</em></MenuItem>
          {equipmentTypes.map(e => (
            <MenuItem key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</MenuItem>
          ))}
        </MuiSelect>
      </FormControl>

      {newExercise.exerciseType && (
        <FormControl fullWidth sx={{ mb:2 }}>
          <InputLabel id="muscle-group-label">Muscle Group</InputLabel>
          <MuiSelect
            labelId="muscle-group-label"
            open={muscleOpen}
            onOpen={() => triggerMuscleTip(() => setMuscleOpen(true))}
            onClose={() => setMuscleOpen(false)}
            value={newExercise.muscleGroup || ''}
            label="Muscle Group"
            onChange={e => handleInputChange('muscleGroup', e.target.value)}
          >
            <MenuItem value=""><em>Select Muscle Group</em></MenuItem>
            {muscleGroups.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
          </MuiSelect>
        </FormControl>
      )}

      {newExercise.exerciseType && newExercise.muscleGroup && (
        <FormControl fullWidth sx={{ mb:2 }}>
          <InputLabel id="exercise-label">Exercise</InputLabel>
          <MuiSelect
            labelId="exercise-label"
            open={exerciseOpen}
            onOpen={() => triggerExTip(() => setExerciseOpen(true))}
            onClose={() => setExerciseOpen(false)}
            value={newExercise.exerciseName || ''}
            label="Exercise"
            onChange={e => handleInputChange('exerciseName', e.target.value)}
          >
            <MenuItem value=""><em>Select Exercise</em></MenuItem>
            {exList.map(ex => <MenuItem key={ex} value={ex}>{ex}</MenuItem>)}
          </MuiSelect>
        </FormControl>
      )}

      <TextField
        label="Weight (lbs)"
        type="number"
        fullWidth sx={{ mb:2 }}
        value={newExercise.weight || ''}
        onFocus={() => triggerWeightTip()}
        onChange={e => handleInputChange('weight', e.target.value)}
      />
      <TextField
        label="Reps"
        type="number"
        fullWidth sx={{ mb:2 }}
        value={newExercise.reps || ''}
        onFocus={() => triggerRepsTip()}
        onChange={e => handleInputChange('reps', e.target.value)}
      />
      <TextField
        label="Sets"
        type="number"
        fullWidth sx={{ mb:2 }}
        value={newExercise.sets || ''}
        onFocus={() => triggerSetsTip()}
        onChange={e => handleInputChange('sets', e.target.value)}
      />

      <Box sx={{ display:'flex', gap:2, flexWrap:'wrap' }}>
        <Button variant="contained" onClick={() => { triggerCalcTip(); onCalculate(); }}>
          Calculate Calories Burned
        </Button>
        <Button variant="contained" onClick={() => { triggerAddTip(); onAddExercise(); }}>
          Add Exercise
        </Button>
        <Button variant="outlined" onClick={() => { triggerDoneTip(); onDoneWithExercises(); }}>
          Done with Exercises
        </Button>
      </Box>

      <Box sx={{ mt:2 }}>
        <Typography variant="h6">
          New Exercise Calories: {currentCalories.toFixed(2)}
        </Typography>
      </Box>
    </Box>
  );
}
