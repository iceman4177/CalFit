import React, { useEffect, useState, useCallback } from 'react';
import { Box, Paper, Typography, Chip, Stack } from '@mui/material';

const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const todayUS = () => new Date().toLocaleDateString('en-US');

function readLocal() {
  const d = todayUS();
  try {
    const wh = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const mh = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    const burned = wh
      .filter(w => w.date === d)
      .reduce((s, w) => s + (Number(w.totalCalories) || 0), 0);
    const meals = mh.find(m => m.date === d);
    const consumed = meals
      ? (meals.meals || []).reduce((s, m) => s + (Number(m.calories) || 0), 0)
      : 0;
    return { burned, consumed };
  } catch {
    return { burned: 0, consumed: 0 };
  }
}

export default function WorkoutSummaryBar() {
  const [burned, setBurned] = useState(0);
  const [consumed, setConsumed] = useState(0);

  const recompute = useCallback(() => {
    const { burned: b, consumed: c } = readLocal();
    setBurned(Math.round(b || 0));
    setConsumed(Math.round(c || 0));
  }, []);

  useEffect(() => {
    recompute();
  }, [recompute]);

  useEffect(() => {
    const kick = () => recompute();
    const onStorage = e => {
      if (!e || !e.key || ['mealHistory', 'workoutHistory'].includes(e.key)) recompute();
    };
    const onVisOrFocus = () => recompute();

    window.addEventListener('slimcal:consumed:update', kick);
    window.addEventListener('slimcal:burned:update', kick);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisOrFocus);
    window.addEventListener('focus', onVisOrFocus);

    return () => {
      window.removeEventListener('slimcal:consumed:update', kick);
      window.removeEventListener('slimcal:burned:update', kick);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisOrFocus);
      window.removeEventListener('focus', onVisOrFocus);
    };
  }, [recompute]);

  const net = (consumed || 0) - (burned || 0);
  const status =
    net > 0 ? { label: 'Surplus', color: 'error' } :
    net < 0 ? { label: 'Deficit', color: 'success' } :
              { label: 'Balanced', color: 'info' };

  return (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 2.5, md: 3 },
        mb: { xs: 3, md: 4 },
        borderRadius: 3,
        textAlign: 'center',
        bgcolor: 'rgba(255,255,255,0.6)',
        backdropFilter: 'blur(6px)',
        border: '1px solid',
        borderColor: 'rgba(0,0,0,0.06)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.04), inset 0 0 0 1px rgba(255,255,255,0.6)'
      }}
      aria-label="Today's net calories summary"
    >
      <Typography
        variant="overline"
        sx={{ letterSpacing: 0.6, opacity: 0.8 }}
      >
        Today’s Net Calories
      </Typography>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          my: 0.5
        }}
      >
        <Typography
          component="div"
          sx={{
            lineHeight: 1,
            fontWeight: 800,
            fontSize: { xs: '2.4rem', sm: '2.8rem', md: '3.2rem' }
          }}
        >
          {nf0.format(net)}
        </Typography>

        <Chip
          label={status.label}
          color={status.color}
          sx={{
            color: '#fff',
            fontWeight: 700,
            borderRadius: 999,
            height: 28,
            '& .MuiChip-label': { px: 1.25, py: 0.25 }
          }}
          aria-label={`Calorie status: ${status.label}`}
        />
      </Box>

      <Stack
        direction="row"
        spacing={2}
        justifyContent="center"
        alignItems="center"
        sx={{ flexWrap: 'wrap', rowGap: 1 }}
      >
        <Chip
          variant="outlined"
          label={
            <Box component="span" sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'baseline' }}>
              <Typography component="span" sx={{ fontWeight: 700 }}>
                {nf0.format(consumed || 0)}
              </Typography>
              <Typography component="span" color="text.secondary" sx={{ fontSize: '0.85rem' }}>
                eaten
              </Typography>
            </Box>
          }
          sx={{ borderRadius: 2 }}
          aria-label={`Calories eaten: ${nf0.format(consumed || 0)}`}
        />

        <Chip
          variant="outlined"
          label={
            <Box component="span" sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'baseline' }}>
              <Typography component="span" sx={{ fontWeight: 700 }}>
                {nf0.format(burned || 0)}
              </Typography>
              <Typography component="span" color="text.secondary" sx={{ fontSize: '0.85rem' }}>
                burned
              </Typography>
            </Box>
          }
          sx={{ borderRadius: 2 }}
          aria-label={`Calories burned: ${nf0.format(burned || 0)}`}
        />
      </Stack>
    </Paper>
  );
}
