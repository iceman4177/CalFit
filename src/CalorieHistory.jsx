// src/CalorieHistory.jsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Container, Divider, Typography, Table, TableBody, TableCell,
  TableHead, TableRow, Paper, CircularProgress, Chip, Stack, Tooltip
} from '@mui/material';
import { useAuth } from './context/AuthProvider.jsx';
import { getDailyMetricsRange } from './lib/db';

// ---------- Local-day helpers (no UTC drift) ----------
function pad(n) { return String(n).padStart(2, '0'); }
function ymdLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const usToday  = () => new Date().toLocaleDateString('en-US');
const isoToday = () => ymdLocal(new Date()); // local YYYY-MM-DD

// Convert "MM/DD/YYYY" (localStorage shape) to "YYYY-MM-DD" in LOCAL time.
// Do NOT use new Date(...).toISOString() which shifts to UTC.
function toIsoDay(d) {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d; // already ISO
  if (typeof d === 'string' && d.includes('/')) {
    const parts = d.split('/').map(x => parseInt(x, 10));
    if (parts.length === 3 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) && Number.isFinite(parts[2])) {
      const [m, day, y] = parts;
      return `${y}-${pad(m)}-${pad(day)}`;
    }
  }
  // Fallback: construct local date then format (still avoids UTC ISO)
  const dt = new Date(d);
  return ymdLocal(new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()));
}

function sortDesc(rows) {
  return [...rows].sort((a, b) => (a.day < b.day ? 1 : -1));
}
function rollingAvg(arr, n) {
  if (!arr.length) return 0;
  const slice = arr.slice(0, n);
  const sum = slice.reduce((s, x) => s + (Number(x) || 0), 0);
  return sum / (slice.length || 1);
}
function calcStreak(rows) {
  const days = new Set(rows.map(r => r.day)); // expect local YYYY-MM-DD
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i); // local midnight walk
    const iso = ymdLocal(d);
    if (days.has(iso)) streak++; else break;
  }
  return streak;
}

// Build a daily index from localStorage (always fresh)
function buildLocalDailyIndex() {
  const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '[]'); // [{date, totalCalories}]
  const mealsArr = JSON.parse(localStorage.getItem('mealHistory')    || '[]'); // [{date, meals:[{calories}]}]

  const idx = new Map(); // day(US) -> { cals_burned, cals_eaten }
  for (const w of workouts) {
    const dayUS = w.date;
    const rec = idx.get(dayUS) || { cals_burned: 0, cals_eaten: 0 };
    rec.cals_burned += Number(w.totalCalories) || 0;
    idx.set(dayUS, rec);
  }
  for (const d of mealsArr) {
    const dayUS = d.date;
    const rec = idx.get(dayUS) || { cals_burned: 0, cals_eaten: 0 };
    const eaten = (d.meals || []).reduce((s, m) => s + (Number(m.calories) || 0), 0);
    rec.cals_eaten += eaten;
    idx.set(dayUS, rec);
  }

  const out = [];
  for (const [dayUS, rec] of idx.entries()) {
    const iso = toIsoDay(dayUS); // << local-safe YYYY-MM-DD
    const burned = Number(rec.cals_burned) || 0;
    const eaten  = Number(rec.cals_eaten)  || 0;
    out.push({ day: iso, cals_burned: burned, cals_eaten: eaten, net_cals: eaten - burned });
  }
  return sortDesc(out);
}

