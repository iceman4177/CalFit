// src/components/AiQuotaBadge.jsx
import React from 'react';
import { Chip } from '@mui/material';

export default function AiQuotaBadge({
  remaining = 0,
  limit = 0,
  isPro = false,
  label = 'Free',
  size = 'small',
}) {
  // If limit is 0, hide (feature not meant to show quota)
  if (!limit) return null;

  if (isPro) {
    return (
      <Chip
        size={size}
        color="success"
        label="PRO ∞"
        sx={{ fontWeight: 800 }}
      />
    );
  }

  return (
    <Chip
      size={size}
      color={remaining > 0 ? 'primary' : 'default'}
      label={`${label}: ${remaining}/${limit}`}
      sx={{
        fontWeight: 800,
        opacity: remaining > 0 ? 1 : 0.65,
      }}
    />
  );
}
