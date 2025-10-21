// src/lib/db.js
import { supabase } from './supabaseClient';

/** Ensure 'YYYY-MM-DD' (local day best-effort) */
function toIsoDay(day) {
  if (!day) return new Date().toISOString().slice(0, 10);
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
// Workouts (write)
//   - Idempotency via client-generated UUID: workout.client_id
//   - Requires UNIQUE constraint on (client_id) OR (user_id, client_id)
//   - Falls back to insert if onConflict key not present in schema
// -----------------------------------------------------------------------------
export async function saveWorkout(userId, workout, sets = []) {
  if (!userId) throw new Error('saveWorkout: missing userId');
  if (!workout?.started_at) throw new Error('saveWorkout: missing started_at');

  // Build row with optional client_id for idempotency
  const wRow = {
    user_id: userId,
    client_id: workout.client_id ?? null, // optional but recommended (UUID)
    started_at: workout.started_at,       // ISO timestamp (NOT NULL in schema)
    ended_at: workout.ended_at ?? null,
    goal: workout.goal ?? null,
    notes: workout.notes ?? null,
    total_calories: workout.total_calories ?? null,
  };

  let w, upsertErr;

  if (wRow.client_id) {
    // Preferred: idempotent upsert by client_id
    const res = await supabase
      .from('workouts')
      .upsert(wRow, { onConflict: 'client_id' })
      .select()
      .single();
    upsertErr = res.error;
    w = res.data;
  }

  // If no client_id or upsert failed due to missing UNIQUE, fall back safely.
  if (!w || upsertErr) {
    const { data, error } = await supabase
      .from('workouts')
      .insert(wRow)
      .select()
      .single();
    if (error) throw error;
    w = data;
  }

  if (sets?.length) {
    const rows = sets.map((s, idx) => ({
      workout_id: w.id,
      user_id: userId,
      exercise_name: s.exercise_name,
      equipment: s.equipment ?? null,
      muscle_group: s.muscle_group ?? null,
      weight: s.weight ?? null,
      reps: s.reps ?? null,
      tempo: s.tempo ?? null,
      volume: s.volume ?? null,
      idx: s.idx ?? idx, // preserve order if provided
    }));
    const { error: setErr } = await supabase.from('workout_sets').insert(rows);
    if (setErr) throw setErr;
  }

  return w;
}

// -----------------------------------------------------------------------------
// Daily metrics (atomic upsert via RPC) + direct upsert helper
//   - You already use bump_daily_metrics(p_user_id uuid, p_day date, p_burn numeric, p_eaten numeric)
//   - Keep RPC for additive bumps (delta-based).
//   - Provide a row-level upsert for absolute totals when needed.
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

/**
 * Set/merge absolute daily totals (not deltas). Uses onConflict='user_id,local_day'.
 * Requires a UNIQUE constraint on (user_id, local_day).
 * Fields: { calories_burned?, calories_eaten?, net_calories? } (new schema)
 *         or { cals_burned?, cals_eaten?, net_cals? } (legacy schema)
 */
export async function upsertDailyTotals(userId, day, patch = {}) {
  if (!userId) throw new Error('upsertDailyTotals: missing userId');
  const isoDay = toIsoDay(day);

  // Prefer new column names if your schema has them; otherwise fall back.
  const rowNew = {
    user_id: userId,
    local_day: isoDay,
    calories_burned: patch.calories_burned ?? null,
    calories_eaten: patch.calories_eaten ?? null,
    net_calories: patch.net_calories ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('daily_metrics')
    .upsert(rowNew, { onConflict: 'user_id,local_day' })
    .select()
    .maybeSingle();

  // If the above fails due to legacy columns, try legacy mapping:
  if (error && /column .* does not exist/i.test(error.message || '')) {
    const rowLegacy = {
      user_id: userId,
      day: isoDay,
      cals_burned: patch.cals_burned ?? patch.calories_burned ?? null,
      cals_eaten: patch.cals_eaten ?? patch.calories_eaten ?? null,
      net_cals: patch.net_cals ?? patch.net_calories ?? null,
      updated_at: new Date().toISOString(),
    };
    const res2 = await supabase
      .from('daily_metrics')
      .upsert(rowLegacy, { onConflict: 'user_id,day' })
      .select()
      .maybeSingle();
    if (res2.error) throw res2.error;
    return res2.data ?? null;
  }

  if (error) throw error;
  return data ?? null;
}

// -----------------------------------------------------------------------------
// Meals (write)
// -----------------------------------------------------------------------------
export async function saveMeal(userId, meal, items = []) {
  if (!userId) throw new Error('saveMeal: missing userId');
  if (!meal?.eaten_at) throw new Error('saveMeal: missing eaten_at');

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

  if (items?.length) {
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

// -----------------------------------------------------------------------------
// Readers (for pages pulling from Supabase)
// -----------------------------------------------------------------------------
export async function getWorkouts(userId, { limit = 100 } = {}) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('workouts')
    .select('id, started_at, ended_at, goal, notes, total_calories')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getWorkoutSetsFor(workoutId, userId) {
  const { data, error } = await supabase
    .from('workout_sets')
    .select('exercise_name, reps, weight, tempo, volume, created_at, idx')
    .eq('workout_id', workoutId)
    .eq('user_id', userId)
    .order('idx', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Read daily metrics in a schema-agnostic way and normalize the output:
 * returns [{ day: 'YYYY-MM-DD', burned: number|null, eaten: number|null, net: number|null }]
 */
export async function getDailyMetricsRange(userId, from, to) {
  if (!userId) return [];

  // Try new column names first
  let q = supabase
    .from('daily_metrics')
    .select('local_day, calories_burned, calories_eaten, net_calories')
    .eq('user_id', userId)
    .order('local_day', { ascending: false });

  if (from) q = q.gte('local_day', toIsoDay(from));
  if (to)   q = q.lte('local_day', toIsoDay(to));

  let { data, error } = await q;

  // Fallback to legacy names if needed
  if (error && /column .* does not exist/i.test(error.message || '')) {
    let q2 = supabase
      .from('daily_metrics')
      .select('day, cals_burned, cals_eaten, net_cals')
      .eq('user_id', userId)
      .order('day', { ascending: false });
    if (from) q2 = q2.gte('day', toIsoDay(from));
    if (to)   q2 = q2.lte('day', toIsoDay(to));
    const res2 = await q2;
    if (res2.error) throw res2.error;
    const rows2 = res2.data || [];
    return rows2.map(r => ({
      day: r.day,
      burned: r.cals_burned ?? null,
      eaten: r.cals_eaten ?? null,
      net: r.net_cals ?? null,
    }));
  }

  if (error) throw error;
  const rows = data || [];
  return rows.map(r => ({
    day: r.local_day,
    burned: r.calories_burned ?? null,
    eaten: r.calories_eaten ?? null,
    net: r.net_calories ?? null,
  }));
}
