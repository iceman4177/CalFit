// src/lib/db.js
import { supabase } from "./supabaseClient";

/** Ensure 'YYYY-MM-DD' (local day best-effort) */
function toIsoDay(day) {
  if (!day) return new Date().toISOString().slice(0, 10);
  try {
    if (typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
    const d = new Date(day);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch (e) {}
  return new Date().toISOString().slice(0, 10);
}

function isOnConflictSchemaError(err) {
  const msg = String(err?.message || "");
  // Common cases: no unique constraint, invalid on_conflict target, etc.
  return (
    err?.status === 400 ||
    /on_conflict/i.test(msg) ||
    /no unique/i.test(msg) ||
    /there is no unique constraint/i.test(msg) ||
    /constraint/i.test(msg)
  );
}

function isUuidLike(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ''));
}

// -----------------------------------------------------------------------------
// Profiles
// -----------------------------------------------------------------------------
export async function getOrCreateProfile(user) {
  if (!user) return null;

  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: created, error: upErr } = await supabase.from("profiles").insert({ id: user.id }).select().single();
  if (upErr) throw upErr;
  return created;
}

// -----------------------------------------------------------------------------
// Workouts (write)
// -----------------------------------------------------------------------------
export async function saveWorkout(userId, workout, sets = []) {
  if (!userId) throw new Error("saveWorkout: missing userId");
  if (!workout?.started_at) throw new Error("saveWorkout: missing started_at");

  const clientId = workout.client_id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null);
  if (!clientId) throw new Error("saveWorkout: missing client_id (uuid)");

  const localDay = workout.local_day || toIsoDay(workout.started_at);

  // Supabase public.workouts schema requires:
  // - client_id (uuid, NOT NULL)
  // - local_day (date, NOT NULL)
  // - items jsonb object with items.exercises array length > 0 (check constraint)
  const items = (() => {
    const it = workout.items;
    if (it && typeof it === 'object' && !Array.isArray(it) && Array.isArray(it.exercises) && it.exercises.length > 0) return it;
    if (Array.isArray(workout.exercises) && workout.exercises.length > 0) {
      return { exercises: workout.exercises };
    }
    return { exercises: [] };
  })();

  if (!Array.isArray(items.exercises) || items.exercises.length === 0) {
    throw new Error("saveWorkout: items.exercises must be a non-empty array");
  }

  const wRow = {
    user_id: userId,
    client_id: clientId,
    started_at: workout.started_at,
    ended_at: workout.ended_at ?? null,
    goal: workout.goal ?? null,
    notes: workout.notes ?? null,
    total_calories: workout.total_calories ?? 0,
    local_day: localDay,
    items,
    updated_at: new Date().toISOString(),
  };

  // Upsert using UNIQUE(user_id,client_id) (present in your schema)
  const res = await supabase
    .from("workouts")
    .upsert(wRow, { onConflict: "user_id,client_id" })
    .select()
    .maybeSingle();

  if (res.error) throw res.error;
  const w = res.data;

  if (sets?.length && w?.id) {
    const rows = sets.map((s) => ({
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
    const { error: setErr } = await supabase.from("workouts").insert(rows);
    if (setErr) throw setErr;
  }

  return w;
}

export async function upsertDailyMetrics(userId, day, deltaBurned = 0, deltaEaten = 0) {
  if (!userId) return;
  const isoDay = toIsoDay(day);

  const { error } = await supabase.rpc("bump_daily_metrics", {
    p_user_id: userId,
    p_day: isoDay,
    p_burn: Number(deltaBurned) || 0,
    p_eaten: Number(deltaEaten) || 0,
  });
  if (error) throw error;
}

/**
 * Set/merge absolute daily totals (not deltas).
 */
export async function upsertDailyTotals(userId, day, patch = {}) {
  if (!userId) throw new Error("upsertDailyTotals: missing userId");
  const isoDay = toIsoDay(day);

  const rowNew = {
    user_id: userId,
    local_day: isoDay,
    calories_burned: patch.calories_burned ?? null,
    calories_eaten: patch.calories_eaten ?? null,
    net_calories: patch.net_calories ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.from("daily_metrics").upsert(rowNew, { onConflict: "user_id,local_day" }).select().maybeSingle();

  if (error && /column .* does not exist/i.test(error.message || "")) {
    const rowLegacy = {
      user_id: userId,
      day: isoDay,
      cals_burned: patch.cals_burned ?? patch.calories_burned ?? null,
      cals_eaten: patch.cals_eaten ?? patch.calories_eaten ?? null,
      net_cals: patch.net_cals ?? patch.net_calories ?? null,
      updated_at: new Date().toISOString(),
    };
    const res2 = await supabase.from("daily_metrics").upsert(rowLegacy, { onConflict: "user_id,day" }).select().maybeSingle();
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
  if (!userId) throw new Error("saveMeal: missing userId");
  if (!meal?.eaten_at) throw new Error("saveMeal: missing eaten_at");

  const { data: m, error } = await supabase
    .from("meals")
    .insert({
      user_id: userId,
      eaten_at: meal.eaten_at,
      title: meal.title ?? null,
      total_calories: meal.total_calories ?? null,
    })
    .select()
    .single();
  if (error) throw error;

  if (items?.length) {
    const rows = items.map((it) => ({
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
    const { error: itErr } = await supabase.from("meal_items").insert(rows);
    if (itErr) throw itErr;
  }

  return m;
}

// -----------------------------------------------------------------------------
// Meals (read)
// -----------------------------------------------------------------------------
export async function getMeals(userId, { from, to, limit = 500 } = {}) {
  if (!userId) return [];
  let q = supabase
    .from("meals")
    .select("id, eaten_at, title, total_calories")
    .eq("user_id", userId)
    .order("eaten_at", { ascending: false })
    .limit(limit);

  if (from) q = q.gte("eaten_at", from);
  if (to) q = q.lte("eaten_at", to);

  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getMealItemsForMealIds(userId, mealIds = []) {
  if (!userId) return {};
  const ids = Array.isArray(mealIds) ? mealIds.filter(Boolean) : [];
  if (ids.length === 0) return {};

  const { data, error } = await supabase
    .from("meal_items")
    .select("meal_id, food_name, qty, unit, calories, protein, carbs, fat")
    .eq("user_id", userId)
    .in("meal_id", ids)
    .order("meal_id", { ascending: true });

  if (error) throw error;

  const map = {};
  for (const row of data || []) {
    const k = row.meal_id;
    if (!map[k]) map[k] = [];
    map[k].push(row);
  }
  return map;
}

// -----------------------------------------------------------------------------
// Readers (workouts + metrics)
// -----------------------------------------------------------------------------
export async function getWorkouts(userId, { limit = 100 } = {}) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from("workouts")
    .select("id, client_id, local_day, started_at, ended_at, goal, notes, total_calories, items")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function getDailyMetricsRange(userId, from, to) {
  if (!userId) return [];

  let q = supabase
    .from("daily_metrics")
    .select("local_day, calories_burned, calories_eaten, net_calories")
    .eq("user_id", userId)
    .order("local_day", { ascending: false });

  if (from) q = q.gte("local_day", toIsoDay(from));
  if (to) q = q.lte("local_day", toIsoDay(to));

  let { data, error } = await q;

  if (error && /column .* does not exist/i.test(error.message || "")) {
    let q2 = supabase
      .from("daily_metrics")
      .select("day, cals_burned, cals_eaten, net_cals")
      .eq("user_id", userId)
      .order("day", { ascending: false });

    if (from) q2 = q2.gte("day", toIsoDay(from));
    if (to) q2 = q2.lte("day", toIsoDay(to));

    const res2 = await q2;
    if (res2.error) throw res2.error;

    const rows2 = res2.data || [];
    return rows2.map((r) => ({
      day: r.day,
      burned: r.cals_burned ?? null,
      eaten: r.cals_eaten ?? null,
      net: r.net_cals ?? null,
    }));
  }

  if (error) throw error;

  const rows = data || [];
  return rows.map((r) => ({
    day: r.local_day,
    burned: r.calories_burned ?? null,
    eaten: r.calories_eaten ?? null,
    net: r.net_calories ?? null,
  }));
}

