// src/lib/localFirst.js
// Local-first wrappers for meals + workouts + daily_metrics.
// Goal: write local caches immediately, then sync to Supabase with stable client_id.
// This keeps PC <-> mobile totals in lockstep and avoids flicker.

import { supabase } from './supabaseClient';
import { enqueueOp } from './sync';
import {
  ensureScopedFromLegacy,
  readScopedJSON,
  writeScopedJSON,
  scopedKey,
  KEYS
} from './scopedStorage.js';

// ---- UUID helpers ------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidv4Fallback() {
  // RFC4122-ish v4 UUID generator (Math.random fallback)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : ((r & 0x3) | 0x8);
    return v.toString(16);
  });
}


// ---- Stable UUID per device (anon users) ------------------------------------
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

// ---------------- Local-day helpers (avoid UTC drift) ----------------
function localDayISO(d = new Date()) {
  const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return ld.toISOString().slice(0, 10); // YYYY-MM-DD (LOCAL)
}

function safeNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
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

function writeDailyMetricsCache(dayISO, { consumed, burned }, userId = null) {
  const eaten = Math.round(safeNum(consumed, 0));
  const b = Math.round(safeNum(burned, 0));

  try {
    if (userId) {
      ensureScopedFromLegacy(KEYS.dailyMetricsCache, userId);
      const cache = readScopedJSON(KEYS.dailyMetricsCache, userId, {}) || {};
      const prev = cache[dayISO] || {};
      cache[dayISO] = {
        ...prev,
        consumed: eaten,
        burned: b,
        net: eaten - b,
        updated_at: new Date().toISOString(),
      };
      writeScopedJSON(KEYS.dailyMetricsCache, userId, cache);
      return;
    }
  } catch {}

  // Guest fallback (unscoped)
  try {
    const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
    const prev = cache[dayISO] || {};
    cache[dayISO] = {
      ...prev,
      consumed: eaten,
      burned: b,
      net: eaten - b,
      updated_at: new Date().toISOString(),
    };
    localStorage.setItem('dailyMetricsCache', JSON.stringify(cache));
  } catch {}
}

function setConvenienceTotals(dayISO, eaten, burned, userId = null) {
  try {
    const ctKey = userId ? scopedKey('consumedToday', userId) : 'consumedToday';
    const btKey = userId ? scopedKey('burnedToday', userId) : 'burnedToday';
    localStorage.setItem(ctKey, String(Math.round(safeNum(eaten, 0))));
    localStorage.setItem(btKey, String(Math.round(safeNum(burned, 0))));
  } catch {}

  dispatchConsumed(dayISO, Math.round(safeNum(eaten, 0)));
  dispatchBurned(dayISO, Math.round(safeNum(burned, 0)));
}

// ---- Cloud upserts -----------------------------------------------------------
async function upsertWorkoutCloud(payload) {
  const { user_id } = payload || {};
  if (!supabase || !user_id) return;

  // Requires UNIQUE(user_id, client_id)
  const res = await supabase
    .from('workouts')
    .upsert(payload, { onConflict: 'client_id' })
    .select('id')
    .maybeSingle();

  if (res?.error) throw res.error;
  return res?.data || null;
}

async function deleteWorkoutCloud({ user_id, client_id }) {
  if (!supabase || !user_id || !client_id) return;
  const res = await supabase
    .from('workouts')
    .delete()
    .eq('user_id', user_id)
    .eq('client_id', client_id);

  if (res?.error) throw res.error;
}

async function upsertMealCloud(payload) {
  const { user_id } = payload || {};
  if (!supabase || !user_id) return;

  // Your DB schema has UNIQUE(client_id) (not (user_id,client_id)),
  // so onConflict must match that unique index.
  const res = await supabase
    .from('meals')
    .upsert(payload, { onConflict: 'client_id' })
    .select('id')
    .maybeSingle();

  // If the payload contains columns that don't exist yet (schema drift),
  // retry with minimal columns that are guaranteed in your schema.
  if (res?.error && /column .* does not exist/i.test(res.error?.message || '')) {
    const minimal = {
      user_id: payload.user_id,
      client_id: payload.client_id,
      eaten_at: payload.eaten_at,
      title: payload.title ?? null,
      total_calories: payload.total_calories ?? null,
      updated_at: payload.updated_at ?? new Date().toISOString(),
    };
    const res2 = await supabase
      .from('meals')
      .upsert(minimal, { onConflict: 'client_id' })
      .select('id')
      .maybeSingle();
    if (res2?.error) throw res2.error;
    return res2?.data || null;
  }

  if (res?.error) throw res.error;
  return res?.data || null;
}

