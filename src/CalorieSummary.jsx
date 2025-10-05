// src/CalorieSummary.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Paper, Typography, Box, Card, CardContent, Chip, Divider } from '@mui/material';
import { useAuth } from './context/AuthProvider.jsx';
import { getDailyMetricsRange } from './lib/db';

function iso(d=new Date()){ return new Date(d).toISOString().slice(0,10); }

export default function CalorieSummary() {
  const { user } = useAuth();
  const [burned,setBurned]     = useState(0);
  const [consumed,setConsumed] = useState(0);

  const local = useMemo(()=>{
    const today = new Date().toLocaleDateString('en-US');
    const wh = JSON.parse(localStorage.getItem('workoutHistory')||'[]');
    const mh = JSON.parse(localStorage.getItem('mealHistory')||'[]');
    const burned = wh.filter(w=>w.date===today).reduce((s,w)=>s+(w.totalCalories||0),0);
    const meals = mh.find(m=>m.date===today);
    const eaten = meals ? (meals.meals||[]).reduce((s,m)=>s+(m.calories||0),0) : 0;
    return {burned,eaten};
  },[]);

  useEffect(()=>{
    (async()=>{
      if (!user){ setBurned(local.burned); setConsumed(local.eaten); return; }
      try{
        const today = iso();
        const rows = await getDailyMetricsRange(user.id,today,today);
        const r = rows[0]||{};
        setBurned(r.cals_burned||0);
        setConsumed(r.cals_eaten||0);
      }catch(err){
        console.error('[CalorieSummary] fallback',err);
        setBurned(local.burned); setConsumed(local.eaten);
      }
    })();
  },[user,local]);

  const net = consumed - burned;

  // -------- Persona + targets from HealthDataForm (already persisted) --------
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

      {/* Persona + Protein Targets (relatable add-on, no new files) */}
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

          <Typography variant="caption" color="text.secondary" sx={{ display:'block', mt:1 }}>
            Tip: Bodybuilders often aim for ~1g protein/lb; endurance & yoga can run lighter.
          </Typography>
        </CardContent>
      </Card>
    </>
  );
}
