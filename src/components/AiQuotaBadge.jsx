// src/components/AiQuotaBadge.jsx
import React from 'react';
import { Chip } from '@mui/material';

export default function AiQuotaBadge({
  remaining = 0,
  limit = 0,
  isPro = false,
  label = 'Free',
  size = 'small',
  sx = {},
}) {
  // If limit is 0, hide (feature not meant to show quota)
  if (!limit) return null;

  const baseSx = {
    fontWeight: 800,
    whiteSpace: 'nowrap',
    flexShrink: 0,
    ...sx,
  };

  if (isPro) {
    return (
      <Chip
        size={size}
        color="success"
        label="PRO ∞"
        sx={baseSx}
      />
    );
  }

  return (
    <Chip
      size={size}
      color={remaining > 0 ? 'primary' : 'default'}
      label={`${label}: ${remaining}/${limit}`}
      sx={{
        ...baseSx,
        opacity: remaining > 0 ? 1 : 0.65,
      }}
    />
  );
}
