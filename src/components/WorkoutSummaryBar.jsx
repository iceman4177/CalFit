// src/components/WorkoutSummaryBar.jsx
import React, { useEffect, useState, useCallback } from 'react';
import { Paper, Typography, Chip, Stack, Box } from '@mui/material';

const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const todayUS = () => new Date().toLocaleDateString('en-US');

function readLocal() {
  const d = todayUS();
  try {
    const wh = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const todays = wh.filter(w => w.date === d);
    const burned = todays.reduce((s, w) => s + (Number(w.totalCalories) || 0), 0);

    // try to infer extra stats if present
    const totalExercises = todays.reduce((s, w) => s + (Number(w.exerciseCount) || 0), 0);
    const totalSets      = todays.reduce((s, w) => s + (Number(w.setCount) || 0), 0);
    const minutes        = todays.reduce((s, w) => s + (Number(w.durationMin) || 0), 0);

    return { burned, totalExercises, totalSets, minutes, sessions: todays.length };
  } catch {
    return { burned: 0, totalExercises: 0, totalSets: 0, minutes: 0, sessions: 0 };
  }
}

export default function WorkoutSummaryBar() {
  const [stats, setStats] = useState(readLocal());

  const recompute = useCallback(() => setStats(readLocal()), []);

  useEffect(() => { recompute(); }, [recompute]);

  useEffect(() => {
    const kick = () => recompute();
    const onStorage = (e) => {
      if (!e || !e.key || e.key === 'workoutHistory') recompute();
    };
    const onVisOrFocus = () => recompute();

    window.addEventListener('slimcal:burned:update', kick);
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisOrFocus);
    window.addEventListener('focus', onVisOrFocus);

    return () => {
      window.removeEventListener('slimcal:burned:update', kick);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisOrFocus);
      window.removeEventListener('focus', onVisOrFocus);
    };
  }, [recompute]);

  const { burned, totalExercises, totalSets, minutes, sessions } = stats;

  return (
    <Paper
      elevation={3}
      sx={{
        p: { xs: 2, sm: 3 },
        mb: { xs: 3, sm: 4 },
        borderRadius: 3,
        textAlign: 'center',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.03) 0%, rgba(0,0,0,0.06) 100%)',
        backdropFilter: 'blur(2px)'
      }}
      aria-label="Today's workout summary"
    >
      <Typography
        variant="subtitle2"
        sx={{
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          color: 'text.secondary',
          mb: 1
        }}
      >
        Today’s Workout
      </Typography>

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          mb: { xs: 1.25, sm: 1.5 }
        }}
      >
        <Typography
          component="div"
          sx={{
            lineHeight: 1,
            fontWeight: 800,
            fontSize: { xs: '2rem', sm: '2.4rem', md: '2.8rem' }
          }}
        >
          {nf0.format(burned)} kcal
        </Typography>
        <Chip
          label={sessions > 0 ? `${sessions} session${sessions > 1 ? 's' : ''}` : 'No session'}
          color={sessions > 0 ? 'success' : 'default'}
          sx={{
            color: sessions > 0 ? '#fff' : 'inherit',
            fontWeight: 700,
            borderRadius: 999,
            height: 28,
            '& .MuiChip-label': { px: 1.25, py: 0.25 }
          }}
          aria-label={`Workout sessions today: ${sessions}`}
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
                {nf0.format(totalExercises)}
              </Typography>
              <Typography component="span" color="text.secondary" sx={{ fontSize: '0.85rem' }}>
                exercises
              </Typography>
            </Box>
          }
          sx={{ borderRadius: 2 }}
        />
        <Chip
          variant="outlined"
          label={
            <Box component="span" sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'baseline' }}>
              <Typography component="span" sx={{ fontWeight: 700 }}>
                {nf0.format(totalSets)}
              </Typography>
              <Typography component="span" color="text.secondary" sx={{ fontSize: '0.85rem' }}>
                sets
              </Typography>
            </Box>
          }
          sx={{ borderRadius: 2 }}
        />
        <Chip
          variant="outlined"
          label={
            <Box component="span" sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'baseline' }}>
              <Typography component="span" sx={{ fontWeight: 700 }}>
                {nf0.format(minutes)}
              </Typography>
              <Typography component="span" color="text.secondary" sx={{ fontSize: '0.85rem' }}>
                min
              </Typography>
            </Box>
          }
          sx={{ borderRadius: 2 }}
        />
      </Stack>
    </Paper>
  );
}
