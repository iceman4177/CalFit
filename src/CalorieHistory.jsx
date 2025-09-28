// src/CalorieHistory.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Container, Divider, Typography, Table, TableBody, TableCell,
  TableHead, TableRow, Paper, CircularProgress
} from '@mui/material';
import { useAuth } from './context/AuthProvider.jsx';
import { getDailyMetricsRange } from './lib/db';

function toIsoDay(d) {
  try {
    return new Date(d).toISOString().slice(0,10);
  } catch { return d; }
}

function getLastNDaysIso(n = 30) {
  const today = new Date();
  const from  = new Date(today.getTime() - (n-1)*864e5);
  return { from: toIsoDay(from), to: toIsoDay(today) };
}

// Build a daily index from localStorage as a fallback
function buildLocalDailyIndex() {
  const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '[]'); // [{date, totalCalories}]
  const mealsArr = JSON.parse(localStorage.getItem('mealHistory')    || '[]'); // [{date, meals:[{calories}]}]

  const idx = new Map(); // day -> { cals_burned, cals_eaten }
  for (const w of workouts) {
    const day = w.date;
    const rec = idx.get(day) || { cals_burned:0, cals_eaten:0 };
    rec.cals_burned += (w.totalCalories || 0);
    idx.set(day, rec);
  }
  for (const d of mealsArr) {
    const day = d.date;
    const rec = idx.get(day) || { cals_burned:0, cals_eaten:0 };
    const eaten = (d.meals || []).reduce((s,m) => s + (m.calories || 0), 0);
    rec.cals_eaten += eaten;
    idx.set(day, rec);
  }
  // normalize into array of { day(YYYY-MM-DD), cals_burned, cals_eaten, net_cals }
  const out = [];
  for (const [dayUS, rec] of idx.entries()) {
    // local was stored as en-US; convert to ISO if possible
    const iso = toIsoDay(dayUS);
    out.push({
      day: iso,
      cals_burned: rec.cals_burned,
      cals_eaten: rec.cals_eaten,
      net_cals: rec.cals_eaten - rec.cals_burned,
    });
  }
  // sort desc (newest first)
  out.sort((a,b) => (a.day < b.day ? 1 : -1));
  return out;
}

export default function CalorieHistory() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [rows, setRows]       = useState([]);

  const localRows = useMemo(() => buildLocalDailyIndex(), []);

  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!user) {
        setRows(localRows);
        return;
      }
      setLoading(true);
      try {
        const { from, to } = getLastNDaysIso(30);
        const data = await getDailyMetricsRange(user.id, from, to);
        if (!ignore) setRows(data);
      } catch (err) {
        console.error('[CalorieHistory] fetch failed, falling back to local', err);
        if (!ignore) setRows(localRows);
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [user, localRows]);

  return (
    <Container maxWidth="md" sx={{ py:4 }}>
      <Typography variant="h4" gutterBottom>Calorie History</Typography>
      <Divider sx={{ mb:2 }} />
      {loading ? (
        <Box sx={{ display:'flex', justifyContent:'center', py:6 }}>
          <CircularProgress />
        </Box>
      ) : rows.length === 0 ? (
        <Typography>No data yet.</Typography>
      ) : (
        <Paper variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell><strong>Date</strong></TableCell>
                <TableCell align="right"><strong>Burned</strong></TableCell>
                <TableCell align="right"><strong>Eaten</strong></TableCell>
                <TableCell align="right"><strong>Net</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>
                    {(() => {
                      try { return new Date(r.day).toLocaleDateString('en-US'); }
                      catch { return r.day; }
                    })()}
                  </TableCell>
                  <TableCell align="right">{Math.round(r.cals_burned || 0)}</TableCell>
                  <TableCell align="right">{Math.round(r.cals_eaten  || 0)}</TableCell>
                  <TableCell align="right">
                    {Math.round((r.net_cals != null ? r.net_cals : (r.cals_eaten || 0) - (r.cals_burned || 0)))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Container>
  );
}
