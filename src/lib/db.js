// src/lib/db.js
import { supabase } from './supabaseClient';

// ---- Profiles ---------------------------------------------------------------
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

// ---- Workouts ---------------------------------------------------------------
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
      equipment: s.equipment,
      muscle_group: s.muscle_group,
      weight: s.weight,
      reps: s.reps,
      tempo: s.tempo,
      volume: s.volume,
    }));
    const { error: setErr } = await supabase.from('workout_sets').insert(rows);
    if (setErr) throw setErr;
  }
  return w;
}

export async function upsertDailyMetrics(userId, day, deltaBurned = 0, deltaEaten = 0) {
  if (!userId) return;
  const { data: existing, error: selErr } = await supabase
    .from('daily_metrics')
    .select('*')
    .eq('user_id', userId)
    .eq('day', day)
    .maybeSingle();
  if (selErr) throw selErr;

  if (!existing) {
    const { error: insErr } = await supabase.from('daily_metrics').insert({
      user_id: userId,
      day,
      cals_burned: deltaBurned,
      cals_eaten: deltaEaten,
    });
    if (insErr) throw insErr;
    return;
  }
  const { error: updErr } = await supabase
    .from('daily_metrics')
    .update({
      cals_burned: (existing.cals_burned ?? 0) + deltaBurned,
      cals_eaten:  (existing.cals_eaten  ?? 0) + deltaEaten,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id);
  if (updErr) throw updErr;
}

// ---- Meals ------------------------------------------------------------------
export async function saveMeal(userId, meal, items = []) {
  if (!userId) throw new Error('saveMeal: missing userId');
  const { data: m, error } = await supabase
    .from('meals')
    .insert({
      user_id: userId,
      eaten_at: meal.eaten_at,
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
      qty: it.qty,
      unit: it.unit,
      calories: it.calories,
      protein: it.protein,
      carbs: it.carbs,
      fat: it.fat,
    }));
    const { error: itErr } = await supabase.from('meal_items').insert(rows);
    if (itErr) throw itErr;
  }
  return m;
}
