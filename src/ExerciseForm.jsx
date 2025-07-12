// src/ExerciseForm.jsx
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
  Tooltip,
  IconButton
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
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
  // First-time tips
  const [EquipTip,    triggerEquipTip]    = useFirstTimeTip('tip_equipment',   'Choose your equipment.');
  const [CardioTip,   triggerCardioTip]   = useFirstTimeTip('tip_cardioCal',   'Enter calories burned manually.');
  const [MuscleTip,   triggerMuscleTip]   = useFirstTimeTip('tip_muscle',      'Pick a muscle group.');
  const [ExTip,       triggerExTip]       = useFirstTimeTip('tip_exercise',    'Then select a specific exercise.');
  const [WeightTip,   triggerWeightTip]   = useFirstTimeTip('tip_weightField', 'Enter the weight used (lbs).');
  const [RepsTip,     triggerRepsTip]     = useFirstTimeTip('tip_repsField',   'Enter how many reps.');
  const [SetsTip,     triggerSetsTip]     = useFirstTimeTip('tip_setsField',   'Enter number of sets.');
  const [TempoTip,    triggerTempoTip]    = useFirstTimeTip('tip_tempoMode',   'Presets: Hypertrophy (1s+3s), Power (1s+1s), Slow (3s+3s).');
  const [ConcTip,     triggerConcTip]     = useFirstTimeTip('tip_concentric',  'Time lifting per rep (s).');
  const [EccTip,      triggerEccTip]      = useFirstTimeTip('tip_eccentric',   'Time lowering per rep (s).');
  const [CalcTip,     triggerCalcTip]     = useFirstTimeTip('tip_calcBtn',     'Calculate calories burned.');
  const [AddTip,      triggerAddTip]      = useFirstTimeTip('tip_addBtn',      'Add this exercise.');
  const [DoneTip,     triggerDoneTip]     = useFirstTimeTip('tip_doneBtn',     'Finish and view summary.');

  // Local state
  const [equipOpen,    setEquipOpen]    = useState(false);
  const [muscleOpen,   setMuscleOpen]   = useState(false);
  const [exerciseOpen, setExerciseOpen] = useState(false);
  const [tempoMode,    setTempoMode]    = useState(newExercise.tempoMode || 'hypertrophy');

  const isCardio   = newExercise.exerciseType === 'cardio';
  const isStrength = newExercise.exerciseType && !isCardio;

  // Derive lists
  const equipmentTypes = ['cardio', ...Object.keys(exerciseOptions).filter(k => k !== 'cardio')];
  const cardioMachines = exerciseOptions.cardio;
  const muscleGroups   = isStrength
    ? Object.keys(exerciseOptions[newExercise.exerciseType] || {})
    : [];
  const exercises      = isStrength && newExercise.muscleGroup
    ? exerciseOptions[newExercise.exerciseType][newExercise.muscleGroup]
    : [];

  // Helpers for weight field
  function weightLabel() {
    if (newExercise.exerciseType === 'dumbbell') return 'Weight per Dumbbell (lbs)';
    if (newExercise.exerciseType === 'barbell')  return 'Total Bar Weight (lbs)';
    if (newExercise.exerciseType === 'machine') {
      return /press|leg press/i.test(newExercise.exerciseName || '')
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
      return /press|leg press/i.test(newExercise.exerciseName || '')
        ? 'Enter weight on one side of the stack.'
        : 'Enter total stack weight.';
    return '';
  }

  // Change handlers
  const handleEquipChange = e => {
    const eq = e.target.value;
    setNewExercise({
      exerciseType:    eq,
      cardioType:      '',
      manualCalories:  '',
      muscleGroup:     '',
      exerciseName:    '',
      weight:          '',
      sets:            '1',
      reps:            '',
      concentricTime:  '',
      eccentricTime:   ''
    });
    triggerEquipTip();
    setEquipOpen(false);
  };
  const handleChange = field => e =>
    setNewExercise(prev => ({ ...prev, [field]: e.target.value }));

  // Tempo presets
  const handleTempoChange = (_e, val) => {
    if (!val) return;
    triggerTempoTip();
    setTempoMode(val);
    const presets = {
      hypertrophy: { concentricTime: '1', eccentricTime: '3' },
      power:       { concentricTime: '1', eccentricTime: '1' },
      slow:        { concentricTime: '3', eccentricTime: '3' }
    };
    setNewExercise(prev => ({
      ...prev,
      tempoMode: val,
      ...(val !== 'custom' ? presets[val] : {})
    }));
  };
  useEffect(() => {
    if (newExercise.tempoMode && newExercise.tempoMode !== tempoMode) {
      setTempoMode(newExercise.tempoMode);
    }
  }, [newExercise.tempoMode]);

  return (
    <Box>
      {/* First-time tips */}
      <EquipTip />
      {isCardio   && <CardioTip />}
      {isStrength && <MuscleTip />}
      {isStrength && <ExTip />}
      {isStrength && <WeightTip />}
      {isStrength && <RepsTip />}
      {isStrength && <SetsTip />}
      {isStrength && <TempoTip />}
      {isStrength && <ConcTip />}
      {isStrength && <EccTip />}
      <CalcTip />
      <AddTip />
      <DoneTip />

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
          onChange={handleEquipChange}
        >
          <MenuItem value=""><em>Select Equipment</em></MenuItem>
          {equipmentTypes.map(type => (
            <MenuItem key={type} value={type}>
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </MenuItem>
          ))}
        </MuiSelect>
      </FormControl>

      {/* Cardio Section */}
      {isCardio && (
        <Box sx={{ mb: 3 }}>
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel id="cardio-label">Cardio Machine</InputLabel>
            <MuiSelect
              labelId="cardio-label"
              onOpen={() => triggerCardioTip()}
              onClose={() => {}}
              value={newExercise.cardioType || ''}
              label="Cardio Machine"
              onChange={handleChange('cardioType')}
            >
              <MenuItem value=""><em>Select Machine</em></MenuItem>
              {cardioMachines.map(m => (
                <MenuItem key={m} value={m}>{m}</MenuItem>
              ))}
            </MuiSelect>
          </FormControl>

          <TextField
            label="Calories Burned (kcal)"
            type="number"
            fullWidth
            helperText="Enter calories burned manually"
            value={newExercise.manualCalories || ''}
            onFocus={triggerCardioTip}
            onChange={handleChange('manualCalories')}
          />
        </Box>
      )}

      {/* Strength Section */}
      {isStrength && (
        <>
          {/* Muscle Group */}
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

          {/* Exercise Name */}
          {newExercise.muscleGroup && (
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

          {/* Weight / Reps / Sets */}
          <TextField
            label={weightLabel()}
            helperText={weightHelper()}
            type="number"
            fullWidth
            sx={{ mb: 2 }}
            value={newExercise.weight || ''}
            onFocus={triggerWeightTip}
            onChange={handleChange('weight')}
          />
          <TextField
            label="Reps"
            type="number"
            fullWidth
            sx={{ mb: 2 }}
            value={newExercise.reps || ''}
            onFocus={triggerRepsTip}
            onChange={handleChange('reps')}
          />
          <TextField
            label="Sets"
            type="number"
            fullWidth
            sx={{ mb: 3 }}
            value={newExercise.sets || ''}
            onFocus={triggerSetsTip}
            onChange={handleChange('sets')}
          />

          {/* Tempo Presets */}
          <Box sx={{ mb: 2, textAlign: 'center' }}>
            <ToggleButtonGroup value={tempoMode} exclusive onChange={handleTempoChange}>
              <ToggleButton value="hypertrophy">Hypertrophy</ToggleButton>
              <ToggleButton value="power">Power</ToggleButton>
              <ToggleButton value="slow">Slow</ToggleButton>
              <ToggleButton value="custom">Custom</ToggleButton>
            </ToggleButtonGroup>
            <Tooltip title="Hypertrophy: 1s+3s; Power: 1s+1s; Slow: 3s+3s">
              <IconButton size="small">
                <InfoOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>

          {/* Custom Tempo */}
          {tempoMode === 'custom' && (
            <>
              <TextField
                label="Concentric Time (s)"
                type="number"
                fullWidth
                sx={{ mb: 2 }}
                value={newExercise.concentricTime || ''}
                onFocus={triggerConcTip}
                onChange={handleChange('concentricTime')}
              />
              <TextField
                label="Eccentric Time (s)"
                type="number"
                fullWidth
                sx={{ mb: 3 }}
                value={newExercise.eccentricTime || ''}
                onFocus={triggerEccTip}
                onChange={handleChange('eccentricTime')}
              />
            </>
          )}
        </>
      )}

      {/* Action Buttons */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        {isStrength && (
          <Button variant="contained" onClick={() => { triggerCalcTip(); onCalculate(); }}>
            Calculate Calories
          </Button>
        )}
        <Button variant="contained" onClick={() => { triggerAddTip(); onAddExercise(); }}>
          Add Exercise
        </Button>
        <Button variant="outlined" onClick={() => { triggerDoneTip(); onDoneWithExercises(); }}>
          Done
        </Button>
      </Box>

      {/* Display Current Calculated Calories */}
      <Typography variant="h6" align="center">
        Calories: {currentCalories.toFixed(2)}
      </Typography>
    </Box>
  );
}
