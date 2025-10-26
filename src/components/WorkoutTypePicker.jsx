// src/components/WorkoutTypePicker.jsx
import React, { useMemo } from 'react';
import { ToggleButton, ToggleButtonGroup, Box, Typography } from '@mui/material';

function optionsForIntent(intent = 'general') {
  const i = String(intent || 'general').toLowerCase();

  // Each option = { label, value } where value matches backend "focus"
  const COMMON = [
    { label: 'Upper', value: 'upper' },
    { label: 'Lower', value: 'lower' },
    { label: 'Full Body', value: 'full' },
  ];

  const BODYBUILDER = [
    { label: 'Chest & Back', value: 'chest_back' },
    { label: 'Shoulders & Arms', value: 'shoulders_arms' },
    { label: 'Legs', value: 'legs' },
    { label: 'Glutes & Hamstrings', value: 'glutes_hamstrings' },
    { label: 'Quads & Calves', value: 'quads_calves' },
  ];

  const POWERLIFTER = [
    { label: 'Push', value: 'push' },
    { label: 'Pull', value: 'pull' },
    { label: 'Legs', value: 'legs' },
    // keep the basics too
    ...COMMON,
  ];

  const ENDURANCE = [
    { label: 'Full Body', value: 'full' },
    { label: 'Upper', value: 'upper' },
    { label: 'Lower', value: 'lower' },
    { label: 'Cardio', value: 'cardio' },
  ];

  const YOGA_PILATES = [
    { label: 'Full Body (Mobility)', value: 'full' },
    { label: 'Upper (Mobility)', value: 'upper' },
    { label: 'Lower (Mobility)', value: 'lower' },
  ];

  switch (i) {
    case 'bodybuilder':    return [...BODYBUILDER, ...COMMON];
    case 'powerlifter':    return POWERLIFTER;
    case 'endurance':      return ENDURANCE;
    case 'yoga_pilates':   return YOGA_PILATES;
    default:               return COMMON;
  }
}

export default function WorkoutTypePicker({ intent = 'general', value, onChange }) {
  const options = useMemo(() => optionsForIntent(intent), [intent]);

  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Today's workout</Typography>
      <ToggleButtonGroup
        value={value}
        exclusive
        onChange={(_, v) => { if (v) onChange?.(v); }}
        size="small"
        sx={{
          flexWrap: 'wrap',
          '& .MuiToggleButton-root': { m: 0.5, px: 1.25, py: 0.5 }
        }}
      >
        {options.map(opt => (
          <ToggleButton key={opt.value} value={opt.value}>
            {opt.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  );
}