export default function CalorieHistory() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [rows, setRows]       = useState([]);

  const recompute = useCallback(async () => {
    const localRows = buildLocalDailyIndex();

    // If not signed in, local is canonical.
    if (!user) { setRows(localRows); return; }

    setLoading(true);
    try {
      // pull last 30 days from cloud using LOCAL YYYY-MM-DD
      const todayIso = isoToday();
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 29);
      const from = ymdLocal(fromDate);

      const cloud = await getDailyMetricsRange(user.id, from, todayIso);

      // normalize cloud
      const cloudRows = Array.isArray(cloud) ? cloud.map(r => {
        const day = r.day || r.date || todayIso;
        return {
          day: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : toIsoDay(day),
          cals_burned: Number(r.cals_burned) || 0,
          cals_eaten:  Number(r.cals_eaten)  || 0,
          net_cals:    (r.net_cals != null ? Number(r.net_cals)
                                           : (Number(r.cals_eaten) || 0) - (Number(r.cals_burned) || 0))
        };
      }) : [];

      // Merge: local wins for today (and any day where local has data)
      const mergedMap = new Map(cloudRows.map(r => [r.day, r]));
      for (const lr of localRows) {
        if ((lr.cals_burned || lr.cals_eaten) > 0) mergedMap.set(lr.day, lr);
      }

      setRows(sortDesc([...mergedMap.values()]));
    } catch (err) {
      console.error('[CalorieHistory] fetch failed, falling back to local', err);
      setRows(buildLocalDailyIndex());
    } finally {
      setLoading(false);
    }
  }, [user]);

  // initial + user change
  useEffect(() => { recompute(); }, [recompute]);

  // listen for local edits and tab changes
  useEffect(() => {
    const kick = () => recompute();
    const onStorage = (e) => {
      if (!e || !e.key || ['mealHistory', 'workoutHistory'].includes(e.key)) recompute();
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

  // ---- insights (newest-first expected) ----
  const daysTracked = rows.length;
  const deficitDays = rows.filter(r => (r.net_cals ?? ((r.cals_eaten || 0) - (r.cals_burned || 0))) < 0).length;
  const deficitPct  = daysTracked ? Math.round((deficitDays / daysTracked) * 100) : 0;
  const avgNet7     = Math.round(rollingAvg(rows.map(r => r.net_cals ?? ((r.cals_eaten || 0) - (r.cals_burned || 0))), 7));
  const streak      = calcStreak(rows);

  // persona chips (relatable, persistent)
  const trainingIntent = (localStorage.getItem('training_intent') || 'general').replace('_', ' ');
  const dietPreference = localStorage.getItem('diet_preference') || 'omnivore';

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h4">Calorie History</Typography>
        <Stack direction="row" spacing={1}>
          <Chip size="small" label={trainingIntent} />
          <Chip size="small" label={dietPreference} />
        </Stack>
      </Box>

      <Divider sx={{ my: 2 }} />

      {/* quick insights */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between">
          <Typography variant="body2"><b>Days tracked:</b> {daysTracked}</Typography>
          <Typography variant="body2">
            <b>Deficit days:</b> {deficitDays} ({deficitPct}%)
          </Typography>
          <Tooltip title="Average of latest 7 days (newest first)">
            <Typography variant="body2"><b>7-day avg net:</b> {isFinite(avgNet7) ? avgNet7 : 0}</Typography>
          </Tooltip>
          <Typography variant="body2"><b>Current streak:</b> {streak} day{streak === 1 ? '' : 's'}</Typography>
        </Stack>
      </Paper>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
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

                // Display local date safely: parse "YYYY-MM-DD" by components, not new Date('YYYY-MM-DD')
                let displayDate = r.day;
                if (/^\d{4}-\d{2}-\d{2}$/.test(r.day)) {
                  const [y, m, d] = r.day.split('-').map(Number);
                  displayDate = new Date(y, m - 1, d).toLocaleDateString('en-US');
                } else {
                  try { displayDate = new Date(r.day).toLocaleDateString('en-US'); } catch {}
                }

                return (
                  <TableRow key={i}>
                    <TableCell>{displayDate}</TableCell>
                    <TableCell align="right">{Math.round(r.cals_burned || 0)}</TableCell>
                    <TableCell align="right">{Math.round(r.cals_eaten  || 0)}</TableCell>
                    <TableCell align="right">
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                        {Math.round(net)}
                        <Chip size="small" label={label} color={net >= 0 ? 'warning' : 'success'} variant="outlined" />
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
