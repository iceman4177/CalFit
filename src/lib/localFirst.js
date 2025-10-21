// src/lib/localFirst.js
// Local-first wrappers for workouts, meals, and daily metrics.
// Ensures idempotent client_id and queues failed cloud writes for later sync.

import { ensureClientId, enqueue } from './sync';
import { isOnline } from '../utils/network';
import { supabase } from '../lib/supabaseClient';

// ---------- small utils ----------
function readLS(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}
function writeLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function localDayISO(d = new Date()) {
  const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return ld.toISOString().slice(0, 10); // "YYYY-MM-DD"
}
function num(n, def = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : def;
}

// ---------- WORKOUTS ----------
export async function saveWorkoutLocalFirst(workout) {
  // 1) Normalize IDs & timestamps
  ensureClientId(workout);
  if (!workout.createdAt) workout.createdAt = new Date().toISOString();

  // Compute a reliable total for local UI
  const total =
    (typeof workout.total_calories === 'number' && !Number.isNaN(workout.total_calories))
      ? workout.total_calories
      : (typeof workout.totalCalories === 'number' && !Number.isNaN(workout.totalCalories))
        ? workout.totalCalories
        : Array.isArray(workout.exercises)
          ? workout.exercises.reduce((s, ex) => s + num(ex?.calories), 0)
          : 0;

  // 2) Local-first persistence (History expects camelCase)
  const history = readLS('workoutHistory', []);
  const localRow = {
    id: workout.id || workout.localId || `wf_${Date.now()}`,
    date: workout.date || new Date().toLocaleDateString('en-US'),
    name: workout.name || 'Workout',
    totalCalories: Math.round(total * 100) / 100,
    total_calories: Math.round(total * 100) / 100, // mirror for consistency
    exercises: Array.isArray(workout.exercises) ? workout.exercises : [],
    createdAt: workout.createdAt,
    uploaded: !!workout.uploaded,
    client_id: workout.client_id,
  };

  const idx = history.findIndex(w => w.client_id === localRow.client_id);
  if (idx >= 0) history[idx] = localRow; else history.unshift(localRow);
  writeLS('workoutHistory', history);

  // Broadcast burned calories for banner
  try {
    window.dispatchEvent(new CustomEvent('slimcal:burned:update', {
      detail: { date: localDayISO(), burned: localRow.totalCalories }
    }));
  } catch {}

  // 3) Cloud upsert (best-effort)
  if (!isOnline()) {
    enqueue({ type: 'workout.upsert', payload: { ...workout, total_calories: localRow.total_calories } });
    return { ok: true, queued: true, localOnly: true };
  }

  try {
    // Ensure DB-required fields (no extra columns)
    const row = {
      user_id: workout.user_id ?? null,
      client_id: workout.client_id,
      started_at: workout.started_at || new Date().toISOString(),
      ended_at: workout.ended_at || workout.started_at || new Date().toISOString(),
      total_calories: localRow.total_calories,
      goal: workout.goal ?? null,
      notes: workout.notes ?? null,
    };

    if (!row.user_id) return { ok: true, queued: false, anon: true }; // not signed in

    const res = await supabase
      .from('workouts')
      .upsert(row, { onConflict: 'client_id' })
      .select()
      .maybeSingle();

    if (res.error) {
      // fallback to insert if unique index not there yet
      const ins = await supabase.from('workouts').insert(row).select().maybeSingle();
      if (ins.error) throw ins.error;
    }
    return { ok: true, queued: false };
  } catch (err) {
    enqueue({ type: 'workout.upsert', payload: { ...workout, total_calories: localRow.total_calories } });
    return { ok: true, queued: true, error: err };
  }
}

export async function deleteWorkoutLocalFirst(client_id) {
  const wh = readLS('workoutHistory', []);
  writeLS('workoutHistory', wh.filter(w => w.client_id !== client_id));

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
  ensureClientId(meal);
  if (!meal.eaten_at) meal.eaten_at = new Date().toISOString();

  const dayKey = meal.__day || meal.eaten_at.slice(0, 10);
  const days = readLS('mealHistory', []);
  let day = days.find(d => d.date === dayKey);
  if (!day) { day = { date: dayKey, meals: [] }; days.push(day); }

  const idx = day.meals.findIndex(m => m.client_id === meal.client_id);
  const compact = { client_id: meal.client_id, name: meal.title, calories: num(meal.total_calories) };
  if (idx >= 0) day.meals[idx] = compact; else day.meals.push(compact);
  writeLS('mealHistory', days);

  if (!isOnline()) {
    enqueue({ type: 'meal.upsert', payload: { ...meal, __day: dayKey } });
    return { ok: true, queued: true, localOnly: true };
  }

  try {
    // Minimal schema-safe row (no extra columns)
    const row = {
      client_id: meal.client_id,
      user_id: meal.user_id ?? null,
      eaten_at: meal.eaten_at,
      title: meal.title ?? null,
      total_calories: Number(meal.total_calories) || 0,
    };
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
/**
 * Accepts either the new shape:
 *   { user_id, local_day, calories_eaten, calories_burned, net_calories }
 * or the legacy shape:
 *   { user_id, date_key, consumed, burned, net }
 */
export async function upsertDailyMetricsLocalFirst(input) {
  // Normalize inputs
  const local_day = input.local_day || input.date_key || localDayISO();
  const eaten = num(input.calories_eaten ?? input.consumed);
  const burned = num(input.calories_burned ?? input.burned);
  const net = num(input.net_calories ?? input.net ?? (eaten - burned));
  const user_id = input.user_id || null;

  // 1) Local cache for immediate UI
  const bag = readLS('dailyMetricsCache', {});
  bag[local_day] = { eaten, burned, net, updated_at: new Date().toISOString() };
  writeLS('dailyMetricsCache', bag);

  try {
    window.dispatchEvent(new CustomEvent('slimcal:consumed:update', {
      detail: { date: local_day, eaten }
    }));
    window.dispatchEvent(new CustomEvent('slimcal:burned:update', {
      detail: { date: local_day, burned }
    }));
  } catch {}

  // 2) Cloud upsert (best-effort)
  const payloadNew = {
    user_id,
    local_day,
    calories_eaten: eaten,
    calories_burned: burned,
    net_calories: net,
    updated_at: new Date().toISOString(),
  };

  if (!isOnline() || !user_id) {
    enqueue({ type: 'daily_metrics.upsert', payload: payloadNew });
    return { ok: true, queued: true, localOnly: !user_id || !isOnline() };
  }

  try {
    const res = await supabase
      .from('daily_metrics')
      .upsert(payloadNew, { onConflict: 'user_id,local_day' })
      .select()
      .maybeSingle();

    // Legacy fallback if table still has old columns
    if (res.error && /column .* does not exist/i.test(res.error.message || '')) {
      const legacy = {
        user_id,
        day: local_day,
        cals_eaten: eaten,
        cals_burned: burned,
        net_cals: net,
        updated_at: new Date().toISOString(),
      };
      const res2 = await supabase
        .from('daily_metrics')
        .upsert(legacy, { onConflict: 'user_id,day' })
        .select()
        .maybeSingle();
      if (res2.error) throw res2.error;
    } else if (res.error) {
      throw res.error;
    }
    return { ok: true, queued: false };
  } catch (err) {
    enqueue({ type: 'daily_metrics.upsert', payload: payloadNew });
    return { ok: true, queued: true, error: err };
  }
}
