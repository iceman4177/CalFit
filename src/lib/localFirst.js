// src/lib/localFirst.js
// Local-first wrappers for workouts, meals, and daily metrics.
// Ensures idempotent client_id and queues failed cloud writes for later sync.

import { ensureClientId, enqueue } from './sync';
import { isOnline } from '../utils/network';
import { supabase } from '../lib/supabaseClient';

// ---------- localStorage helpers ----------
function readLS(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}
function writeLS(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ---------- WORKOUTS ----------
export async function saveWorkoutLocalFirst(workout) {
  // 1) Normalize & ensure idempotent identifiers
  ensureClientId(workout);
  if (!workout.createdAt) workout.createdAt = new Date().toISOString();

  // 2) Local-first persistence (append/replace by client_id)
  const wh = readLS('workoutHistory', []);
  const idx = wh.findIndex(w => w.client_id === workout.client_id);
  if (idx >= 0) wh[idx] = workout; else wh.push(workout);
  writeLS('workoutHistory', wh);

  // 3) Try cloud upsert; on failure (or offline) enqueue for sync
  if (!isOnline()) {
    enqueue({ type: 'workout.upsert', payload: workout });
    return { ok: true, queued: true, localOnly: true };
  }

  try {
    const { error } = await supabase
      .from('workouts')
      .upsert({ ...workout, client_updated_at: new Date().toISOString() }, { onConflict: 'client_id' });
    if (error) {
      enqueue({ type: 'workout.upsert', payload: workout });
      return { ok: true, queued: true, error };
    }
    return { ok: true, queued: false };
  } catch (err) {
    enqueue({ type: 'workout.upsert', payload: workout });
    return { ok: true, queued: true, error: err };
  }
}

export async function deleteWorkoutLocalFirst(client_id) {
  // 1) Local delete
  const wh = readLS('workoutHistory', []);
  const next = wh.filter(w => w.client_id !== client_id);
  writeLS('workoutHistory', next);

  // 2) Cloud attempt or queue
  if (!isOnline()) {
    enqueue({ type: 'workout.delete', payload: { client_id } });
    return { ok: true, queued: true, localOnly: true };
  }

  try {
    const { error } = await supabase.from('workouts').delete().eq('client_id', client_id);
    if (error) {
      enqueue({ type: 'workout.delete', payload: { client_id } });
      return { ok: true, queued: true, error };
    }
    return { ok: true, queued: false };
  } catch (err) {
    enqueue({ type: 'workout.delete', payload: { client_id } });
    return { ok: true, queued: true, error: err };
  }
}

// ---------- MEALS ----------
export async function saveMealLocalFirst(meal) {
  // meal fields expected: { eaten_at, title, total_calories, ... }
  ensureClientId(meal);
  if (!meal.eaten_at) meal.eaten_at = new Date().toISOString();

  // Local structure: [{ date: 'YYYY-MM-DD', meals: [...] }]
  const dayKey = (meal.__day) || new Date(meal.eaten_at).toISOString().slice(0,10);
  const days = readLS('mealHistory', []);
  let day = days.find(d => d.date === dayKey);
  if (!day) { day = { date: dayKey, meals: [] }; days.push(day); }

  const idx = day.meals.findIndex(m => m.client_id === meal.client_id);
  const compact = { client_id: meal.client_id, name: meal.title, calories: Number(meal.total_calories || 0) || 0 };
  if (idx >= 0) day.meals[idx] = compact; else day.meals.push(compact);
  writeLS('mealHistory', days);

  if (!isOnline()) {
    enqueue({ type: 'meal.upsert', payload: { ...meal, __day: dayKey } });
    return { ok: true, queued: true, localOnly: true };
  }

  try {
    const row = { ...meal, client_updated_at: new Date().toISOString() };
    const { error } = await supabase.from('meals').upsert(row, { onConflict: 'client_id' });
    if (error) {
      enqueue({ type: 'meal.upsert', payload: { ...meal, __day: dayKey } });
      return { ok: true, queued: true, error };
    }
    return { ok: true, queued: false };
  } catch (err) {
    enqueue({ type: 'meal.upsert', payload: { ...meal, __day: dayKey } });
    return { ok: true, queued: true, error: err };
  }
}

// ---------- DAILY METRICS ----------
export async function upsertDailyMetricsLocalFirst({ user_id, date_key, consumed, burned, net }) {
  // Cache a local copy for immediate UI
  const key = 'daily_metrics_local';
  const bag = readLS(key, {});
  bag[`${user_id}|${date_key}`] = {
    user_id, date_key, consumed, burned, net, updatedAt: new Date().toISOString()
  };
  writeLS(key, bag);

  const payload = { user_id, date_key, consumed, burned, net };

  if (!isOnline()) {
    enqueue({ type: 'daily_metrics.upsert', payload });
    return { ok: true, queued: true, localOnly: true };
  }

  try {
    const { error } = await supabase
      .from('daily_metrics')
      .upsert(
        { ...payload, client_updated_at: new Date().toISOString(), local_authoritative: true },
        { onConflict: 'user_id,date_key' }
      );
    if (error) {
      enqueue({ type: 'daily_metrics.upsert', payload });
      return { ok: true, queued: true, error };
    }
    return { ok: true, queued: false };
  } catch (err) {
    enqueue({ type: 'daily_metrics.upsert', payload });
    return { ok: true, queued: true, error: err };
  }
}
