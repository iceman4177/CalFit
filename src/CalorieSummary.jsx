import React, { useEffect, useState, useCallback } from 'react';
import { Paper, Typography, Box, Card, CardContent, Chip, Divider } from '@mui/material';

const todayUS = () => new Date().toLocaleDateString('en-US');

function readLocal() {
  const d = todayUS();
  try {
    const wh = JSON.parse(localStorage.getItem('workoutHistory')||'[]');
    const mh = JSON.parse(localStorage.getItem('mealHistory')||'[]');
    const burned = wh.filter(w=>w.date===d).reduce((s,w)=> s + (Number(w.totalCalories)||0), 0);
    const meals  = mh.find(m=>m.date===d);
    const eaten  = meals ? (meals.meals||[]).reduce((s,m)=> s + (Number(m.calories)||0), 0) : 0;
    return { burned, eaten };
  } catch { return { burned:0, eaten:0 }; }
}

export default function CalorieSummary() {
  const [burned,setBurned]     = useState(0);
  const [consumed,setConsumed] = useState(0);

  const recompute = useCallback(() => {
    const { burned: b, eaten: c } = readLocal();
    setBurned(Math.round(b||0));
    setConsumed(Math.round(c||0));
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

  const net = consumed - burned;

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
      <Paper elevation={3} sx={{p:3, mt:4}}>
        <Typography variant="h5" gutterBottom>Today’s Summary</Typography>
        <Box sx={{display:'flex', justifyContent:'space-around', flexWrap:'wrap', gap:2}}>
          <Typography>Burned: {Math.round(burned)}</Typography>
          <Typography>Eaten: {Math.round(consumed)}</Typography>
          <Typography>Net: {Math.round(net)} ({net>=0?'Surplus':'Deficit'})</Typography>
        </Box>
      </Paper>

      <Card variant="outlined" sx={{ mt:2, borderRadius:2 }}>
        <CardContent>
          <Box sx={{ display:'flex', alignItems:'center', justifyContent:'space-between', mb:1 }}>
            <Typography variant="h6">Your Focus</Typography>
            <Box sx={{ display:'flex', gap:1 }}>
              <Chip size="small" label={trainingIntent} />
              <Chip size="small" label={dietPreference} />
            </Box>
          </Box>

          <Divider sx={{ mb:1 }} />

          <Typography variant="body2">
            Protein target: <b>{proteinDaily || 0} g/day</b>{' '}
            (~<b>{proteinMeal || 0} g/meal</b>)
          </Typography>

          <Typography variant="body2" sx={{ mt:1 }}>
            Try today: {quickFoods}.
          </Typography>
        </CardContent>
      </Card>
    </>
  );
}