import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select as MuiSelect,
  TextField,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  Tooltip
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
  // 1) First-time tips hooks
  const [EquipTip,    triggerEquipTip]    = useFirstTimeTip('tip_equipment',   'Choose your equipment.');
  const [MuscleTip,   triggerMuscleTip]   = useFirstTimeTip('tip_muscle',      'Next, pick a muscle group.');
  const [ExTip,       triggerExTip]       = useFirstTimeTip('tip_exercise',    'Then select an exercise.');
  const [WeightTip,   triggerWeightTip]   = useFirstTimeTip('tip_weightField', 'Enter the weight used (lbs).');
  const [RepsTip,     triggerRepsTip]     = useFirstTimeTip('tip_repsField',   'Enter how many repetitions.');
  const [SetsTip,     triggerSetsTip]     = useFirstTimeTip('tip_setsField',   'Enter number of sets.');
  const [TempoTip,    triggerTempoTip]    = useFirstTimeTip(
    'tip_tempoMode',
    'Standard tempo is 1s concentric + 3s eccentric; switch to Custom to override.'
  );
  const [ConcTip,     triggerConcTip]     = useFirstTimeTip('tip_concentric',  'Enter concentric time per rep (s).');
  const [EccTip,      triggerEccTip]      = useFirstTimeTip('tip_eccentric',   'Enter eccentric time per rep (s).');
  const [CalcTip,     triggerCalcTip]     = useFirstTimeTip('tip_calcBtn',     'Calculate calories burned.');
  const [AddTip,      triggerAddTip]      = useFirstTimeTip('tip_addBtn',      'Add this exercise to your session.');
  const [DoneTip,     triggerDoneTip]     = useFirstTimeTip('tip_doneBtn',     'Finish and view summary.');

  // 2) Dropdown open states (for tips)
  const [equipOpen,    setEquipOpen]       = useState(false);
  const [muscleOpen,   setMuscleOpen]      = useState(false);
  const [exerciseOpen, setExerciseOpen]    = useState(false);

  // 3) Tempo mode local + propagate to parent
  const [tempoMode,    setTempoMode]       = useState(newExercise.tempoMode || 'standard');
  const handleTempoChange = (_e, val) => {
    if (!val) return;
    triggerTempoTip();
    setTempoMode(val);
    setNewExercise(prev => ({ ...prev, tempoMode: val }));
  };

  // 4) Derived option lists
  const equipmentTypes = Object.keys(exerciseOptions);
  const muscleGroups   = Array.from(
    new Set(equipmentTypes.flatMap(e => Object.keys(exerciseOptions[e])))
  );
  const exercises      = newExercise.exerciseType && newExercise.muscleGroup
    ? exerciseOptions[newExercise.exerciseType][newExercise.muscleGroup] || []
    : [];

  // 5) Weight label/helpers
  const isTwoSideMachine =
    newExercise.exerciseType === 'machine' &&
    /press|leg press/i.test(newExercise.exerciseName || '');
  function weightLabel() {
    if (newExercise.exerciseType === 'dumbbell') return 'Weight per Dumbbell (lbs)';
    if (newExercise.exerciseType === 'barbell')  return 'Total Bar Weight (lbs)';
    if (newExercise.exerciseType === 'machine') {
      return isTwoSideMachine
        ? 'Stack Weight per Side (lbs)'
        : 'Stack Weight (lbs)';
    }
    return 'Weight (lbs)';
  }
  function weightHelper() {
    if (newExercise.exerciseType === 'dumbbell')
      return 'Enter the weight of one dumbbell.';
    if (newExercise.exerciseType === 'barbell')
      return 'Enter total weight on the bar (plates + bar).';
    if (newExercise.exerciseType === 'machine')
      return isTwoSideMachine
        ? 'Enter weight on one side of the stack.'
        : 'Enter total stack weight.';
    return '';
  }

  // 6) Generic change
  const handleChange = field => e =>
    setNewExercise(prev => ({ ...prev, [field]: e.target.value }));

  // 7) Keep local tempoMode in sync if parent resets (e.g. after Add)
  useEffect(() => {
    if (newExercise.tempoMode && newExercise.tempoMode !== tempoMode) {
      setTempoMode(newExercise.tempoMode);
    }
  }, [newExercise.tempoMode]);

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto', mt: 2 }}>
      {/* First-time tips */}
      <EquipTip />
      <MuscleTip />
      <ExTip />
      <WeightTip />
      <RepsTip />
      <SetsTip />
      <TempoTip />
      <ConcTip />
      <EccTip />
      <CalcTip />
      <AddTip />
      <DoneTip />

      <Typography variant="h5" align="center" sx={{ mb: 2 }}>
        Add New Exercise
      </Typography>

      {/* Equipment Type */}
      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel id="equip-label">Equipment Type</InputLabel>
        <MuiSelect
          labelId="equip-label"
          open={equipOpen}
          onOpen={() => triggerEquipTip(() => setEquipOpen(true))}
          onClose={() => setEquipOpen(false)}
          value={newExercise.exerciseType || ''}
          label="Equipment Type"
          onChange={handleChange('exerciseType')}
        >
          <MenuItem value=""><em>Select Equipment</em></MenuItem>
          {equipmentTypes.map(e => (
            <MenuItem key={e} value={e}>
              {e.charAt(0).toUpperCase() + e.slice(1)}
            </MenuItem>
          ))}
        </MuiSelect>
      </FormControl>

      {/* Muscle Group */}
      {newExercise.exerciseType && (
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel id="muscle-label">Muscle Group</InputLabel>
          <MuiSelect
            labelId="muscle-label"
            open={muscleOpen}
            onOpen={() => triggerMuscleTip(() => setMuscleOpen(true))}
            onClose={() => setMuscleOpen(false)}
            value={newExercise.muscleGroup || ''}
            label="Muscle Group"
            onChange={handleChange('muscleGroup')}
          >
            <MenuItem value=""><em>Select Muscle</em></MenuItem>
            {muscleGroups.map(m => (
              <MenuItem key={m} value={m}>{m}</MenuItem>
            ))}
          </MuiSelect>
        </FormControl>
      )}

      {/* Exercise */}
      {newExercise.exerciseType && newExercise.muscleGroup && (
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel id="exercise-label">Exercise</InputLabel>
          <MuiSelect
            labelId="exercise-label"
            open={exerciseOpen}
            onOpen={() => triggerExTip(() => setExerciseOpen(true))}
            onClose={() => setExerciseOpen(false)}
            value={newExercise.exerciseName || ''}
            label="Exercise"
            onChange={handleChange('exerciseName')}
          >
            <MenuItem value=""><em>Select Exercise</em></MenuItem>
            {exercises.map(x => (
              <MenuItem key={x} value={x}>{x}</MenuItem>
            ))}
          </MuiSelect>
        </FormControl>
      )}

      {/* Weight */}
      <TextField
        label={weightLabel()}
        type="number"
        fullWidth
        sx={{ mb: 2 }}
        value={newExercise.weight || ''}
        onFocus={() => triggerWeightTip()}
        onChange={handleChange('weight')}
        helperText={weightHelper()}
      />

      {/* Reps */}
      <TextField
        label="Reps"
        type="number"
        fullWidth
        sx={{ mb: 2 }}
        value={newExercise.reps || ''}
        onFocus={() => triggerRepsTip()}
        onChange={handleChange('reps')}
      />

      {/* Sets */}
      <TextField
        label="Sets"
        type="number"
        fullWidth
        sx={{ mb: 3 }}
        value={newExercise.sets || ''}
        onFocus={() => triggerSetsTip()}
        onChange={handleChange('sets')}
      />

      {/* Tempo Toggle */}
      <Box sx={{ mb: 2, textAlign: 'center' }}>
        <Tooltip title="Standard: 1s concentric + 3s eccentric. Custom: choose your own.">
          <ToggleButtonGroup
            value={tempoMode}
            exclusive
            onChange={handleTempoChange}
          >
            <ToggleButton value="standard">Standard Tempo</ToggleButton>
            <ToggleButton value="custom">Custom Tempo</ToggleButton>
          </ToggleButtonGroup>
        </Tooltip>
      </Box>

      {/* Custom Tempo Inputs */}
      {tempoMode === 'custom' && (
        <>
          <TextField
            label="Concentric Time per Rep (s)"
            type="number"
            fullWidth
            sx={{ mb: 2 }}
            value={newExercise.concentricTime || ''}
            onFocus={() => triggerConcTip()}
            onChange={handleChange('concentricTime')}
            helperText="Time lifting the weight"
          />
          <TextField
            label="Eccentric Time per Rep (s)"
            type="number"
            fullWidth
            sx={{ mb: 3 }}
            value={newExercise.eccentricTime || ''}
            onFocus={() => triggerEccTip()}
            onChange={handleChange('eccentricTime')}
            helperText="Time lowering the weight"
          />
        </>
      )}

      {/* Action Buttons */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Button
          variant="contained"
          onClick={() => { triggerCalcTip(); onCalculate(); }}
        >
          Calculate Calories
        </Button>
        <Button
          variant="contained"
          onClick={() => { triggerAddTip(); onAddExercise(); }}
        >
          Add Exercise
        </Button>
        <Button
          variant="outlined"
          onClick={() => { triggerDoneTip(); onDoneWithExercises(); }}
        >
          Done
        </Button>
      </Box>

      {/* Display current calories */}
      <Typography variant="h6" align="center">
        Calories: {currentCalories.toFixed(2)}
      </Typography>
    </Box>
  );
}
