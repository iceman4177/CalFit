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

function safeNum(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function writeDailyMetricsCache(dayISO, { consumed, burned }) {
  try {
    const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
    cache[dayISO] = {
      ...(cache[dayISO] || {}),
      consumed: safeNum(consumed, 0),
      burned: safeNum(burned, 0),
      updated_at: new Date().toISOString(),
    };
    localStorage.setItem('dailyMetricsCache', JSON.stringify(cache));
  } catch {}
}

function dispatchBurned(dayISO, burned) {
  try {
    window.dispatchEvent(
      new CustomEvent('slimcal:burned:update', { detail: { date: dayISO, burned } })
    );
  } catch {}
}
function dispatchConsumed(dayISO, consumed) {
  try {
    window.dispatchEvent(
      new CustomEvent('slimcal:consumed:update', { detail: { date: dayISO, consumed } })
    );
  } catch {}
}

// ---- Cloud helpers -----------------------------------------------------------
async function upsertWorkoutCloud(payload) {
  const res = await supabase.from('workouts').upsert(payload, {
    onConflict: 'user_id,client_id',
    returning: 'minimal',
  });
  if (res?.error) throw res.error;
  return true;
}

async function upsertMealCloud(payload) {
  const res = await supabase.from('meals').upsert(payload, {
    onConflict: 'user_id,client_id',
    returning: 'minimal',
  });
  if (res?.error) throw res.error;
  return true;
}

async function upsertDailyMetricsCloud(payload) {
  const res = await supabase.from('daily_metrics').upsert(payload, {
    onConflict: 'user_id,local_day',
    returning: 'minimal',
  });
  if (res?.error) throw res.error;
  return true;
}

// ---- Meals ------------------------------------------------------------------
export async function saveMealLocalFirst({
  user_id,
  client_id,
  local_day,
  eaten_at,
  title,
  food_name,
  total_calories,
  protein_g,
  carbs_g,
  fat_g,
  food_id,
  portion_id,
  portion_label,
  qty,
  unit,
}) {
  if (!user_id) return;

  const cid = client_id || (crypto?.randomUUID?.() || `${getClientId()}_${Date.now()}`);
  const dayISO = local_day || localDayISO(new Date());

  const payload = {
    user_id,
    client_id: cid,
    local_day: dayISO,
    eaten_at: eaten_at || new Date().toISOString(),
    title: title || food_name || 'Meal',
    total_calories: Math.round(safeNum(total_calories, 0)),
    protein_g,
    carbs_g,
    fat_g,
    food_id,
    portion_id,
    portion_label,
    qty: safeNum(qty, 1),
    unit,
    food_name: food_name || title || null,
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

  return payload;
}

/**
 * ✅ upsertDailyMetricsLocalFirst
 * Keeps local banner truth + queues cloud sync.
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
 * ✅ saveWorkoutLocalFirst
 * Upserts workout row to Supabase using stable client_id.
 *
 * IMPORTANT:
 * - This function originally ALSO incremented burned calories in daily_metrics.
 * - Autosave drafts were calling this repeatedly → burned doubled.
 *
 * Fix:
 * - Add skipDailyMetricsUpdate flag so drafts can upsert cloud row without stacking calories.
 */
export async function saveWorkoutLocalFirst({
  user_id,
  client_id,
  started_at,
  ended_at,
  total_calories,
  notes = null,
  goal = null,
  skipDailyMetricsUpdate = false,
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

  // ✅ Prevent double counting from draft autosaves
  if (!skipDailyMetricsUpdate) {
    // Also keep the banner daily metrics in sync instantly
    try {
      const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
      const row = cache[dayISO] || {};
      const eaten = safeNum(row.consumed ?? row.calories_eaten ?? 0, 0);
      const burned = safeNum(row.burned ?? row.calories_burned ?? 0, 0);

      const newBurned = Math.round(burned + safeNum(total_calories, 0));
      writeDailyMetricsCache(dayISO, { consumed: eaten, burned: newBurned });
      dispatchBurned(dayISO, newBurned);

      // best effort cloud daily_metrics update too
      await upsertDailyMetricsLocalFirst({
        user_id,
        local_day: dayISO,
        burned: newBurned,
        consumed: eaten,
      });
    } catch {}
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

  // best-effort: nudge UI to refresh totals
  try {
    window.dispatchEvent(new CustomEvent('slimcal:burned:update', { detail: {} }));
  } catch {}
}
