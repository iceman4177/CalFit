// src/lib/db.js
import { supabase } from './supabaseClient';

/** Ensure 'YYYY-MM-DD' */
function toIsoDay(day) {
  if (!day) return new Date().toISOString().slice(0, 10);
  // Accept Date, string, etc.
  try {
    if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
    const d = new Date(day);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch {}
  return new Date().toISOString().slice(0, 10);
}

// -----------------------------------------------------------------------------
// Profiles
// -----------------------------------------------------------------------------
export async function getOrCreateProfile(user) {
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: created, error: upErr } = await supabase
    .from('profiles')
    .insert({ id: user.id })
    .select()
    .single();
  if (upErr) throw upErr;
  return created;
}

// -----------------------------------------------------------------------------
// Workouts
// -----------------------------------------------------------------------------
export async function saveWorkout(userId, workout, sets = []) {
  if (!userId) throw new Error('saveWorkout: missing userId');

  const { data: w, error } = await supabase
    .from('workouts')
    .insert({
      user_id: userId,
      started_at: workout.started_at,
      ended_at: workout.ended_at ?? null,
      goal: workout.goal ?? null,
      notes: workout.notes ?? null,
    })
    .select()
    .single();
  if (error) throw error;

  if (sets.length) {
    const rows = sets.map(s => ({
      workout_id: w.id,
      user_id: userId,
      exercise_name: s.exercise_name,
      equipment: s.equipment ?? null,
      muscle_group: s.muscle_group ?? null,
      weight: s.weight ?? null,
      reps: s.reps ?? null,
      tempo: s.tempo ?? null,
      volume: s.volume ?? null,
    }));
    const { error: setErr } = await supabase.from('workout_sets').insert(rows);
    if (setErr) throw setErr;
  }

  return w;
}

// -----------------------------------------------------------------------------
// Daily metrics (atomic upsert via RPC to avoid 409 conflicts)
// Requires SQL function:
//   bump_daily_metrics(p_user_id uuid, p_day date, p_burn numeric, p_eaten numeric)
// -----------------------------------------------------------------------------
export async function upsertDailyMetrics(userId, day, deltaBurned = 0, deltaEaten = 0) {
  if (!userId) return;
  const isoDay = toIsoDay(day);

  const { error } = await supabase.rpc('bump_daily_metrics', {
    p_user_id: userId,
    p_day: isoDay,
    p_burn: Number(deltaBurned) || 0,
    p_eaten: Number(deltaEaten) || 0,
  });
  if (error) throw error;
}

// -----------------------------------------------------------------------------
// Meals
// -----------------------------------------------------------------------------
export async function saveMeal(userId, meal, items = []) {
  if (!userId) throw new Error('saveMeal: missing userId');

  const { data: m, error } = await supabase
    .from('meals')
    .insert({
      user_id: userId,
      eaten_at: meal.eaten_at,                // ISO timestamp
      title: meal.title ?? null,
      total_calories: meal.total_calories ?? null,
    })
    .select()
    .single();
  if (error) throw error;

  if (items.length) {
    const rows = items.map(it => ({
      meal_id: m.id,
      user_id: userId,
      food_name: it.food_name,
      qty: it.qty ?? null,
      unit: it.unit ?? null,
      calories: it.calories ?? null,
      protein: it.protein ?? null,
      carbs: it.carbs ?? null,
      fat: it.fat ?? null,
    }));
    const { error: itErr } = await supabase.from('meal_items').insert(rows);
    if (itErr) throw itErr;
  }

  return m;
}
