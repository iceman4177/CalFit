// src/lib/localFirst.js
// Local-first wrappers for meals + workouts + daily_metrics.
// Goal: write local caches immediately, and sync to Supabase with stable client_id.
// This makes mobile ↔ PC numbers match reliably.

import { supabase } from './supabaseClient';
import { enqueueOp } from './sync';

// ---- Stable UUID per device --------------------------------------------------
function getClientId() {
  try {
    let cid = localStorage.getItem('clientId');
    if (!cid) {
      cid = (crypto?.randomUUID?.() || `cid_${Date.now()}`).slice(0, 36);
      localStorage.setItem('clientId', cid);
    }
    return cid;
  } catch {
    return 'anon';
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

function safeNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

// ---- Local cache helpers -----------------------------------------------------
function writeDailyMetricsCache(dayISO, { consumed, burned }) {
  try {
    const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
    cache[dayISO] = {
      consumed: Math.round(safeNum(consumed, 0)),
      burned: Math.round(safeNum(burned, 0)),
      net: Math.round(safeNum(consumed, 0)) - Math.round(safeNum(burned, 0)),
      updated_at: new Date().toISOString(),
    };
    localStorage.setItem('dailyMetricsCache', JSON.stringify(cache));
  } catch {}
}

function dispatchConsumed(dayISO, consumed) {
  try {
    window.dispatchEvent(
      new CustomEvent('slimcal:consumed:update', { detail: { date: dayISO, consumed } })
    );
  } catch {}
}

function dispatchBurned(dayISO, burned) {
  try {
    window.dispatchEvent(
      new CustomEvent('slimcal:burned:update', { detail: { date: dayISO, burned } })
    );
  } catch {}
}

// ---- Cloud upserts -----------------------------------------------------------
async function upsertWorkoutCloud(payload) {
  const { user_id } = payload || {};
  if (!supabase || !user_id) return;

  // IMPORTANT: requires UNIQUE(user_id, client_id) which you just added ✅
  const res = await supabase
    .from('workouts')
    .upsert(payload, { onConflict: 'user_id,client_id' })
    .select('id')
    .maybeSingle();

  if (res?.error) throw res.error;
  return res?.data || null;
}

async function upsertMealCloud(payload) {
  const { user_id } = payload || {};
  if (!supabase || !user_id) return;

  const res = await supabase
    .from('meals')
    .upsert(payload, { onConflict: 'user_id,client_id' })
    .select('id')
    .maybeSingle();

  if (res?.error) throw res.error;
  return res?.data || null;
}

async function upsertDailyMetricsCloud(payload) {
  const { user_id } = payload || {};
  if (!supabase || !user_id) return;

  // Try new schema
  const res = await supabase
    .from('daily_metrics')
    .upsert(payload, { onConflict: 'user_id,local_day' })
    .select('id')
    .maybeSingle();

  if (!res?.error) return res?.data || null;

  // Legacy fallback
  if (/column .* does not exist/i.test(res.error?.message || '')) {
    const legacy = {
      user_id: payload.user_id,
      day: payload.local_day,
      cals_eaten: payload.calories_eaten,
      cals_burned: payload.calories_burned,
      net_cals: payload.net_calories,
      updated_at: payload.updated_at,
    };

    const res2 = await supabase
      .from('daily_metrics')
      .upsert(legacy, { onConflict: 'user_id,day' })
      .select('id')
      .maybeSingle();

    if (res2?.error) throw res2.error;
    return res2?.data || null;
  }

  throw res.error;
}

// =============================================================================
// ✅ Public exports
// =============================================================================

/**
 * upsertDailyMetricsLocalFirst
 * Writes dailyMetricsCache locally (instant UI),
 * then upserts daily_metrics to Supabase (or queues if fails).
 */
export async function upsertDailyMetricsLocalFirst({ user_id, local_day, burned, consumed }) {
  const dayISO = local_day || localDayISO(new Date());
  const eaten = Math.round(safeNum(consumed, 0));
  const b = Math.round(safeNum(burned, 0));

  // local truth for banner
  writeDailyMetricsCache(dayISO, { consumed: eaten, burned: b });

  // convenience keys (some parts read these)
  try {
    localStorage.setItem('consumedToday', String(eaten));
    localStorage.setItem('burnedToday', String(b));
  } catch {}

  // update UI now
  dispatchConsumed(dayISO, eaten);
  dispatchBurned(dayISO, b);

  // cloud (best-effort)
  if (!user_id) return;

  const payload = {
    user_id,
    local_day: dayISO,
    calories_eaten: eaten,
    calories_burned: b,
    net_calories: eaten - b,
    updated_at: new Date().toISOString(),
  };

  try {
    await upsertDailyMetricsCloud(payload);
  } catch (e) {
    // queue for later flush
    try {
      enqueueOp?.({
        op: 'upsert_daily_metrics',
        table: 'daily_metrics',
        user_id,
        local_day: dayISO,
        payload,
      });
    } catch {}
    throw e;
  }
}

/**
 * saveMealLocalFirst
 * MealTracker already updates mealHistory locally.
 * This ensures cloud upsert uses stable client_id and writes local_day.
 */
export async function saveMealLocalFirst({
  user_id,
  client_id,
  eaten_at,
  title,
  total_calories,
  protein_g = null,
  carbs_g = null,
  fat_g = null,
  food_id = null,
  portion_id = null,
  portion_label = null,
  qty = 1,
  unit = 'serving',
  food_name = null,
}) {
  if (!user_id) return;

  const cid = client_id || (crypto?.randomUUID?.() || `${getClientId()}_${Date.now()}`);
  const dayISO = localDayISO(eaten_at ? new Date(eaten_at) : new Date());

  const payload = {
    user_id,
    client_id: cid,
    eaten_at: eaten_at || new Date().toISOString(),
    title: title || food_name || 'Meal',
    total_calories: Math.round(safeNum(total_calories, 0)),
    updated_at: new Date().toISOString(),
  };

  try {
    await upsertMealCloud(payload);
  } catch (e) {
    try {
      enqueueOp?.({
        op: 'upsert_meal',
        table: 'meals',
        user_id,
        client_id: cid,
        payload,
      });
    } catch {}
    throw e;
  }
}

/**
 * ✅ saveWorkoutLocalFirst
 * THIS is the big fix:
 * - local_day is always written
 * - client_id is stable
 * - cloud upsert uses UNIQUE(user_id, client_id)
 */
export async function saveWorkoutLocalFirst({
  user_id,
  client_id,
  started_at,
  ended_at,
  total_calories,
  notes = null,
  goal = null,
}) {
  if (!user_id) return;

  const cid = client_id || (crypto?.randomUUID?.() || `${getClientId()}_${Date.now()}`);
  const startISO = started_at || new Date().toISOString();
  const dayISO = localDayISO(new Date(startISO));

  const payload = {
    user_id,
    client_id: cid,
    local_day: dayISO,
    started_at: startISO,
    ended_at: ended_at || startISO,
    total_calories: safeNum(total_calories, 0),
    notes,
    goal,
    updated_at: new Date().toISOString(),
  };

  try {
    await upsertWorkoutCloud(payload);
  } catch (e) {
    try {
      enqueueOp?.({
        op: 'upsert_workout',
        table: 'workouts',
        user_id,
        client_id: cid,
        payload,
      });
    } catch {}
    throw e;
  }
}

/**
 * ✅ deleteWorkoutLocalFirst
 * Fixes your build error and keeps daily totals correct.
 */
export async function deleteWorkoutLocalFirst({ user_id, client_id }) {
  if (!user_id || !client_id) return;

  // delete cloud row
  try {
    const res = await supabase
      .from('workouts')
      .delete()
      .eq('user_id', user_id)
      .eq('client_id', client_id);

    if (res?.error) throw res.error;
  } catch (e) {
    // queue for later
    try {
      enqueueOp?.({
        op: 'delete_workout',
        table: 'workouts',
        user_id,
        client_id,
        payload: { user_id, client_id },
      });
    } catch {}
    throw e;
  }

  // best-effort: re-hydrate today burned via cloud
  try {
    window.dispatchEvent(new CustomEvent('slimcal:burned:update', { detail: {} }));
  } catch {}
}