async function deleteMealCloud({ user_id, client_id }) {
  if (!supabase || !user_id || !client_id) return;
  const res = await supabase
    .from('meals')
    .delete()
    .eq('user_id', user_id)
    .eq('client_id', client_id);

  if (res?.error) throw res.error;
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

  // Legacy fallback if columns missing
  if (/column .*local_day.* does not exist/i.test(res.error?.message || '')) {
    const legacy = {
      user_id,
      day: payload?.local_day,
      cals_eaten: payload?.calories_eaten,
      cals_burned: payload?.calories_burned,
      net_cals: payload?.net_calories,
      updated_at: payload?.updated_at
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

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

/**
 * upsertDailyMetricsLocalFirst
 * Accepts either:
 *  - { user_id, local_day, consumed, burned }
 *  - { user_id, local_day, calories_eaten, calories_burned, net_calories }
 */
export async function upsertDailyMetricsLocalFirst(input = {}) {
  const user_id = input?.user_id || input?.userId || null;
  const dayISO = input?.local_day || input?.day || localDayISO(new Date());

  const eaten = Math.round(
    safeNum(input?.consumed, NaN) ||
    safeNum(input?.calories_eaten, NaN) ||
    safeNum(input?.cals_eaten, NaN) ||
    safeNum(input?.eaten, NaN) ||
    0
  );

  const burned = Math.round(
    safeNum(input?.burned, NaN) ||
    safeNum(input?.calories_burned, NaN) ||
    safeNum(input?.cals_burned, NaN) ||
    0
  );

  // Local truth for banner (scoped when signed in)
  writeDailyMetricsCache(dayISO, { consumed: eaten, burned }, user_id);
  setConvenienceTotals(dayISO, eaten, burned, user_id);

  // Cloud (best-effort)
  if (!user_id) return { ok: true, dayISO, eaten, burned, localOnly: true };

  const payload = {
    user_id,
    local_day: dayISO,
    calories_eaten: eaten,
    calories_burned: burned,
    net_calories: eaten - burned,
    updated_at: new Date().toISOString(),
  };

  try {
    await upsertDailyMetricsCloud(payload);
    return { ok: true, dayISO, eaten, burned };
  } catch (e) {
    // Queue for later flush
    try {
      enqueueOp({
        type: 'upsert',
        table: 'daily_metrics',
        user_id,
        client_id: `dm_${dayISO}`,
        payload,
      });
    } catch {}
    return { ok: false, queued: true, dayISO, eaten, burned, error: String(e?.message || e) };
  }
}

/**
 * saveMealLocalFirst
 * Cloud truth (meals tab also keeps a local history list).
 */
export async function saveMealLocalFirst({
  user_id,
  client_id,
  eaten_at,
  title,
  total_calories,
  // optional fields (may exist in app but not necessarily in DB)
  protein_g = null,
  carbs_g = null,
  fat_g = null,
  food_id = null,
  portion_id = null,
  portion_label = null,
  qty = 1,
  unit = 'serving',
  food_name = null,
} = {}) {
  const cidRaw = client_id;
  const cid = (cidRaw && UUID_RE.test(String(cidRaw)))
    ? String(cidRaw)
    : (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : uuidv4Fallback());

  const eatenAt = eaten_at || new Date().toISOString();
  const dayISO = localDayISO(new Date(eatenAt));

  // Always update local totals immediately (guest or signed-in)
  try {
    const cals = Math.round(safeNum(total_calories, 0));
    if (user_id) {
      ensureScopedFromLegacy(KEYS.dailyMetricsCache, user_id);
      const cache = readScopedJSON(KEYS.dailyMetricsCache, user_id, {}) || {};
      const prev = cache[dayISO] || {};
      const prevConsumed = Math.round(safeNum(prev?.consumed ?? 0, 0));
      const burned = Math.round(safeNum(prev?.burned ?? 0, 0));
      const nextConsumed = Math.max(0, prevConsumed + cals);

      writeDailyMetricsCache(dayISO, { consumed: nextConsumed, burned }, user_id);
      setConvenienceTotals(dayISO, nextConsumed, burned, user_id);
      try { localStorage.setItem('dailyMetrics:lastWrite', String(Date.now())); } catch {}
    } else {
      dispatchConsumed(dayISO, cals);
    }
  } catch {}

  // Build payloads:
  // - Cloud payload must match your current public.meals schema
  // - Optional macros/food refs can be stored locally (history) and/or in meal_items if you extend schema later
  const cloudPayload = user_id ? {
    user_id,
    client_id: cid,
    eaten_at: eatenAt,
    title: title || food_name || 'Meal',
    total_calories: Math.round(safeNum(total_calories, 0)),
    updated_at: new Date().toISOString(),
  } : null;

  // Guests: let MealTracker handle local history; return local result
  if (!user_id) return { ok: true, localOnly: true, client_id: cid };

  try {
    const saved = await upsertMealCloud(cloudPayload);
    return { ok: true, id: saved?.id || null, data: saved, client_id: cid };
  } catch (e) {
    try {
      enqueueOp({ type: 'upsert', table: 'meals', user_id, client_id: cid, payload: cloudPayload });
    } catch {}
    return { ok: false, queued: true, error: String(e?.message || e), client_id: cid };
  }
}

export async function deleteMealLocalFirst({ user_id, client_id } = {}) {
  if (!user_id || !client_id) return { ok: false, reason: 'missing_user_or_client_id' };
  try {
    await deleteMealCloud({ user_id, client_id });
    return { ok: true };
  } catch (e) {
    try {
      enqueueOp({ type: 'delete', table: 'meals', user_id, client_id, payload: { user_id, client_id } });
    } catch {}
    return { ok: false, queued: true, error: String(e?.message || e) };
  }
}

/**
 * saveWorkoutLocalFirst
 * - local_day is ALWAYS written (date, YYYY-MM-DD)
 * - client_id is stable PER SESSION
 * - cloud upsert uses UNIQUE(user_id, client_id)
 */
export async function saveWorkoutLocalFirst({
  user_id,
  client_id,
  started_at,
  ended_at,
  total_calories,
  local_day,
  items,
  exercises, // optional legacy/local history field (array)
  name = 'Workout',
} = {}) {
  const nowISO = new Date().toISOString();
  const startISO = started_at || nowISO;
  const dayISO = local_day || localDayISO(new Date(startISO));

  // Per-session client id (UUID preferred; schema requires uuid)
  const cidRaw = client_id;
  const cid = (cidRaw && UUID_RE.test(String(cidRaw)))
    ? String(cidRaw)
    : (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : uuidv4Fallback());

  // Derive exercises list (must be non-empty for DB check constraint)
  const exFromItems =
    (items && typeof items === 'object' && !Array.isArray(items) && Array.isArray(items.exercises))
      ? items.exercises
      : null;

  const exArr = Array.isArray(exFromItems) && exFromItems.length
    ? exFromItems
    : (Array.isArray(exercises) ? exercises : []);

  // ANTI_CLOBBER_WORKOUTS: never persist empty workouts
  if (!Array.isArray(exArr) || exArr.length === 0) {
    return { ok: true, skipped: true, reason: 'empty_workout' };
  }

  const total = Math.round(safeNum(total_calories, 0));

  // --- Local immediate totals update (scoped if logged in) ---
  if (user_id) {
    try {
      ensureScopedFromLegacy(KEYS.dailyMetricsCache, user_id);
      const cache = readScopedJSON(KEYS.dailyMetricsCache, user_id, {}) || {};
      const prev = cache[dayISO] || {};
      const consumed = Math.round(safeNum(prev?.consumed ?? 0, 0));
      const prevBurned = Math.round(safeNum(prev?.burned ?? 0, 0));
      const nextBurned = Math.max(0, prevBurned + total);

      writeDailyMetricsCache(dayISO, { consumed, burned: nextBurned }, user_id);
      setConvenienceTotals(dayISO, consumed, nextBurned, user_id);

      // mark last local write to prevent cloud hydration clobber
      try { localStorage.setItem('dailyMetrics:lastWrite', String(Date.now())); } catch {}
    } catch {}
  } else {
    // guest: update banner via event (WorkoutPage writes local history)
    dispatchBurned(dayISO, total);
  }

  // --- Normalize items for cloud (must be object with items.exercises non-empty array) ---
  const normalizedItems = (() => {
    if (items && typeof items === 'object' && !Array.isArray(items)) {
      if (Array.isArray(items.exercises) && items.exercises.length > 0) return items;
    }
    // build from exArr
    const exNorm = exArr.map((ex) => ({
      name: ex?.name || ex?.exerciseName || '',
      sets: ex?.sets ?? null,
      reps: ex?.reps ?? null,
      weight: ex?.weight ?? null,
      calories: ex?.calories ?? null,
    })).filter(x => String(x.name || '').trim().length > 0);
    return { exercises: exNorm };
  })();

  if (!normalizedItems.exercises || normalizedItems.exercises.length === 0) {
    return { ok: true, skipped: true, reason: 'empty_workout_normalized' };
  }

  const row = {
    user_id,
    client_id: cid,
    started_at: startISO,
    ended_at: ended_at || nowISO,
    total_calories: total,
    local_day: dayISO,
    items: normalizedItems,
    updated_at: nowISO,
  };

  // Guests: just return local result (WorkoutPage persists history locally)
  if (!user_id) return { ok: true, localOnly: true, client_id: cid };

  // Signed-in: attempt cloud upsert; queue on failure
  try {
    const saved = await upsertWorkoutCloud(row);
    return { ok: true, id: saved?.id || null, data: saved, client_id: cid };
  } catch (e) {
    try {
      enqueueOp({ type: 'upsert', table: 'workouts', user_id, client_id: cid, payload: row });
    } catch {}
    return { ok: false, queued: true, error: String(e?.message || e), client_id: cid };
  }
}

export async function deleteWorkoutLocalFirst({ user_id, client_id } = {}) {
  if (!user_id || !client_id) return { ok: false, reason: 'missing_user_or_client_id' };
  try {
    await deleteWorkoutCloud({ user_id, client_id });
    return { ok: true };
  } catch (e) {
    try {
      enqueueOp({ type: 'delete', table: 'workouts', user_id, client_id, payload: { user_id, client_id } });
    } catch {}
    return { ok: false, queued: true, error: String(e?.message || e) };
  }
}