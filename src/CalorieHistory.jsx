// src/CalorieHistory.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Container, Divider, Typography, Table, TableBody, TableCell,
  TableHead, TableRow, Paper, CircularProgress, Chip, Stack, Tooltip
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
    const iso = toIsoDay(dayUS); // local was stored as en-US; convert to ISO if possible
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

// ------- tiny helpers for insights -------
function sortDesc(rows) {
  return [...rows].sort((a,b) => (a.day < b.day ? 1 : -1));
}
function rollingAvg(arr, n) {
  if (!arr.length) return 0;
  const slice = arr.slice(0, n); // rows already newest-first
  const sum = slice.reduce((s,x)=> s + (x ?? 0), 0);
  return sum / (slice.length || 1);
}
function calcStreak(rows) {
  // rows newest-first; count consecutive days from today going back with any entry present
  const days = new Set(rows.map(r => r.day));
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today.getTime() - i*864e5);
    const iso = d.toISOString().slice(0,10);
    if (days.has(iso)) streak++;
    else break;
  }
  return streak;
}

export default function CalorieHistory() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [rows, setRows]       = useState([]);

  const localRows = useMemo(() => buildLocalDailyIndex(), []);

  // persona chips (relatable, persistent)
  const trainingIntent = (localStorage.getItem('training_intent') || 'general').replace('_',' ');
  const dietPreference = localStorage.getItem('diet_preference') || 'omnivore';

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
        const normalized = Array.isArray(data) ? data.map(r => ({
          day: r.day || r.date || toIsoDay(r.day || new Date()),
          cals_burned: r.cals_burned ?? 0,
          cals_eaten:  r.cals_eaten  ?? 0,
          net_cals:    (r.net_cals != null ? r.net_cals : (r.cals_eaten ?? 0) - (r.cals_burned ?? 0))
        })) : [];
        if (!ignore) setRows(sortDesc(normalized));
      } catch (err) {
        console.error('[CalorieHistory] fetch failed, falling back to local', err);
        if (!ignore) setRows(localRows);
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [user, localRows]);

  // ---- insights (newest-first expected) ----
  const daysTracked = rows.length;
  const deficitDays = rows.filter(r => (r.net_cals ?? ((r.cals_eaten||0)-(r.cals_burned||0))) < 0).length;
  const deficitPct  = daysTracked ? Math.round((deficitDays / daysTracked) * 100) : 0;
  const avgNet7     = Math.round(rollingAvg(rows.map(r => r.net_cals ?? ((r.cals_eaten||0)-(r.cals_burned||0))), 7));
  const streak      = calcStreak(rows);

  return (
    <Container maxWidth="md" sx={{ py:4 }}>
      <Box sx={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:1 }}>
        <Typography variant="h4">Calorie History</Typography>
        <Stack direction="row" spacing={1}>
          <Chip size="small" label={trainingIntent} />
          <Chip size="small" label={dietPreference} />
        </Stack>
      </Box>

      <Divider sx={{ my:2 }} />

      {/* quick insights */}
      <Paper variant="outlined" sx={{ p:2, mb:2, borderRadius:2 }}>
        <Stack direction={{ xs:'column', sm:'row' }} spacing={2} justifyContent="space-between">
          <Typography variant="body2"><b>Days tracked:</b> {daysTracked}</Typography>
          <Typography variant="body2">
            <b>Deficit days:</b> {deficitDays} ({deficitPct}%)
          </Typography>
          <Tooltip title="Average of latest 7 days (newest first)">
            <Typography variant="body2"><b>7-day avg net:</b> {isFinite(avgNet7) ? avgNet7 : 0}</Typography>
          </Tooltip>
          <Typography variant="body2"><b>Current streak:</b> {streak} day{streak===1?'':'s'}</Typography>
        </Stack>
      </Paper>

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
              {rows.map((r, i) => {
                const net = (r.net_cals != null ? r.net_cals : (r.cals_eaten || 0) - (r.cals_burned || 0));
                const label = net >= 0 ? 'Surplus' : 'Deficit';
                return (
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
                      <Box sx={{ display:'inline-flex', alignItems:'center', gap:1 }}>
                        {Math.round(net)}
                        <Chip
                          size="small"
                          label={label}
                          color={net >= 0 ? 'warning' : 'success'}
                          variant="outlined"
                        />
                      </Box>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Container>
  );
}
