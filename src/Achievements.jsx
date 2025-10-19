// src/Achievements.jsx
import React, { useEffect, useState } from 'react';
import { Container, Typography, Paper, List, ListItem, ListItemText, CircularProgress, Box } from '@mui/material';
import { useAuth } from './context/AuthProvider.jsx';
import { getDailyMetricsRange, getWorkouts } from './lib/db';

// Compute local stats from localStorage (safe parse)
function readLocalStats() {
  try {
    const wh = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const mh = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    const burned = wh.reduce((s, w) => s + (Number(w.totalCalories) || 0), 0);
    const eaten = mh.reduce(
      (s, day) => s + (Array.isArray(day.meals) ? day.meals.reduce((ss, m) => ss + (Number(m.calories) || 0), 0) : 0),
      0
    );
    return { workouts: Array.isArray(wh) ? wh.length : 0, burned, eaten };
  } catch {
    return { workouts: 0, burned: 0, eaten: 0 };
  }
}

export default function Achievements() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ workouts: 0, burned: 0, eaten: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const local = readLocalStats();

      // If no logged-in user, show local-only
      if (!user) {
        if (!cancelled) {
          setStats(local);
          setLoading(false);
        }
        return;
      }

      // Logged-in: fetch remote, then take the max of local vs remote
      try {
        const [ws, dm] = await Promise.all([
          getWorkouts(user.id, { limit: 1000 }).catch(() => []),
          getDailyMetricsRange(user.id, null, null).catch(() => []),
        ]);

        const remoteWorkouts = Array.isArray(ws) ? ws.length : 0;
        const remoteBurned = Array.isArray(dm) ? dm.reduce((s, r) => s + (Number(r.cals_burned) || 0), 0) : 0;
        const remoteEaten = Array.isArray(dm) ? dm.reduce((s, r) => s + (Number(r.cals_eaten) || 0), 0) : 0;

        const merged = {
          workouts: Math.max(local.workouts, remoteWorkouts),
          burned: Math.max(local.burned, remoteBurned),
          eaten: Math.max(local.eaten, remoteEaten),
        };

        if (!cancelled) {
          setStats(merged);
          setLoading(false);
        }
      } catch (err) {
        console.error('[Achievements] remote fetch failed, using local only', err);
        if (!cancelled) {
          setStats(local);
          setLoading(false);
        }
      }
    }

    load();

    // Recompute local stats on visibility return (helps during active testing)
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        setStats(prev => {
          const currentLocal = readLocalStats();
          return {
            workouts: Math.max(prev.workouts, currentLocal.workouts),
            burned: Math.max(prev.burned, currentLocal.burned),
            eaten: Math.max(prev.eaten, currentLocal.eaten),
          };
        });
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [user?.id]);

  // Badges (tune thresholds as desired)
  const badges = [];
  if (stats.workouts >= 1) badges.push('🏁 First Workout');
  if (stats.workouts >= 10) badges.push('🔥 10 Workouts');
  if (stats.workouts >= 25) badges.push('💪 25 Workouts');
  if (stats.burned >= 5000) badges.push('⚡ 5,000 Calories Burned');
  if (stats.eaten >= 10000) badges.push('🍽 10,000 Calories Logged');

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom>Achievements</Typography>

      {loading ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 3 }}>
          <CircularProgress size={22} />
          <Typography variant="body2" color="text.secondary">Calculating your achievements…</Typography>
        </Box>
      ) : (
        <Paper variant="outlined">
          <List>
            {badges.length === 0 ? (
              <ListItem><ListItemText primary="No achievements yet." secondary="Log a workout or meal to start unlocking badges." /></ListItem>
            ) : (
              badges.map((b, i) => (
                <ListItem key={i}><ListItemText primary={b} /></ListItem>
              ))
            )}
          </List>
        </Paper>
      )}

      {/* Optional: quick totals for QA */}
      {!loading && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Totals — Workouts: {stats.workouts} • Burned: {stats.burned} • Eaten: {stats.eaten}
        </Typography>
      )}
    </Container>
  );
}
