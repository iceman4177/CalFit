import React, { useEffect, useState, useCallback } from 'react';
import {
  Paper,
  Typography,
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack
} from '@mui/material';

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
    const eaten = meals
      ? (meals.meals || []).reduce((s, m) => s + (Number(m.calories) || 0), 0)
      : 0;
    return { burned, eaten };
  } catch {
    return { burned: 0, eaten: 0 };
  }
}

export default function CalorieSummary() {
  const [burned, setBurned] = useState(0);
  const [consumed, setConsumed] = useState(0);

  const recompute = useCallback(() => {
    const { burned: b, eaten: c } = readLocal();
    setBurned(Math.round(b || 0));
    setConsumed(Math.round(c || 0));
  }, []);

  useEffect(() => { recompute(); }, [recompute]);

  useEffect(() => {
    const kick = () => recompute();
    const onStorage = (e) => {
      if (!e || !e.key || ['mealHistory','workoutHistory'].includes(e.key)) recompute();
    };
    const onVisOrFocus = () => recompute();

    window.addEventListener('slimcal:consumed:update', kick);
    window.addEventListener('slimcal:burned:update',   kick);
    window.addEventListener('storage',                 onStorage);
    document.addEventListener('visibilitychange',      onVisOrFocus);
    window.addEventListener('focus',                   onVisOrFocus);

    return () => {
      window.removeEventListener('slimcal:consumed:update', kick);
      window.removeEventListener('slimcal:burned:update',   kick);
      window.removeEventListener('storage',                 onStorage);
      document.removeEventListener('visibilitychange',      onVisOrFocus);
      window.removeEventListener('focus',                   onVisOrFocus);
    };
  }, [recompute]);

  const net = (consumed || 0) - (burned || 0);
  const status =
    net > 0 ? { label: 'Surplus', color: 'error' } :
    net < 0 ? { label: 'Deficit', color: 'success' } :
              { label: 'Balanced', color: 'info' };

  // Persona chips
  const trainingIntent = (localStorage.getItem('training_intent') || 'general').replace('_',' ');
  const dietPreference = localStorage.getItem('diet_preference') || 'omnivore';
  const proteinDaily   = Number(localStorage.getItem('protein_target_daily_g') || 0);
  const proteinMeal    = Number(localStorage.getItem('protein_target_meal_g') || 0);

  const quickFoods = {
    vegan: 'tofu, tempeh, lentils, edamame, vegan protein shake',
    vegetarian: 'eggs, Greek yogurt, cottage cheese, beans, whey/casein',
    pescatarian: 'salmon, tuna, shrimp, eggs, Greek yogurt',
    keto: 'steak/chicken/salmon, eggs, cheese, isolate shake',
    mediterranean: 'fish/seafood, Greek yogurt, chickpeas, chicken',
    omnivore: 'chicken/turkey/lean beef, eggs, Greek yogurt, whey'
  }[dietPreference] || 'chicken, eggs, Greek yogurt, whey';

  return (
    <>
      {/* --- HERO SUMMARY --- */}
      <Paper
        elevation={3}
        sx={{
          p: { xs: 2, sm: 3 },
          mt: 4,
          borderRadius: 3,
          textAlign: 'center',
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.03) 0%, rgba(0,0,0,0.06) 100%)',
          backdropFilter: 'blur(2px)'
        }}
        aria-label="Today's calorie summary"
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
          Today’s Summary
        </Typography>

        {/* Net line */}
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
              fontSize: { xs: '2.1rem', sm: '2.6rem', md: '3rem' }
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
            aria-label={`Net status: ${status.label}`}
          />
        </Box>

        {/* Stats row */}
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

      {/* --- FOCUS / COACHING CARD --- */}
      <Card variant="outlined" sx={{ mt: 2, borderRadius: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Your Focus
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Chip size="small" label={trainingIntent} />
              <Chip size="small" label={dietPreference} />
            </Box>
          </Box>

          <Divider sx={{ mb: 1.25 }} />

          <Typography variant="body2" sx={{ lineHeight: 1.5 }}>
            Protein target:&nbsp;
            <b>{nf0.format(proteinDaily || 0)} g/day</b>
            &nbsp;(~<b>{nf0.format(proteinMeal || 0)} g/meal</b>)
          </Typography>

          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.25, lineHeight: 1.5 }}>
            Quick picks for today: {quickFoods}.
          </Typography>
        </CardContent>
      </Card>
    </>
  );
}
