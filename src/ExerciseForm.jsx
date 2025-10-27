// src/ExerciseForm.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  IconButton,
  Checkbox,
  FormControlLabel,
  Paper,
  Divider,
  Stack
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import useFirstTimeTip from './hooks/useFirstTimeTip';
import { ROM_DEPTH_OPTIONS } from './exerciseConstants';

export default function ExerciseForm({
  newExercise,
  setNewExercise,
  currentCalories,
  onCalculate,
  onAddExercise,
  onDoneWithExercises,
  exerciseOptions
}) {
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

  const [equipOpen,    setEquipOpen]    = useState(false);
  const [muscleOpen,   setMuscleOpen]   = useState(false);
  const [exerciseOpen, setExerciseOpen] = useState(false);
  const [tempoMode,    setTempoMode]    = useState(newExercise.tempoMode || 'hypertrophy');

  const isCardio   = newExercise.exerciseType === 'cardio';
  const isStrength = newExercise.exerciseType && !isCardio;

  const equipmentTypes = useMemo(
    () => ['cardio', ...Object.keys(exerciseOptions).filter(k => k !== 'cardio')],
    [exerciseOptions]
  );
  const cardioMachines = exerciseOptions.cardio;
  const muscleGroups   = useMemo(
    () => (isStrength ? Object.keys(exerciseOptions[newExercise.exerciseType] || {}) : []),
    [isStrength, exerciseOptions, newExercise.exerciseType]
  );
  const exercises = useMemo(
    () =>
      isStrength && newExercise.muscleGroup
        ? exerciseOptions[newExercise.exerciseType][newExercise.muscleGroup]
        : [],
    [isStrength, exerciseOptions, newExercise.exerciseType, newExercise.muscleGroup]
  );

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
      eccentricTime:   '',
      tempoMode:       'hypertrophy',
      wentToFailure: false,
      lastSetPartialReps: 0,
      lastSetPartialDepth: 'HALF'
    });
    triggerEquipTip();
    setEquipOpen(false);
  };
  const handleChange = field => e =>
    setNewExercise(prev => ({ ...prev, [field]: e.target.value }));

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
  }, [newExercise.tempoMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleWentToFailure = (e) => {
    const checked = e.target.checked;
    setNewExercise(prev => ({
      ...prev,
      wentToFailure: checked,
      lastSetPartialReps: checked ? (prev.lastSetPartialReps ?? 0) : 0,
      lastSetPartialDepth: checked ? (prev.lastSetPartialDepth || 'HALF') : 'HALF'
    }));
  };

  const weightRef = useRef(null);
  const repsRef   = useRef(null);
  const setsRef   = useRef(null);

  const onKeyDownNumber = (fnCalc, fnAdd) => (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      triggerAddTip();
      fnAdd();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      triggerCalcTip();
      fnCalc();
    }
  };

  const stickyBar = (
    <Paper
      elevation={0}
      sx={{
        position: 'sticky',
        bottom: 0,
        mt: 2,
        p: 1.5,
        borderRadius: 2,
        border: '1px solid rgba(0,0,0,0.06)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.03)',
        backdropFilter: 'blur(2px)'
      }}
    >
      <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center" flexWrap="wrap">
        <Typography variant="subtitle2" sx={{ opacity: 0.8 }}>
          Calories: <b>{Number.isFinite(currentCalories) ? currentCalories.toFixed(2) : '0.00'}</b>
        </Typography>
        <Stack direction="row" spacing={1} sx={{ width: { xs: '100%', sm: 'auto' } }}>
          {isStrength && (
            <Button
              fullWidth
              variant="outlined"
              onClick={() => { triggerCalcTip(); onCalculate(); }}
            >
              Calculate
            </Button>
          )}
          <Button fullWidth variant="contained" onClick={() => { triggerAddTip(); onAddExercise(); }}>
            Add Exercise
          </Button>
          <Button fullWidth variant="text" onClick={() => { triggerDoneTip(); onDoneWithExercises(); }}>
            Done
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );

  return (
    <Box>
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

      {isCardio && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 700 }}>
            Cardio
          </Typography>
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel id="cardio-label">Cardio Machine</InputLabel>
            <MuiSelect
              labelId="cardio-label"
              onOpen={() => triggerCardioTip()}
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
            inputProps={{ min: 0, step: 'any' }}
            helperText="Enter calories burned manually"
            value={newExercise.manualCalories || ''}
            onFocus={triggerCardioTip}
            onChange={handleChange('manualCalories')}
            onKeyDown={onKeyDownNumber(onCalculate, onAddExercise)}
          />
        </Paper>
      )}

      {isStrength && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 700 }}>
            Strength
          </Typography>

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

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <TextField
              inputRef={weightRef}
              label={weightLabel()}
              helperText={weightHelper()}
              type="number"
              inputProps={{ min: 0, step: 'any' }}
              value={newExercise.weight || ''}
              onFocus={triggerWeightTip}
              onChange={handleChange('weight')}
              onKeyDown={onKeyDownNumber(onCalculate, onAddExercise)}
            />
            <TextField
              inputRef={repsRef}
              label="Reps"
              type="number"
              inputProps={{ min: 0, step: 1 }}
              value={newExercise.reps || ''}
              onFocus={triggerRepsTip}
              onChange={handleChange('reps')}
              onKeyDown={onKeyDownNumber(onCalculate, onAddExercise)}
            />
            <TextField
              inputRef={setsRef}
              label="Sets"
              type="number"
              inputProps={{ min: 1, step: 1 }}
              value={newExercise.sets || ''}
              onFocus={triggerSetsTip}
              onChange={handleChange('sets')}
              onKeyDown={onKeyDownNumber(onCalculate, onAddExercise)}
            />
          </Box>

          <Box sx={{ mt: 2, textAlign: 'center' }}>
            <ToggleButtonGroup value={tempoMode} exclusive onChange={handleTempoChange} sx={{ flexWrap: 'wrap' }}>
              <ToggleButton value="hypertrophy">Hypertrophy</ToggleButton>
              <ToggleButton value="power">Power</ToggleButton>
              <ToggleButton value="slow">Slow</ToggleButton>
              <ToggleButton value="custom">Custom</ToggleButton>
            </ToggleButtonGroup>
            <Tooltip title="Hypertrophy: 1s+3s; Power: 1s+1s; Slow: 3s+3s">
              <IconButton size="small" sx={{ ml: 1 }}>
                <InfoOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>

          {tempoMode === 'custom' && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, mt: 2 }}>
              <TextField
                label="Concentric Time (s)"
                type="number"
                inputProps={{ min: 0, step: 'any' }}
                value={newExercise.concentricTime || ''}
                onFocus={triggerConcTip}
                onChange={handleChange('concentricTime')}
              />
              <TextField
                label="Eccentric Time (s)"
                type="number"
                inputProps={{ min: 0, step: 'any' }}
                value={newExercise.eccentricTime || ''}
                onFocus={triggerEccTip}
                onChange={handleChange('eccentricTime')}
              />
            </Box>
          )}

          <Divider sx={{ my: 2 }} />

          <Box sx={{ mt: 1, mb: 1 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={!!newExercise.wentToFailure}
                  onChange={handleWentToFailure}
                />
              }
              label="Went to failure on last set"
            />
          </Box>

          {newExercise.wentToFailure && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, mb: 1 }}>
              <TextField
                type="number"
                label="Partial reps (last set)"
                inputProps={{ min: 0, step: 1 }}
                value={newExercise.lastSetPartialReps ?? 0}
                onChange={(e) => {
                  const v = Math.max(0, parseInt(e.target.value || '0', 10));
                  setNewExercise(prev => ({ ...prev, lastSetPartialReps: v }));
                }}
              />
              <TextField
                select
                label="Rep depth (last set)"
                value={newExercise.lastSetPartialDepth || 'HALF'}
                onChange={(e) => setNewExercise(prev => ({ ...prev, lastSetPartialDepth: e.target.value }))}
                SelectProps={{ native: true }}
              >
                {ROM_DEPTH_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </TextField>
            </Box>
          )}

          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
            Calorie estimates assume <strong>full range-of-motion (full ROM)</strong> reps unless you specify partial reps on the last set.
          </Typography>
        </Paper>
      )}

      {stickyBar}
    </Box>
  );
}
