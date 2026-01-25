// src/lib/localFirst.js
// Local-first helpers for meals + workouts + daily_metrics.
// Goal: identical sync behavior for workouts as meals.
// - Always write local_day for workouts
// - Always upsert daily_metrics with normalized column names
// - Keep localStorage caches in sync for instant UI updates
// - Provide deleteWorkoutLocalFirst export (fixes build error)

import { supabase } from './supabaseClient';

// -------------------- Local day helpers --------------------
function localDayISO(d = new Date()) {
  try {
    const dt = new Date(d);
    const localMidnight = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    return localMidnight.toISOString().slice(0, 10);
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

function safeNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function getOrCreateClientId() {
  try {
    let cid = localStorage.getItem('clientId');
    if (!cid) {
      cid =
        (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `cid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      localStorage.setItem('clientId', cid);
    }
    return cid;
  } catch {
    return 'anon';
  }
}

// -------------------- Local caches (LS) --------------------
function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function writeDailyMetricsCache(dayISO, eaten, burned) {
  try {
    const cache = readJSON('dailyMetricsCache', {}) || {};
    cache[dayISO] = {
      eaten: safeNum(eaten, 0),
      burned: safeNum(burned, 0),
      net: safeNum(eaten, 0) - safeNum(burned, 0),
      updated_at: new Date().toISOString()
    };
    writeJSON('dailyMetricsCache', cache);

    // convenience keys (some UI reads these)
    localStorage.setItem('consumedToday', String(Math.round(safeNum(eaten, 0))));
    localStorage.setItem('burnedToday', String(Math.round(safeNum(burned, 0))));
  } catch {}
}

function dispatchTotals(dayISO, eaten, burned) {
  try {
    window.dispatchEvent(
      new CustomEvent('slimcal:consumed:update', {
        detail: { date: dayISO, consumed: Math.round(safeNum(eaten, 0)) }
      })
    );
  } catch {}

  try {
    window.dispatchEvent(
      new CustomEvent('slimcal:burned:update', {
        detail: { date: dayISO, burned: Math.round(safeNum(burned, 0)) }
      })
    );
  } catch {}
}

// -------------------- daily_metrics normalization --------------------
function normalizeDailyMetricsInput(input = {}) {
  const dayISO =
    input.local_day ||
    input.day ||
    input.date ||
    localDayISO(new Date());

  const eaten =
    safeNum(input.calories_eaten, NaN) ||
    safeNum(input.cals_eaten, NaN) ||
    safeNum(input.consumed, NaN) ||
    safeNum(input.eaten, NaN) ||
    0;

  const burned =
    safeNum(input.calories_burned, NaN) ||
    safeNum(input.cals_burned, NaN) ||
    safeNum(input.burned, NaN) ||
    0;

  const net =
    Number.isFinite(safeNum(input.net_calories, NaN))
      ? safeNum(input.net_calories, 0)
      : (safeNum(eaten, 0) - safeNum(burned, 0));

  return {
    user_id: input.user_id || null,
    local_day: dayISO,
    calories_eaten: safeNum(eaten, 0),
    calories_burned: safeNum(burned, 0),
    net_calories: safeNum(net, 0),
    updated_at: new Date().toISOString()
  };
}

// -------------------- Supabase upserts (robust) --------------------
async function upsertDailyMetricsCloud(row) {
  if (!supabase || !row?.user_id) return { ok: false, reason: 'no-supabase-or-user' };

  // Try new schema: (user_id, local_day)
  const res = await supabase
    .from('daily_metrics')
    .upsert(row, { onConflict: 'user_id,local_day' })
    .select()
    .maybeSingle();

  if (!res?.error) return { ok: true, data: res.data };

  // Legacy fallback: (user_id, day) + legacy columns
  if (/column .*local_day.* does not exist/i.test(res.error?.message || '')) {
    const legacy = {
      user_id: row.user_id,
      day: row.local_day,
      cals_eaten: row.calories_eaten,
      cals_burned: row.calories_burned,
      net_cals: row.net_calories,
      updated_at: row.updated_at
    };

    const res2 = await supabase
      .from('daily_metrics')
      .upsert(legacy, { onConflict: 'user_id,day' })
      .select()
      .maybeSingle();

    if (!res2?.error) return { ok: true, data: res2.data };

    console.warn('[localFirst] daily_metrics legacy upsert failed', res2.error);
    return { ok: false, error: res2.error };
  }

  console.warn('[localFirst] daily_metrics upsert failed', res.error);
  return { ok: false, error: res.error };
}

async function upsertWorkoutCloud(workout) {
  if (!supabase || !workout?.user_id) return { ok: false, reason: 'no-supabase-or-user' };

  const startedAt = workout.started_at || new Date().toISOString();
  const dayISO = workout.local_day || workout.__local_day || localDayISO(new Date(startedAt));

  const payload = {
    // IMPORTANT: keep both keys because schema varies between tables
    user_id: workout.user_id,
    client_id: workout.client_id || workout.id || null,

    started_at: startedAt,
    ended_at: workout.ended_at || startedAt,

    total_calories: safeNum(workout.total_calories ?? workout.totalCalories, 0),

    // critical for cross-device matching
    local_day: dayISO,

    // optional fields for future use
    notes: workout.notes ?? null,
    goal: workout.goal ?? null,
    updated_at: new Date().toISOString(),
  };

  // 1) Preferred: upsert on (user_id, client_id)
  let res = await supabase
    .from('workouts')
    .upsert(payload, { onConflict: 'user_id,client_id' })
    .select()
    .maybeSingle();

  if (!res?.error) return { ok: true, data: res.data };

  // If the table doesn't have client_id column
  if (/column .*client_id.* does not exist/i.test(res.error?.message || '')) {
    const payloadNoClient = { ...payload };
    delete payloadNoClient.client_id;

    res = await supabase
      .from('workouts')
      .insert(payloadNoClient)
      .select()
      .maybeSingle();

    if (!res?.error) return { ok: true, data: res.data };
    console.warn('[localFirst] workouts insert fallback failed', res.error);
    return { ok: false, error: res.error };
  }

  // If the table doesn't have local_day column yet, still insert/upsert without it
  if (/column .*local_day.* does not exist/i.test(res.error?.message || '')) {
    const payloadNoDay = { ...payload };
    delete payloadNoDay.local_day;

    res = await supabase
      .from('workouts')
      .upsert(payloadNoDay, { onConflict: 'user_id,client_id' })
      .select()
      .maybeSingle();

    if (!res?.error) return { ok: true, data: res.data };
    console.warn('[localFirst] workouts upsert (no local_day) failed', res.error);
    return { ok: false, error: res.error };
  }

  console.warn('[localFirst] workouts upsert failed', res.error);
  return { ok: false, error: res.error };
}

async function deleteWorkoutCloud(userId, clientId) {
  if (!supabase || !userId) return { ok: false, reason: 'no-supabase-or-user' };
  if (!clientId) return { ok: false, reason: 'no-client-id' };

  // Preferred delete: user_id + client_id (if column exists)
  let res = await supabase
    .from('workouts')
    .delete()
    .eq('user_id', userId)
    .eq('client_id', clientId);

  if (!res?.error) return { ok: true };

  // Fallback: maybe client_id doesn't exist; try id
  if (/column .*client_id.* does not exist/i.test(res.error?.message || '')) {
    res = await supabase
      .from('workouts')
      .delete()
      .eq('user_id', userId)
      .eq('id', clientId);

    if (!res?.error) return { ok: true };
  }

  console.warn('[localFirst] deleteWorkoutCloud failed', res.error);
  return { ok: false, error: res.error };
}

// -------------------- Public API --------------------

// ✅ MEALS: keep behavior stable (already working)
export async function saveMealLocalFirst(mealRow) {
  // This function exists mainly so other parts of app still import it.
  // The MealTracker already maintains localStorage mealHistory itself.
  // Here we just write to Supabase for cross-device visibility.
  try {
    const userId = mealRow?.user_id || null;
    if (!userId || !supabase) return { ok: true, localOnly: true };

    const eatenAt = mealRow.eaten_at || mealRow.created_at || new Date().toISOString();
    const payload = {
      user_id: userId,
      client_id: mealRow.client_id || null,
      eaten_at: eatenAt,
      title: mealRow.title || mealRow.name || 'Meal',
      total_calories: safeNum(mealRow.total_calories ?? mealRow.calories, 0),
      created_at: mealRow.created_at || undefined,
      updated_at: new Date().toISOString(),

      // optional macro/meta fields
      protein_g: mealRow.protein_g ?? null,
      carbs_g: mealRow.carbs_g ?? null,
      fat_g: mealRow.fat_g ?? null,

      food_id: mealRow.food_id ?? null,
      portion_id: mealRow.portion_id ?? null,
      portion_label: mealRow.portion_label ?? null,
      qty: mealRow.qty ?? null,
      unit: mealRow.unit ?? null,
      food_name: mealRow.food_name ?? null,
    };

    // Upsert by user_id + client_id (if supported)
    let res = await supabase
      .from('meals')
      .upsert(payload, { onConflict: 'user_id,client_id' })
      .select()
      .maybeSingle();

    if (!res?.error) return { ok: true, data: res.data };

    // If no client_id column exists
    if (/column .*client_id.* does not exist/i.test(res.error?.message || '')) {
      const payloadNoClient = { ...payload };
      delete payloadNoClient.client_id;

      res = await supabase
        .from('meals')
        .insert(payloadNoClient)
        .select()
        .maybeSingle();

      if (!res?.error) return { ok: true, data: res.data };
    }

    console.warn('[localFirst] saveMealLocalFirst failed', res.error);
    return { ok: false, error: res.error };
  } catch (e) {
    console.warn('[localFirst] saveMealLocalFirst exception', e);
    return { ok: false, error: e };
  }
}

// ✅ WORKOUTS: this is the main fix
export async function saveWorkoutLocalFirst(workoutSession) {
  try {
    const now = new Date();
    const startedAt = workoutSession?.started_at || now.toISOString();
    const dayUS = workoutSession?.date || todayUS();
    const dayISO = workoutSession?.local_day || workoutSession?.__local_day || localDayISO(new Date(startedAt));

    const client_id =
      workoutSession?.client_id ||
      workoutSession?.id ||
      (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `w_${getOrCreateClientId()}_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    // ---- 1) Update localStorage workoutHistory (for offline UI/history) ----
    // Format expected by existing UI:
    // [{ date: "M/D/YYYY", totalCalories: number, exercises: [...] }]
    const wh = readJSON('workoutHistory', []);
    const list = Array.isArray(wh) ? wh : [];

    const totalCalories = safeNum(workoutSession?.totalCalories ?? workoutSession?.total_calories, 0);

    const normalizedLocal = {
      id: client_id,
      client_id,
      date: dayUS,
      createdAt: workoutSession?.createdAt || startedAt,
      started_at: startedAt,
      ended_at: workoutSession?.ended_at || startedAt,
      totalCalories,
      total_calories: totalCalories,
      exercises: Array.isArray(workoutSession?.exercises) ? workoutSession.exercises : [],
      uploaded: false,
      local_day: dayISO
    };

    // Upsert local by client_id if present, else append
    const existingIdx = list.findIndex(x => String(x?.client_id || x?.id || '') === String(client_id));
    if (existingIdx >= 0) list[existingIdx] = { ...list[existingIdx], ...normalizedLocal };
    else list.push(normalizedLocal);

    writeJSON('workoutHistory', list);

    // ---- 2) Update local dailyMetricsCache immediately (fast UI) ----
    // We recompute burned as sum of today's workouts (local US day)
    const burnedToday = list
      .filter(w => (w?.date === dayUS))
      .reduce((s, w) => s + safeNum(w?.totalCalories ?? w?.total_calories, 0), 0);

    // Keep eaten from cache if present (don’t stomp)
    let eatenCached = 0;
    try {
      const cache = readJSON('dailyMetricsCache', {}) || {};
      const row = cache?.[dayISO];
      if (row) eatenCached = safeNum(row?.eaten ?? row?.consumed ?? row?.calories_eaten, 0);
    } catch {}

    writeDailyMetricsCache(dayISO, eatenCached, burnedToday);
    dispatchTotals(dayISO, eatenCached, burnedToday);

    // ---- 3) Save workout to Supabase (cross-device truth) ----
    if (workoutSession?.user_id) {
      const cloudRes = await upsertWorkoutCloud({
        ...workoutSession,
        user_id: workoutSession.user_id,
        client_id,
        total_calories: totalCalories,
        local_day: dayISO,
        started_at: startedAt,
        ended_at: workoutSession?.ended_at || startedAt
      });

      if (!cloudRes?.ok) {
        // Still ok locally; hydrate later will fix
        console.warn('[localFirst] saveWorkoutLocalFirst cloud failed', cloudRes?.error || cloudRes);
      }

      // ---- 4) Always upsert daily_metrics after workout save (THIS is what meals effectively do) ----
      const dmRow = normalizeDailyMetricsInput({
        user_id: workoutSession.user_id,
        local_day: dayISO,
        calories_eaten: eatenCached,
        calories_burned: burnedToday,
        net_calories: eatenCached - burnedToday
      });

      const dmRes = await upsertDailyMetricsCloud(dmRow);
      if (!dmRes?.ok) {
        console.warn('[localFirst] daily_metrics after workout save failed', dmRes?.error || dmRes);
      }
    }

    return { ok: true, client_id, local_day: dayISO, total_calories: totalCalories };
  } catch (e) {
    console.warn('[localFirst] saveWorkoutLocalFirst exception', e);
    return { ok: false, error: e };
  }
}

// ✅ Needed by MealTracker + WorkoutPage
export async function upsertDailyMetricsLocalFirst(input) {
  try {
    const row = normalizeDailyMetricsInput(input);

    // Update local cache immediately for instant UI
    writeDailyMetricsCache(row.local_day, row.calories_eaten, row.calories_burned);
    dispatchTotals(row.local_day, row.calories_eaten, row.calories_burned);

    // Cloud upsert (if logged in)
    if (row.user_id) {
      const res = await upsertDailyMetricsCloud(row);
      if (!res?.ok) {
        console.warn('[localFirst] upsertDailyMetricsLocalFirst cloud failed', res?.error || res);
      }
      return res;
    }

    return { ok: true, localOnly: true };
  } catch (e) {
    console.warn('[localFirst] upsertDailyMetricsLocalFirst exception', e);
    return { ok: false, error: e };
  }
}

// ✅ Fixes your build error: WorkoutPage imports this somewhere
export async function deleteWorkoutLocalFirst({ user_id, client_id } = {}) {
  try {
    const userId = user_id || null;
    const cid = client_id || null;

    // Remove from local workoutHistory
    const wh = readJSON('workoutHistory', []);
    const list = Array.isArray(wh) ? wh : [];
    const filtered = cid
      ? list.filter(x => String(x?.client_id || x?.id || '') !== String(cid))
      : list;

    writeJSON('workoutHistory', filtered);

    // Recompute today's burned and update cache
    const dayUS = todayUS();
    const dayISO = localDayISO(new Date());
    const burnedToday = filtered
      .filter(w => w?.date === dayUS)
      .reduce((s, w) => s + safeNum(w?.totalCalories ?? w?.total_calories, 0), 0);

    let eatenCached = 0;
    try {
      const cache = readJSON('dailyMetricsCache', {}) || {};
      const row = cache?.[dayISO];
      if (row) eatenCached = safeNum(row?.eaten ?? row?.consumed ?? row?.calories_eaten, 0);
    } catch {}

    writeDailyMetricsCache(dayISO, eatenCached, burnedToday);
    dispatchTotals(dayISO, eatenCached, burnedToday);

    // Delete cloud row
    if (userId && cid) {
      const res = await deleteWorkoutCloud(userId, cid);
      if (!res?.ok) {
        console.warn('[localFirst] deleteWorkoutLocalFirst cloud failed', res?.error || res);
      }

      // Also repair daily_metrics
      const dmRow = normalizeDailyMetricsInput({
        user_id: userId,
        local_day: dayISO,
        calories_eaten: eatenCached,
        calories_burned: burnedToday,
        net_calories: eatenCached - burnedToday
      });
      await upsertDailyMetricsCloud(dmRow);
    }

    return { ok: true };
  } catch (e) {
    console.warn('[localFirst] deleteWorkoutLocalFirst exception', e);
    return { ok: false, error: e };
  }
}
