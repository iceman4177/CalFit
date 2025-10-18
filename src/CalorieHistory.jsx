import React, { useEffect, useMemo, useState } from 'react';
import { Paper, Typography, Table, TableHead, TableRow, TableCell, TableBody, Chip, Box } from '@mui/material';

const todayUS = () => new Date().toLocaleDateString('en-US');

function buildLocalIndex() {
  try {
    const mh = JSON.parse(localStorage.getItem('mealHistory') || '[]');      // [{date, meals:[]}]
    const wh = JSON.parse(localStorage.getItem('workoutHistory') || '[]');   // [{date, totalCalories}]
    const byDate = {};

    // Meals → eaten
    for (const entry of mh) {
      const date = entry?.date;
      if (!date) continue;
      const eaten = (entry.meals || []).reduce((s, m) => s + (Number(m.calories) || 0), 0);
      if (!byDate[date]) byDate[date] = { eaten: 0, burned: 0 };
      byDate[date].eaten += eaten;
    }

    // Workouts → burned
    for (const w of wh) {
      const date = w?.date;
      if (!date) continue;
      const burned = Number(w.totalCalories) || 0;
      if (!byDate[date]) byDate[date] = { eaten: 0, burned: 0 };
      byDate[date].burned += burned;
    }

    return byDate;
  } catch {
    return {};
  }
}

export default function CalorieHistory() {
  const [index, setIndex] = useState({});

  const rebuild = () => setIndex(buildLocalIndex());

  useEffect(() => {
    rebuild();
    const kick = () => rebuild();
    const onStorage = e => {
      if (!e || !e.key || ['mealHistory', 'workoutHistory'].includes(e.key)) kick();
    };
    const onVisOrFocus = () => kick();

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
  }, []);

  const rows = useMemo(() => {
    const keys = Object.keys(index).sort((a, b) => {
      // sort by actual date (MM/DD/YYYY), newest first
      const [am, ad, ay] = a.split('/').map(Number);
      const [bm, bd, by] = b.split('/').map(Number);
      const adt = new Date(ay, am - 1, ad).getTime();
      const bdt = new Date(by, bm - 1, bd).getTime();
      return bdt - adt;
    });
    return keys.map(k => {
      const eaten = Number(index[k]?.eaten || 0);
      const burned = Number(index[k]?.burned || 0);
      const net = eaten - burned;
      return { date: k, eaten, burned, net };
    });
  }, [index]);

  // Streak: consecutive days with any activity, counting back from today
  const [streak, setStreak] = useState(0);
  useEffect(() => {
    let s = 0;
    let cursor = new Date();
    // walk backward until a day has zero activity
    while (true) {
      const key = cursor.toLocaleDateString('en-US');
      const has = index[key] && ((Number(index[key].eaten) || 0) > 0 || (Number(index[key].burned) || 0) > 0);
      if (has) {
        s += 1;
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
      } else break;
    }
    setStreak(s);
  }, [index]);

  const deficitDays = rows.filter(r => r.net < 0).length;
  const last7 = rows.slice(0, 7);
  const avg7 = last7.length ? Math.round(last7.reduce((a, r) => a + r.net, 0) / last7.length) : 0;

  return (
    <Box className="mb-6">
      <Typography variant="h4" sx={{ mb: 2 }}>Calorie History</Typography>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          <Typography>Days tracked: <strong>{rows.length}</strong></Typography>
          <Typography>Deficit days: <strong>{deficitDays}</strong> ({rows.length ? Math.round(deficitDays / rows.length * 100) : 0}%)</Typography>
          <Typography>7-day avg net: <strong>{avg7}</strong></Typography>
          <Typography>Current streak: <strong>{streak}</strong> {streak === 1 ? 'day' : 'days'}</Typography>
        </Box>
      </Paper>

      <Paper>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Burned</TableCell>
              <TableCell>Eaten</TableCell>
              <TableCell>Net</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map(({ date, eaten, burned, net }) => {
              const badge = net > 0 ? 'Surplus' : net < 0 ? 'Deficit' : 'Even';
              const color = net > 0 ? 'warning' : net < 0 ? 'success' : 'default';
              return (
                <TableRow key={date}>
                  <TableCell>{date}</TableCell>
                  <TableCell>{burned}</TableCell>
                  <TableCell>{eaten}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <span>{net}</span>
                      <Chip label={badge} color={color} size="small" />
                    </Box>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}
