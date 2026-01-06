// src/WeeklyTrend.jsx
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Paper, Typography, Box } from '@mui/material';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Title
} from 'chart.js';
import { useAuth } from './context/AuthProvider.jsx';
import { getDailyMetricsRange } from './lib/db';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Title);

// ---- Local-day helpers (stable) ----
function localDayISO(d = new Date()) {
  const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return ld.toISOString().slice(0, 10);
}
function fromUSDateToISO(us) {
  try {
    const [m, d, y] = String(us).split('/').map(Number);
    if (!m || !d || !y) return null;
    return localDayISO(new Date(y, m - 1, d));
  } catch {
    return null;
  }
}
function toLocalUSFromISO(isoYYYYMMDD) {
  try {
    const [y, m, d] = String(isoYYYYMMDD).split('-').map(Number);
    if (!y || !m || !d) return String(isoYYYYMMDD);
    return new Date(y, m - 1, d).toLocaleDateString('en-US');
  } catch {
    return String(isoYYYYMMDD);
  }
}

function lastNDaysISO(n = 7) {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  from.setDate(from.getDate() - (n - 1));
  return { from: localDayISO(from), to: localDayISO(new Date()) };
}

function buildLocalRangeISO(n = 7) {
  const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '[]'); // [{date:'M/D/YYYY', totalCalories}]
  const meals = JSON.parse(localStorage.getItem('mealHistory') || '[]'); // [{date:'M/D/YYYY', meals:[{calories}]}]

  const map = new Map(); // iso -> { burned, eaten }
  for (const w of workouts) {
    const dayISO = fromUSDateToISO(w.date);
    if (!dayISO) continue;
    const rec = map.get(dayISO) || { burned: 0, eaten: 0 };
    rec.burned += Number(w.totalCalories) || 0;
    map.set(dayISO, rec);
  }

  for (const m of meals) {
    const dayISO = fromUSDateToISO(m.date);
    if (!dayISO) continue;
    const rec = map.get(dayISO) || { burned: 0, eaten: 0 };
    rec.eaten += (m.meals || []).reduce((s, x) => s + (Number(x.calories) || 0), 0);
    map.set(dayISO, rec);
  }

  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);

    const dayISO = localDayISO(d);
    const rec = map.get(dayISO) || { burned: 0, eaten: 0 };
    out.push({
      dayISO,
      burned: rec.burned,
      eaten: rec.eaten,
      net: (rec.eaten || 0) - (rec.burned || 0),
      _src: 'local'
    });
  }
  return out;
}

function mergeServerWithLocal(serverRows, localRows) {
  const localMap = new Map(localRows.map(r => [r.dayISO, r]));
  const out = [];

  for (const l of localRows) {
    const s = (serverRows || []).find(x => x.dayISO === l.dayISO);
    if (s) {
      // Prefer server values if they exist (non-null), otherwise fallback to local
      const burned = Number(s.burned ?? 0);
      const eaten  = Number(s.eaten ?? 0);

      out.push({
        dayISO: l.dayISO,
        burned: (burned > 0 ? burned : l.burned),
        eaten: (eaten > 0 ? eaten : l.eaten),
        net: (Number(s.net ?? (eaten - burned)) || (l.net)),
        _src: 'server+local'
      });
    } else {
      out.push(l);
    }
  }
  return out;
}

export default function WeeklyTrend() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);

  const recomputeLocal = useCallback(() => {
    const localRows = buildLocalRangeISO(7);
    setRows((prev) => {
      // If we currently show merged server data, keep it but ensure local recalculation persists.
      // Best: just set local, and server effect (below) will merge again if signed in.
      return localRows;
    });
  }, []);

  // Initial local fill + live updates
  useEffect(() => {
    recomputeLocal();

    const onConsumed = () => recomputeLocal();
    const onBurned = () => recomputeLocal();
    const onVis = () => recomputeLocal();
    const onFocus = () => recomputeLocal();
    const onStorage = () => recomputeLocal();

    window.addEventListener('slimcal:consumed:update', onConsumed);
    window.addEventListener('slimcal:burned:update', onBurned);
    window.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('slimcal:consumed:update', onConsumed);
      window.removeEventListener('slimcal:burned:update', onBurned);
      window.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
    };
  }, [recomputeLocal]);

  // If signed in, merge in server daily_metrics on top of local
  useEffect(() => {
    let ignore = false;

    (async () => {
      const localRows = buildLocalRangeISO(7);

      if (!user) {
        if (!ignore) setRows(localRows);
        return;
      }

      try {
        const { from, to } = lastNDaysISO(7);
        const data = await getDailyMetricsRange(user.id, from, to);

        const serverRows = (data || []).map((r) => ({
          dayISO: r.day, // expected YYYY-MM-DD
          burned: Number(r.cals_burned || 0),
          eaten: Number(r.cals_eaten || 0),
          net: (r.net_cals != null ? Number(r.net_cals) : (Number(r.cals_eaten || 0) - Number(r.cals_burned || 0))),
          _src: 'server'
        }));

        const merged = mergeServerWithLocal(serverRows, localRows);
        if (!ignore) setRows(merged);
      } catch (err) {
        console.error('[WeeklyTrend] fallback to local', err);
        if (!ignore) setRows(localRows);
      }
    })();

    return () => { ignore = true; };
  }, [user]);

  const chartData = useMemo(() => {
    return {
      labels: rows.map((r) => toLocalUSFromISO(r.dayISO)),
      datasets: [
        {
          label: 'Net Calories',
          data: rows.map((r) => Number(r.net) || 0),
          borderColor: 'rgba(75,192,192,1)',
          fill: false,
        }
      ]
    };
  }, [rows]);

  return (
    <Paper elevation={3} sx={{ p: 3 }}>
      <Typography variant="h5" gutterBottom>7-Day Net Calorie Trend</Typography>
      <Box sx={{ maxWidth: 800, mx: 'auto' }}>
        <Line data={chartData} />
      </Box>
    </Paper>
  );
}
