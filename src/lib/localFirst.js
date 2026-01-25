// src/lib/localFirst.js
// Local-first persistence + best-effort cloud upsert + queued fallback.
// Goal: calories carry across devices reliably (banner + recap + history).

import { supabase } from './supabaseClient';

// -------------------------- helpers --------------------------
function safeNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function todayUS(d = new Date()) {
  try {
    return new Date(d).toLocaleDateString('en-US');
  } catch {
    return '';
  }
}

function localDayISO(d = new Date()) {
  try {
    const dt = new Date(d);
    const localMidnight = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    return localMidnight.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function ensureISO(v) {
  try {
    const dt = v ? new Date(v) : new Date();
    if (Number.isNaN(dt.getTime())) return new Date().toISOString();
    return dt.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function genId(prefix = 'cid') {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function writeDailyMetricsCache(dayISO, eaten, burned) {
  try {
    const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
    cache[dayISO] = {
      // ✅ include BOTH styles so banner + old UI both work
      eaten: safeNum(eaten, 0),
      consumed: safeNum(eaten, 0),
      calories_eaten: safeNum(eaten, 0),

      burned: safeNum(burned, 0),
      calories_burned: safeNum(burned, 0),

      net: safeNum(eaten, 0) - safeNum(burned, 0),
      net_calories: safeNum(eaten, 0) - safeNum(burned, 0),

      updated_at: new Date().toISOString()
    };
    localStorage.setItem('dailyMetricsCache', JSON.stringify(cache));
  } catch {}
}

function dispatchTotals(dayISO, eaten, burned) {
  try {
    window.dispatchEvent(
      new CustomEvent('slimcal:consumed:update', {
        detail: { date: dayISO, consumed: safeNum(eaten, 0) }
      })
    );
  } catch {}

  try {
    window.dispatchEvent(
      new CustomEvent('slimcal:burned:update', {
        detail: { date: dayISO, burned: safeNum(burned, 0) }
      })
    );
  } catch {}
}

function upsertLocalWorkoutHistory(session) {
  // Keep your existing workoutHistory UX working (history page, etc.)
  try {
    const day = session.__dayUS || todayUS(session.started_at || new Date());
    const total = safeNum(session.totalCalories ?? session.total_calories, 0);

    const existing = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const arr = Array.isArray(existing) ? existing : [];

    // store as a "session" row (your UI expects date + exercises + totalCalories)
    const row = {
      id: session.id || session.client_id || genId('w'),
      client_id: session.client_id || session.id || genId('w'),
      date: day,
      exercises: Array.isArray(session.exercises) ? session.exercises : [],
      totalCalories: total,
      total_calories: total, // ✅ keep both
      createdAt: session.createdAt || session.started_at || new Date().toISOString()
    };

    // If this is a draft upsert, replace by client_id if exists
    const idx = arr.findIndex(x => String(x?.client_id || x?.id || '') === String(row.client_id));
    if (idx >= 0) arr[idx] = { ...arr[idx], ...row };
    else arr.push(row);

    localStorage.setItem('workoutHistory', JSON.stringify(arr));
  } catch {}
}

function upsertLocalMealHistory(entry) {
  try {
    const day = entry.__dayUS || todayUS(entry.eaten_at || entry.createdAt || new Date());
    const existing = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    const all = Array.isArray(existing) ? existing : [];

    const todayRec = all.find(x => x?.date === day);
    if (!todayRec) {
      all.push({ date: day, meals: [entry] });
    } else {
      todayRec.meals = Array.isArray(todayRec.meals) ? todayRec.meals : [];
      // avoid dup by client_id
      const idx = todayRec.meals.findIndex(m => String(m?.client_id || '') === String(entry.client_id));
      if (idx >= 0) todayRec.meals[idx] = { ...todayRec.meals[idx], ...entry };
      else todayRec.meals.push(entry);
    }

    localStorage.setItem('mealHistory', JSON.stringify(all));
  } catch {}
}

// -------------------------- queue fallback --------------------------
// We try to use your existing sync.js queue if present,
// but we do it safely with dynamic import so we don't break builds.
async function enqueueFallbackOp(op) {
  // 1) Try your sync module (whatever the export name is)
  try {
    const mod = await import('./sync');

    const enqueueFn =
      mod?.enqueuePendingOp ||
      mod?.queuePendingOp ||
      mod?.addPendingOp ||
      mod?.pushPendingOp ||
      mod?.enqueueOp ||
      null;

    if (typeof enqueueFn === 'function') {
      await enqueueFn(op);
      return true;
    }
  } catch {}

  // 2) Fallback to a simple localStorage queue that flushPending can also read
  // (If your flushPending uses a different key, it will still not break anything.)
  try {
    const KEY = 'slimcal:pendingOps:v1';
    const q = JSON.parse(localStorage.getItem(KEY) || '[]');
    const arr = Array.isArray(q) ? q : [];
    arr.push({ ...op, _queued_at: Date.now() });
    localStorage.setItem(KEY, JSON.stringify(arr));
    return true;
  } catch {}

  return false;
}

// -------------------------- CLOUD upserts --------------------------
// We ALWAYS attempt to write the canonical columns.

async function upsertWorkoutCloud(userId, workout) {
  if (!supabase || !userId) return { ok: false, reason: 'no-supabase-or-user' };

  const payload = {
    user_id: userId,
    client_id: workout.client_id || genId('w'),
    started_at: ensureISO(workout.started_at),
    ended_at: ensureISO(workout.ended_at || workout.started_at),
    total_calories: safeNum(workout.total_calories ?? workout.totalCalories, 0),

    // keep optional fields if your schema supports them
    name: workout.name || workout.title || null,
    updated_at: new Date().toISOString()
  };

  // ✅ Prefer onConflict user_id,client_id (your system is built for this)
  const res = await supabase
    .from('workouts')
    .upsert(payload, { onConflict: 'user_id,client_id' })
    .select()
    .maybeSingle();

  if (!res?.error) return { ok: true, data: res?.data || null };

  // Fallback: if your table only has client_id unique
  if (/constraint|onconflict|conflict/i.test(res.error?.message || '')) {
    const res2 = await supabase
      .from('workouts')
      .upsert(payload, { onConflict: 'client_id' })
      .select()
      .maybeSingle();

    if (!res2?.error) return { ok: true, data: res2?.data || null };

    return { ok: false, error: res2.error };
  }

  return { ok: false, error: res.error };
}

async function upsertMealCloud(userId, meal) {
  if (!supabase || !userId) return { ok: false, reason: 'no-supabase-or-user' };

  const payload = {
    user_id: userId,
    client_id: meal.client_id || genId('meal'),
    eaten_at: ensureISO(meal.eaten_at || meal.createdAt),
    title: meal.title || meal.name || 'Meal',
    total_calories: safeNum(meal.total_calories ?? meal.calories, 0),

    // macros + meta (if your table supports them)
    protein_g: meal.protein_g ?? null,
    carbs_g: meal.carbs_g ?? null,
    fat_g: meal.fat_g ?? null,

    food_id: meal.food_id ?? null,
    portion_id: meal.portion_id ?? null,
    portion_label: meal.portion_label ?? null,
    qty: meal.qty ?? 1,
    unit: meal.unit ?? null,
    food_name: meal.food_name ?? null,

    updated_at: new Date().toISOString()
  };

  const res = await supabase
    .from('meals')
    .upsert(payload, { onConflict: 'user_id,client_id' })
    .select()
    .maybeSingle();

  if (!res?.error) return { ok: true, data: res?.data || null };

  // fallback: client_id only
  const res2 = await supabase
    .from('meals')
    .upsert(payload, { onConflict: 'client_id' })
    .select()
    .maybeSingle();

  if (!res2?.error) return { ok: true, data: res2?.data || null };

  return { ok: false, error: res2.error || res.error };
}

async function upsertDailyMetricsCloud(userId, payload) {
  if (!supabase || !userId) return { ok: false, reason: 'no-supabase-or-user' };

  const dayISO = payload.local_day || payload.day || localDayISO(new Date());

  // accept MANY shapes coming from different components
  const eaten =
    safeNum(payload.calories_eaten) ||
    safeNum(payload.eaten) ||
    safeNum(payload.consumed) ||
    safeNum(payload.caloriesConsumed) ||
    0;

  const burned =
    safeNum(payload.calories_burned) ||
    safeNum(payload.burned) ||
    safeNum(payload.caloriesBurned) ||
    0;

  const rowNew = {
    user_id: userId,
    local_day: dayISO,
    calories_eaten: eaten,
    calories_burned: burned,
    net_calories: eaten - burned,
    updated_at: new Date().toISOString()
  };

  const res = await supabase
    .from('daily_metrics')
    .upsert(rowNew, { onConflict: 'user_id,local_day' })
    .select()
    .maybeSingle();

  if (!res?.error) return { ok: true, data: res?.data || null };

  // legacy fallback
  if (/column .*local_day.* does not exist/i.test(res.error?.message || '')) {
    const legacy = {
      user_id: userId,
      day: dayISO,
      cals_eaten: eaten,
      cals_burned: burned,
      net_cals: eaten - burned,
      updated_at: new Date().toISOString()
    };

    const res2 = await supabase
      .from('daily_metrics')
      .upsert(legacy, { onConflict: 'user_id,day' })
      .select()
      .maybeSingle();

    if (!res2?.error) return { ok: true, data: res2?.data || null };

    return { ok: false, error: res2.error };
  }

  return { ok: false, error: res.error };
}

// -------------------------- PUBLIC API --------------------------

/**
 * saveWorkoutLocalFirst(workout)
 * - updates local workoutHistory immediately
 * - writes workouts.total_calories consistently
 * - queues if offline
 */
export async function saveWorkoutLocalFirst(workout) {
  const w = workout || {};

  const started_at = ensureISO(w.started_at);
  const ended_at = ensureISO(w.ended_at || started_at);

  const total = safeNum(w.total_calories ?? w.totalCalories, 0);

  const normalized = {
    ...w,
    client_id: w.client_id || w.id || genId('w'),
    started_at,
    ended_at,
    total_calories: total,
    totalCalories: total,
    __dayUS: w.date || todayUS(started_at),
    __dayISO: w.__local_day || localDayISO(new Date(started_at)),
    id: w.id || w.client_id || genId('w')
  };

  // ✅ local history upsert (supports drafts)
  upsertLocalWorkoutHistory({
    id: normalized.client_id,
    client_id: normalized.client_id,
    started_at: normalized.started_at,
    totalCalories: normalized.totalCalories,
    total_calories: normalized.total_calories,
    exercises: normalized.exercises || [],
    createdAt: normalized.createdAt || normalized.started_at,
    __dayUS: normalized.__dayUS
  });

  // ✅ if not logged in, we're done
  const userId = normalized.user_id || null;
  if (!userId) return { ok: true, localOnly: true };

  // ✅ cloud upsert
  try {
    const res = await upsertWorkoutCloud(userId, normalized);
    if (res.ok) return res;
    // if fails, queue for later
    await enqueueFallbackOp({
      table: 'workouts',
      action: 'upsert',
      user_id: userId,
      client_id: normalized.client_id,
      payload: normalized
    });
    return { ok: true, queued: true };
  } catch (e) {
    await enqueueFallbackOp({
      table: 'workouts',
      action: 'upsert',
      user_id: userId,
      client_id: normalized.client_id,
      payload: normalized
    });
    return { ok: true, queued: true };
  }
}

/**
 * saveMealLocalFirst(meal)
 * - updates local mealHistory immediately
 * - upserts meals
 * - queues if offline
 */
export async function saveMealLocalFirst(meal) {
  const m = meal || {};
  const userId = m.user_id || null;

  const eaten_at = ensureISO(m.eaten_at || m.createdAt);
  const calories = safeNum(m.total_calories ?? m.calories ?? m.totalCalories, 0);

  const normalized = {
    ...m,
    client_id: m.client_id || genId('meal'),
    eaten_at,
    total_calories: calories,
    calories,
    name: m.title || m.name || 'Meal',
    __dayUS: m.__day || todayUS(eaten_at),
    __dayISO: localDayISO(new Date(eaten_at))
  };

  // ✅ local mealHistory update
  upsertLocalMealHistory({
    client_id: normalized.client_id,
    name: normalized.name,
    calories: normalized.calories,
    protein_g: normalized.protein_g ?? undefined,
    carbs_g: normalized.carbs_g ?? undefined,
    fat_g: normalized.fat_g ?? undefined,
    createdAt: normalized.eaten_at,
    __dayUS: normalized.__dayUS,

    food_id: normalized.food_id ?? null,
    portion_id: normalized.portion_id ?? null,
    portion_label: normalized.portion_label ?? null,
    qty: normalized.qty ?? 1,
    unit: normalized.unit ?? null,
    food_name: normalized.food_name ?? null
  });

  if (!userId) return { ok: true, localOnly: true };

  try {
    const res = await upsertMealCloud(userId, normalized);
    if (res.ok) return res;

    await enqueueFallbackOp({
      table: 'meals',
      action: 'upsert',
      user_id: userId,
      client_id: normalized.client_id,
      payload: normalized
    });
    return { ok: true, queued: true };
  } catch (e) {
    await enqueueFallbackOp({
      table: 'meals',
      action: 'upsert',
      user_id: userId,
      client_id: normalized.client_id,
      payload: normalized
    });
    return { ok: true, queued: true };
  }
}

/**
 * upsertDailyMetricsLocalFirst(payload)
 * - writes local dailyMetricsCache in a banner-friendly shape
 * - dispatches update events so UI updates immediately
 * - upserts Supabase daily_metrics
 */
export async function upsertDailyMetricsLocalFirst(payload) {
  const p = payload || {};
  const userId = p.user_id || null;
  const dayISO = p.local_day || p.day || localDayISO(new Date());

  const eaten =
    safeNum(p.calories_eaten) ||
    safeNum(p.eaten) ||
    safeNum(p.consumed) ||
    safeNum(p.caloriesConsumed) ||
    0;

  const burned =
    safeNum(p.calories_burned) ||
    safeNum(p.burned) ||
    safeNum(p.caloriesBurned) ||
    0;

  // ✅ update local cache
  writeDailyMetricsCache(dayISO, eaten, burned);

  // convenience keys (some parts still read these)
  try {
    localStorage.setItem('consumedToday', String(Math.round(eaten || 0)));
    localStorage.setItem('burnedToday', String(Math.round(burned || 0)));
  } catch {}

  // ✅ dispatch events for instant UI updates
  dispatchTotals(dayISO, eaten, burned);

  // ✅ if no user, stop here
  if (!userId) return { ok: true, localOnly: true };

  // ✅ cloud upsert
  try {
    const res = await upsertDailyMetricsCloud(userId, {
      local_day: dayISO,
      calories_eaten: eaten,
      calories_burned: burned
    });
    if (res.ok) return res;

    await enqueueFallbackOp({
      table: 'daily_metrics',
      action: 'upsert',
      user_id: userId,
      key: dayISO,
      payload: { local_day: dayISO, calories_eaten: eaten, calories_burned: burned }
    });
    return { ok: true, queued: true };
  } catch (e) {
    await enqueueFallbackOp({
      table: 'daily_metrics',
      action: 'upsert',
      user_id: userId,
      key: dayISO,
      payload: { local_day: dayISO, calories_eaten: eaten, calories_burned: burned }
    });
    return { ok: true, queued: true };
  }
}
