// src/Achievements.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Container, Typography, Paper, List, ListItem, ListItemText } from '@mui/material';
import { useAuth } from './context/AuthProvider.jsx';
import { getDailyMetricsRange, getWorkouts } from './lib/db';

export default function Achievements() {
  const { user } = useAuth();
  const [stats,setStats] = useState({workouts:0, burned:0, eaten:0});

  const local = useMemo(()=>{
    const wh = JSON.parse(localStorage.getItem('workoutHistory')||'[]');
    const mh = JSON.parse(localStorage.getItem('mealHistory')||'[]');
    const burned = wh.reduce((s,w)=>s+(w.totalCalories||0),0);
    const eaten = mh.reduce((s,day)=>s+(day.meals||[]).reduce((ss,m)=>ss+(m.calories||0),0),0);
    return {workouts:wh.length, burned, eaten};
  },[]);

  useEffect(()=>{
    (async()=>{
      if (!user){ setStats(local); return; }
      try{
        const ws = await getWorkouts(user.id,{limit:1000});
        const dm = await getDailyMetricsRange(user.id,null,null);
        const burned = dm.reduce((s,r)=>s+(r.cals_burned||0),0);
        const eaten  = dm.reduce((s,r)=>s+(r.cals_eaten||0),0);
        setStats({workouts:ws.length, burned, eaten});
      }catch(err){
        console.error('[Achievements] fallback',err);
        setStats(local);
      }
    })();
  },[user,local]);

  const badges = [];
  if (stats.workouts>=10) badges.push('🔥 10 Workouts');
  if (stats.burned>=5000) badges.push('⚡ 5,000 Calories Burned');
  if (stats.eaten>=10000) badges.push('🍽 10,000 Calories Logged');

  return (
    <Container maxWidth="sm" sx={{py:4}}>
      <Typography variant="h4" gutterBottom>Achievements</Typography>
      <Paper variant="outlined">
        <List>
          {badges.length===0
            ? <ListItem><ListItemText primary="No achievements yet." /></ListItem>
            : badges.map((b,i)=><ListItem key={i}><ListItemText primary={b}/></ListItem>)
          }
        </List>
      </Paper>
    </Container>
  );
}
