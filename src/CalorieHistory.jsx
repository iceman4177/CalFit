import React, { useEffect, useMemo, useState } from 'react';
import { Paper, Typography, Table, TableHead, TableRow, TableCell, TableBody, Chip, Box } from '@mui/material';
import { getLocalDayKey, dayKeyFromTimestampLocal, parseDayKeyToLocalDate, sortDayKeysDesc } from './utils/dates';

// Optional: if you fetch cloud rows elsewhere, pass them in; this file stays LOCAL-FIRST.
async function fetchCloudWindowIfAny() {
  // No-op placeholder; keep your existing Supabase fetch if you have one.
  // Return an array like: [{ created_at: '2025-10-17T02:11:00Z', type: 'meal'|'workout', calories: 300 }, ...]
  return [];
}

function buildLocalIndex() {
  const meals = JSON.parse(localStorage.getItem('mealHistory') || '{}');
  const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '{}');
  const byDay = {};

  // Local meals
  for (const [dayKey, val] of Object.entries(meals)) {
    const eaten = Number(val?.totalCalories || 0);
    if (!byDay[dayKey]) byDay[dayKey] = { eaten: 0, burned: 0 };
    byDay[dayKey].eaten += eaten;
  }
  // Local workouts
  for (const [dayKey, val] of Object.entries(workouts)) {
    const burned = Number(val?.totalCalories || 0);
    if (!byDay[dayKey]) byDay[dayKey] = { eaten: 0, burned: 0 };
    byDay[dayKey].burned += burned;
  }

  return byDay;
}

function mergeCloudIntoLocal(localIndex, cloudRows) {
  // LOCAL WINS: only fill days missing locally; never overwrite an existing local day
  const merged = { ...localIndex };
  for (const row of cloudRows || []) {
    const dayKey = dayKeyFromTimestampLocal(row.created_at);
    if (!merged[dayKey]) merged[dayKey] = { eaten: 0, burned: 0 };
    if (row.type === 'meal' && !localIndex[dayKey]) {
      merged[dayKey].eaten += Number(row.calories || 0);
    } else if (row.type === 'workout' && !localIndex[dayKey]) {
      merged[dayKey].burned += Number(row.calories || 0);
    }
  }
  return merged;
}

export default function CalorieHistory() {
  const [index, setIndex] = useState({});
  const [daysTracked, setDaysTracked] = useState(0);
  const [streak, setStreak] = useState(0);

  const rebuild = async () => {
    const localIdx = buildLocalIndex();
    const cloud = await fetchCloudWindowIfAny(); // keep your existing call if you have it
    const merged = mergeCloudIntoLocal(localIdx, cloud);
    setIndex(merged);

    // metrics
    const keys = Object.keys(merged).sort(sortDayKeysDesc);
    setDaysTracked(keys.length);

    // streak: count back from today while days have any activity
    let s = 0;
    const todayKey = getLocalDayKey();
    let cursor = parseDayKeyToLocalDate(todayKey);
    while (true) {
      const key = getLocalDayKey(cursor);
      if (merged[key] && (merged[key].eaten > 0 || merged[key].burned > 0)) {
        s += 1;
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
      } else break;
    }
    setStreak(s);
  };

  useEffect(() => {
    rebuild();
    const onUpdate = () => rebuild();
    window.addEventListener('slimcal:consumed:update', onUpdate);
    window.addEventListener('slimcal:burned:update', onUpdate);
    window.addEventListener('storage', onUpdate);
    window.addEventListener('focus', onUpdate);
    return () => {
      window.removeEventListener('slimcal:consumed:update', onUpdate);
      window.removeEventListener('slimcal:burned:update', onUpdate);
      window.removeEventListener('storage', onUpdate);
      window.removeEventListener('focus', onUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    const keys = Object.keys(index).sort(sortDayKeysDesc);
    return keys.map((k) => {
      const eaten = Number(index[k]?.eaten || 0);
      const burned = Number(index[k]?.burned || 0);
      const net = eaten - burned;
      return { dayKey: k, eaten, burned, net };
    });
  }, [index]);

  const deficitDays = rows.filter(r => r.net < 0).length;
  const last7 = rows.slice(0, 7);
  const avg7 = last7.length ? Math.round(last7.reduce((a, r) => a + r.net, 0) / last7.length) : 0;

  return (
    <Box className="mb-6">
      <Typography variant="h4" className="mb-3">Calorie History</Typography>

      <Paper className="p-3 mb-3">
        <div className="flex gap-6 flex-wrap">
          <Typography>Days tracked: <strong>{daysTracked}</strong></Typography>
          <Typography>Deficit days: <strong>{deficitDays}</strong> ({rows.length ? Math.round(deficitDays / rows.length * 100) : 0}%)</Typography>
          <Typography>7-day avg net: <strong>{avg7}</strong></Typography>
          <Typography>Current streak: <strong>{streak}</strong> {streak === 1 ? 'day' : 'days'}</Typography>
        </div>
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
            {rows.map(({ dayKey, eaten, burned, net }) => {
              const d = parseDayKeyToLocalDate(dayKey).toLocaleDateString();
              const badge = net > 0 ? 'Surplus' : net < 0 ? 'Deficit' : 'Even';
              const color = net > 0 ? 'warning' : net < 0 ? 'success' : 'default';
              return (
                <TableRow key={dayKey}>
                  <TableCell>{d}</TableCell>
                  <TableCell>{burned}</TableCell>
                  <TableCell>{eaten}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{net}</span>
                      <Chip label={badge} color={color} size="small" />
                    </div>
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
