// src/CalorieSummary.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Paper, Typography, Box } from '@mui/material';
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

  return (
    <Paper elevation={3} sx={{p:3, mt:4}}>
      <Typography variant="h5" gutterBottom>Today’s Summary</Typography>
      <Box sx={{display:'flex', justifyContent:'space-around'}}>
        <Typography>Burned: {burned}</Typography>
        <Typography>Eaten: {consumed}</Typography>
        <Typography>Net: {net} ({net>=0?'Surplus':'Deficit'})</Typography>
      </Box>
    </Paper>
  );
}
