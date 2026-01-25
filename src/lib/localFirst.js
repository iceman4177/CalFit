// src/lib/localFirst.js
// Local-first persistence + best-effort cloud upserts.
// Goal: meals and workouts behave the SAME cross-device.
//
// - Writes to localStorage immediately
// - Queues ops for offline sync
// - If signed in, upserts to Supabase immediately (best-effort)
// - Updates daily_metrics for cross-device banner truth

import { supabase } from './supabaseClient';

// --------------------- tiny helpers ---------------------
function safeNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function localDayISO(d = new Date()) {
  try {
    const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return ld.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function todayUS() {
  try {
    return new Date().toLocaleDateString('en-US');
  } catch {
    return '';
  }
}

function getOrCreateClientId() {
  try {
    let cid = localStorage.getItem('clientId');
    if (!cid) {
      cid = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `cid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      localStorage.setItem('clientId', cid);
    }
    return cid;
  } catch {
    return 'anon';
  }
}

function makeUUID(prefix = 'id') {
  try {
    return (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  } catch {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

// --------------------- pending ops queue ---------------------
// Keep this format simple; sync.js can flush it, but we ALSO attempt cloud writes inline.
// This makes it work even if sync.js is imperfect.
const PENDING_KEY = 'slimcal:pendingOps:v1';

function readPendingOps() {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writePendingOps(list) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(Array.isArray(list) ? list : []));
  } catch {}
}

function enqueueOp(op) {
  try {
    const list = readPendingOps();
    list.push({
      id: makeUUID('op'),
      ts: Date.now(),
      ...op
    });
    writePendingOps(list);
  } catch {}
}

// --------------------- local caches ---------------------
function readMealHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
function writeMealHistory(arr) {
  try {
    localStorage.setItem('mealHistory', JSON.stringify(Array.isArray(arr) ? arr : []));
  } catch {}
}

function readWorkoutHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
function writeWorkoutHistory(arr) {
  try {
    localStorage.setItem('workoutHistory', JSON.stringify(Array.isArray(arr) ? arr : []));
  } catch {}
}

function readDailyMetricsCache() {
  try {
    const raw = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}
function writeDailyMetricsCache(obj) {
  try {
    localStorage.setItem('dailyMetricsCache', JSON.stringify(obj && typeof obj === 'object' ? obj : {}));
  } catch {}
}

function dispatchConsumed(dayISO, consumed) {
  try {
    window.dispatchEvent(
      new CustomEvent('slimcal:consumed:update', { detail: { date: dayISO, consumed: safeNum(consumed, 0) } })
    );
  } catch {}
}

function dispatchBurned(dayISO, burned) {
  try {
    window.dispatchEvent(
      new CustomEvent('slimcal:burned:update', { detail: { date: dayISO, burned: safeNum(burned, 0) } })
    );
  } catch {}
}

// --------------------- Cloud upsert helpers ---------------------
async function upsertRow(table, row, onConflict) {
  if (!supabase) return { ok: false, error: 'no-supabase' };
  try {
    const res = await supabase.from(table).upsert(row, { onConflict }).select().maybeSingle();
    if (res?.error) return { ok: false, error: res.error };
    return { ok: true, data: res?.data };
  } catch (e) {
    return { ok: false, error: e };
  }
}

// --------------------- daily metrics (truth) ---------------------
/**
 * upsertDailyMetricsLocalFirst
 * Accepts flexible keys because older code used different names:
 * - eaten/consumed/calories_eaten/cals_eaten
 * - burned/calories_burned/cals_burned
 */
export async function upsertDailyMetricsLocalFirst(payload = {}) {
  const userId = payload?.user_id || payload?.userId || null;

  const dayISO =
    payload?.local_day ||
    payload?.day ||
    payload?.dayISO ||
    localDayISO(new Date());

  const eaten =
    safeNum(payload?.calories_eaten, NaN) ??
    safeNum(payload?.cals_eaten, NaN) ??
    safeNum(payload?.consumed, NaN) ??
    safeNum(payload?.eaten, NaN);

  const burned =
    safeNum(payload?.calories_burned, NaN) ??
    safeNum(payload?.cals_burned, NaN) ??
    safeNum(payload?.burned, NaN);

  const eatenFinal = Number.isFinite(eaten) ? eaten : safeNum(payload?.caloriesEaten, 0);
  const burnedFinal = Number.isFinite(burned) ? burned : safeNum(payload?.caloriesBurned, 0);

  // ✅ local cache always updated
  const cache = readDailyMetricsCache();
  cache[dayISO] = {
    eaten: Math.round(eatenFinal || 0),
    burned: Math.round(burnedFinal || 0),
    consumed: Math.round(eatenFinal || 0), // keep both keys so banner reads either
    net: Math.round((eatenFinal || 0) - (burnedFinal || 0)),
    updated_at: new Date().toISOString()
  };
  writeDailyMetricsCache(cache);

  try {
    localStorage.setItem('consumedToday', String(Math.round(eatenFinal || 0)));
    localStorage.setItem('burnedToday', String(Math.round(burnedFinal || 0)));
  } catch {}

  dispatchConsumed(dayISO, eatenFinal);
  dispatchBurned(dayISO, burnedFinal);

  // Queue op for offline safety
  enqueueOp({
    type: 'upsert',
    table: 'daily_metrics',
    user_id: userId,
    payload: {
      user_id: userId,
      local_day: dayISO,
      calories_eaten: Math.round(eatenFinal || 0),
      calories_burned: Math.round(burnedFinal || 0),
      net_calories: Math.round((eatenFinal || 0) - (burnedFinal || 0)),
      updated_at: new Date().toISOString()
    }
  });

  // Best-effort cloud upsert
  if (!userId) return { ok: true, localOnly: true, dayISO };

  // New schema first
  const rowNew = {
    user_id: userId,
    local_day: dayISO,
    calories_eaten: Math.round(eatenFinal || 0),
    calories_burned: Math.round(burnedFinal || 0),
    net_calories: Math.round((eatenFinal || 0) - (burnedFinal || 0)),
    updated_at: new Date().toISOString()
  };

  const resNew = await upsertRow('daily_metrics', rowNew, 'user_id,local_day');
  if (resNew.ok) return { ok: true, dayISO };

  // Legacy fallback (if local_day column not present)
  const msg = String(resNew?.error?.message || '');
  if (/column .*local_day.* does not exist/i.test(msg)) {
    const rowOld = {
      user_id: userId,
      day: dayISO,
      cals_eaten: Math.round(eatenFinal || 0),
      cals_burned: Math.round(burnedFinal || 0),
      net_cals: Math.round((eatenFinal || 0) - (burnedFinal || 0)),
      updated_at: new Date().toISOString()
    };
    const resOld = await upsertRow('daily_metrics', rowOld, 'user_id,day');
    if (resOld.ok) return { ok: true, dayISO, legacy: true };
    return { ok: false, error: resOld.error, dayISO };
  }

  return { ok: false, error: resNew.error, dayISO };
}

// --------------------- meals (already good) ---------------------
export async function saveMealLocalFirst(payload = {}) {
  const userId = payload?.user_id || null;

  // Local mealHistory is managed by MealTracker, but we still queue cloud.
  enqueueOp({
    type: 'upsert',
    table: 'meals',
    user_id: userId,
    payload
  });

  if (!userId) return { ok: true, localOnly: true };

  // Best-effort upsert
  // Your meals table likely uses client_id for conflict.
  const row = {
    user_id: userId,
    client_id: payload.client_id || makeUUID('meal'),
    eaten_at: payload.eaten_at || new Date().toISOString(),
    title: payload.title || payload.name || 'Meal',
    total_calories: safeNum(payload.total_calories ?? payload.calories, 0),

    protein_g: payload.protein_g ?? null,
    carbs_g: payload.carbs_g ?? null,
    fat_g: payload.fat_g ?? null,

    food_id: payload.food_id ?? null,
    portion_id: payload.portion_id ?? null,
    portion_label: payload.portion_label ?? null,
    qty: payload.qty ?? 1,
    unit: payload.unit ?? 'serving',
    food_name: payload.food_name ?? payload.title ?? null,

    created_at: payload.created_at || new Date().toISOString()
  };

  // Try common conflicts
  let res = await upsertRow('meals', row, 'user_id,client_id');
  if (res.ok) return { ok: true };

  res = await upsertRow('meals', row, 'client_id');
  if (res.ok) return { ok: true, noUserConflict: true };

  return { ok: false, error: res.error };
}

// --------------------- workouts (THIS was the problem) ---------------------
function normalizeWorkoutForLocal(payload = {}) {
  const now = new Date();
  const dUS = payload.date || payload.__day || todayUS();
  const dayISO = payload.__local_day || payload.local_day || localDayISO(now);

  const client_id = payload.client_id || payload.id || makeUUID('workout');

  const exercises = Array.isArray(payload.exercises) ? payload.exercises : [];
  const total =
    safeNum(payload.totalCalories, NaN) ||
    safeNum(payload.total_calories, NaN) ||
    safeNum(payload.totalCaloriesBurned, NaN);

  const totalCalories = Number.isFinite(total)
    ? total
    : exercises.reduce((s, ex) => s + safeNum(ex?.calories, 0), 0);

  return {
    id: client_id,
    client_id,
    user_id: payload.user_id || null,

    date: dUS,
    __local_day: dayISO,

    started_at: payload.started_at || payload.createdAt || now.toISOString(),
    ended_at: payload.ended_at || payload.started_at || now.toISOString(),

    totalCalories: Math.round(safeNum(totalCalories, 0) * 100) / 100,
    exercises: exercises.map(ex => ({
      name: ex.name || ex.exerciseName || ex.exercise_name || 'Exercise',
      sets: ex.sets ?? null,
      reps: ex.reps ?? null,
      weight: ex.weight ?? null,
      calories: ex.calories ?? null,
      exerciseType: ex.exerciseType || ex.exercise_type || null
    }))
  };
}

function upsertWorkoutIntoLocalHistory(localWorkout) {
  const list = readWorkoutHistory();

  // de-dupe by client_id
  const idx = list.findIndex(w => String(w?.client_id || w?.id || '') === String(localWorkout.client_id));
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...localWorkout };
  } else {
    list.push(localWorkout);
  }

  writeWorkoutHistory(list);
  return list;
}

function computeBurnedForDateUS(dateUS) {
  const list = readWorkoutHistory();
  return list
    .filter(w => w?.date === dateUS)
    .reduce((s, w) => s + safeNum(w?.totalCalories ?? w?.total_calories, 0), 0);
}

/**
 * saveWorkoutLocalFirst
 * ✅ This now mirrors meals:
 * - stable client_id
 * - upsert workout row to cloud
 * - update local history (dedupe)
 * - update daily_metrics burned immediately (local + cloud)
 */
export async function saveWorkoutLocalFirst(payload = {}) {
  const userId = payload?.user_id || payload?.userId || null;

  const localWorkout = normalizeWorkoutForLocal(payload);
  const list = upsertWorkoutIntoLocalHistory(localWorkout);

  // Update daily metrics immediately from local workout history
  const burnedToday = computeBurnedForDateUS(localWorkout.date);

  // Update cache + dispatch so banner reacts on SAME device instantly
  await upsertDailyMetricsLocalFirst({
    user_id: userId,
    local_day: localWorkout.__local_day,
    calories_burned: Math.round(burnedToday || 0),
    // eaten is left unchanged here — MealTracker owns eaten.
    // If we have cached eaten, preserve it:
    calories_eaten: safeNum(readDailyMetricsCache()?.[localWorkout.__local_day]?.eaten, 0)
  });

  // Queue workout op for offline replay
  enqueueOp({
    type: 'upsert',
    table: 'workouts',
    user_id: userId,
    payload: {
      user_id: userId,
      client_id: localWorkout.client_id,
      started_at: localWorkout.started_at,
      ended_at: localWorkout.ended_at,
      total_calories: safeNum(localWorkout.totalCalories, 0),
      created_at: payload.created_at || localWorkout.started_at
    }
  });

  // Not signed in → local only
  if (!userId) return { ok: true, localOnly: true, client_id: localWorkout.client_id, listLen: list.length };

  // ✅ Cloud upsert workout row (snake_case FIRST)
  const row = {
    user_id: userId,
    client_id: localWorkout.client_id,
    started_at: localWorkout.started_at,
    ended_at: localWorkout.ended_at,
    total_calories: safeNum(localWorkout.totalCalories, 0),
    updated_at: new Date().toISOString()
  };

  // 1) most likely schema
  let res = await upsertRow('workouts', row, 'user_id,client_id');
  if (!res.ok) {
    // 2) fallback conflict
    res = await upsertRow('workouts', row, 'client_id');
  }

  // If the schema is camelCase, try again (fallback)
  if (!res.ok) {
    const msg = String(res?.error?.message || '');
    if (/column .*total_calories.* does not exist/i.test(msg)) {
      const camelRow = {
        user_id: userId,
        client_id: localWorkout.client_id,
        started_at: localWorkout.started_at,
        ended_at: localWorkout.ended_at,
        totalCalories: safeNum(localWorkout.totalCalories, 0),
        updated_at: new Date().toISOString()
      };
      let res2 = await upsertRow('workouts', camelRow, 'user_id,client_id');
      if (!res2.ok) res2 = await upsertRow('workouts', camelRow, 'client_id');
      if (res2.ok) return { ok: true, client_id: localWorkout.client_id, camel: true };
      return { ok: false, error: res2.error, client_id: localWorkout.client_id };
    }
  }

  if (!res.ok) return { ok: false, error: res.error, client_id: localWorkout.client_id };

  return { ok: true, client_id: localWorkout.client_id };
}

/**
 * deleteWorkoutLocalFirst
 * (build fix) — if something imports it, it exists now.
 */
export async function deleteWorkoutLocalFirst(client_id) {
  const cid = String(client_id || '').trim();
  if (!cid) return { ok: false, reason: 'no-client_id' };

  // Local remove
  const list = readWorkoutHistory();
  const next = list.filter(w => String(w?.client_id || w?.id || '') !== cid);
  writeWorkoutHistory(next);

  // Recompute today's burned for banner
  const iso = localDayISO(new Date());
  const burnedToday = next
    .filter(w => w?.__local_day === iso || w?.date === todayUS())
    .reduce((s, w) => s + safeNum(w?.totalCalories, 0), 0);

  await upsertDailyMetricsLocalFirst({
    user_id: null,
    local_day: iso,
    calories_burned: Math.round(burnedToday || 0),
    calories_eaten: safeNum(readDailyMetricsCache()?.[iso]?.eaten, 0)
  });

  // Queue delete op (cloud)
  enqueueOp({
    type: 'delete',
    table: 'workouts',
    payload: { client_id: cid }
  });

  return { ok: true };
}
