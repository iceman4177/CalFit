// src/lib/localFirst.js
// Local-first wrappers for workouts and daily metrics.
// Ensures idempotent client_id and queues failed cloud writes.

import { ensureClientId, enqueue } from './sync';
import { isOnline } from '../utils/network';
import { supabase } from '../lib/supabaseClient';

// ---- local storage helpers (non-destructive) ----
function readLS(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}
function writeLS(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ---- WORKOUTS ----
export function saveWorkoutLocalFirst(workout) {
  // 1) normalize + ensure idempotent client_id
  ensureClientId(workout);
  if (!workout.createdAt) workout.createdAt = new Date().toISOString();

  // 2) local-first persistence (append to workoutHistory)
  const wh = readLS('workoutHistory', []);
  // If a workout with same client_id exists, replace it (edit flow)
  const idx = wh.findIndex(w => w.client_id === workout.client_id);
  if (idx >= 0) wh[idx] = workout; else wh.push(workout);
  writeLS('workoutHistory', wh);

  // 3) cloud attempt or queue
  if (!isOnline()) {
    enqueue({ type: 'workout.upsert', payload: workout });
    return { ok: true, queued: true, localOnly: true };
  }

  return supabase.from('workouts')
    .upsert({ ...workout, client_updated_at: new Date().toISOString() }, { onConflict: 'client_id' })
    .then(({ error }) => {
      if (error) {
        enqueue({ type: 'workout.upsert', payload: workout });
        return { ok: true, queued: true, error };
      }
      return { ok: true, queued: false };
    })
    .catch(err => {
      enqueue({ type: 'workout.upsert', payload: workout });
      return { ok: true, queued: true, error: err };
    });
}

export function deleteWorkoutLocalFirst(client_id) {
  // 1) local delete
  const wh = readLS('workoutHistory', []);
  const next = wh.filter(w => w.client_id !== client_id);
  writeLS('workoutHistory', next);

  // 2) cloud attempt or queue
  if (!isOnline()) {
    enqueue({ type: 'workout.delete', payload: { client_id } });
    return { ok: true, queued: true, localOnly: true };
  }

  return supabase.from('workouts').delete().eq('client_id', client_id)
    .then(({ error }) => {
      if (error) {
        enqueue({ type: 'workout.delete', payload: { client_id } });
        return { ok: true, queued: true, error };
      }
      return { ok: true, queued: false };
    })
    .catch(err => {
      enqueue({ type: 'workout.delete', payload: { client_id } });
      return { ok: true, queued: true, error: err };
    });
}

// ---- DAILY METRICS (merge by user_id + date_key; local totals authoritative) ----
export function upsertDailyMetricsLocalFirst({ user_id, date_key, consumed, burned, net }) {
  const key = 'daily_metrics_local';
  const bag = readLS(key, {});
  bag[`${user_id}|${date_key}`] = { user_id, date_key, consumed, burned, net, updatedAt: new Date().toISOString() };
  writeLS(key, bag);

  const payload = {
    user_id, date_key, consumed, burned, net,
  };

  if (!isOnline()) {
    enqueue({ type: 'daily_metrics.upsert', payload });
    return { ok: true, queued: true, localOnly: true };
  }

  return supabase.from('daily_metrics')
    .upsert({ ...payload, client_updated_at: new Date().toISOString(), local_authoritative: true }, { onConflict: 'user_id,date_key' })
    .then(({ error }) => {
      if (error) {
        enqueue({ type: 'daily_metrics.upsert', payload });
        return { ok: true, queued: true, error };
      }
      return { ok: true, queued: false };
    })
    .catch(err => {
      enqueue({ type: 'daily_metrics.upsert', payload });
      return { ok: true, queued: true, error: err };
    });
}
