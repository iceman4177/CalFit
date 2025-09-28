// src/WeeklyTrend.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Paper, Typography, Box } from '@mui/material';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Title
} from 'chart.js';
import { useAuth } from './context/AuthProvider.jsx';
import { getDailyMetricsRange } from './lib/db';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Title);

function iso(d) { try { return new Date(d).toISOString().slice(0,10); } catch { return d; } }
function us(d)  { try { return new Date(d).toLocaleDateString('en-US'); } catch { return d; } }
function lastNDays(n=7) {
  const today = new Date();
  const from = new Date(today.getTime() - (n-1)*864e5);
  return { from: iso(from), to: iso(today) };
}

function buildLocalRange(n=7) {
  const workouts = JSON.parse(localStorage.getItem('workoutHistory')||'[]');
  const meals    = JSON.parse(localStorage.getItem('mealHistory')||'[]');
  const map = new Map();
  for (const w of workouts) {
    const rec = map.get(w.date) || { burned:0, eaten:0 };
    rec.burned += (w.totalCalories||0);
    map.set(w.date, rec);
  }
  for (const m of meals) {
    const rec = map.get(m.date) || { burned:0, eaten:0 };
    rec.eaten += (m.meals||[]).reduce((s,x)=>s+(x.calories||0),0);
    map.set(m.date, rec);
  }
  const days = [];
  for (let i=n-1;i>=0;i--){
    const d = new Date(Date.now()-i*864e5).toLocaleDateString('en-US');
    const rec = map.get(d) || { burned:0, eaten:0 };
    days.push({ dayISO: iso(d), burned: rec.burned, eaten: rec.eaten, net: rec.eaten - rec.burned });
  }
  return days;
}

export default function WeeklyTrend() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const localRows = useMemo(()=>buildLocalRange(7),[]);

  useEffect(()=> {
    let ignore=false;
    (async ()=>{
      if (!user) { setRows(localRows); return; }
      try {
        const {from,to} = lastNDays(7);
        const data = await getDailyMetricsRange(user.id, from, to);
        setRows(data.map(r=>({
          dayISO: r.day,
          burned: r.cals_burned||0,
          eaten:  r.cals_eaten||0,
          net:    r.net_cals ?? (r.cals_eaten||0)-(r.cals_burned||0),
        })));
      } catch(err){
        console.error('[WeeklyTrend] fallback',err);
        setRows(localRows);
      }
    })();
    return ()=>{ignore=true;};
  },[user,localRows]);

  const chartData = {
    labels: rows.map(r=>us(r.dayISO)),
    datasets: [
      { label:'Net Calories', data:rows.map(r=>r.net), borderColor:'rgba(75,192,192,1)', fill:false },
    ]
  };

  return (
    <Paper elevation={3} sx={{p:3}}>
      <Typography variant="h5" gutterBottom>7-Day Net Calorie Trend</Typography>
      <Box sx={{maxWidth:800, mx:'auto'}}>
        <Line data={chartData} />
      </Box>
    </Paper>
  );
}
