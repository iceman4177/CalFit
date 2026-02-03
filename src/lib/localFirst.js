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

// ---- Stable UUID per device (anon users) ------------------------------------
function getClientId() {
  try {
    let cid = localStorage.getItem('clientId');
    if (!cid) {
      cid = (crypto?.randomUUID?.() || uuidv4Fallback());
      localStorage.setItem('clientId', cid);
    }
    return cid;
  } catch {
    return 'anon';
  }
}

// UUID v4 fallback (for environments without crypto.randomUUID)
function uuidv4Fallback() {
  try {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });
  } catch {
    return '00000000-0000-4000-8000-000000000000';
  }

// Deterministic UUID from a string (stable across devices)
// Used to guarantee ONE workout row per (user_id, local_day) without requiring DB schema changes.
function stableUuidFromString(str) {
  try {
    const s = String(str || '');
    // FNV-1a 32-bit
    const fnv = (seed) => {
      let h = seed >>> 0;
      for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        // h *= 16777619 (via shifts to stay in 32-bit)
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      return h >>> 0;
    };

    const h1 = fnv(0x811c9dc5);
    const h2 = fnv(0x811c9dc5 ^ 0x9e3779b9);
    const h3 = fnv(0x811c9dc5 ^ 0x85ebca6b);
    const h4 = fnv(0x811c9dc5 ^ 0xc2b2ae35);

    // 16 bytes from 4x32-bit hashes
    const b = new Uint8Array(16);
    const put32 = (off, v) => {
      b[off + 0] = (v >>> 24) & 0xff;
      b[off + 1] = (v >>> 16) & 0xff;
      b[off + 2] = (v >>> 8) & 0xff;
      b[off + 3] = (v >>> 0) & 0xff;
    };
    put32(0, h1); put32(4, h2); put32(8, h3); put32(12, h4);

    // RFC4122 variant + v5-ish marker (deterministic)
    b[6] = (b[6] & 0x0f) | 0x50; // version 5
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10

    const hex = Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join('-');
  } catch (e) {
    return uuidv4Fallback();
  }
}

function isOnConflictSchemaError(err) {
  const msg = String(err?.message || '');
  return (
    err?.status === 400 ||
    /on_conflict/i.test(msg) ||
    /no unique/i.test(msg) ||
    /there is no unique constraint/i.test(msg) ||
    /constraint/i.test(msg)
  );
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
      try { localStorage.setItem(scopedKey('dailyMetrics:lastWrite', userId), String(Date.now())); } catch {}
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
    try { localStorage.setItem('dailyMetrics:lastWrite', String(Date.now())); } catch {}
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

  // Try the most specific onConflict first, then fall back to whatever constraint exists in your DB.
  // This prevents silent "no insert" failures when schema differs between environments.
  const attempts = [
    { onConflict: 'user_id,client_id' },
    { onConflict: 'client_id' },
    { onConflict: 'user_id,local_day' },
  ];

  let lastErr = null;
  for (const opt of attempts) {
    const res = await supabase
      .from('workouts')
      .upsert(payload, opt)
      .select('id')
      .maybeSingle();

    if (!res?.error) return res?.data || null;

    lastErr = res.error;
    // Only retry on schema/on_conflict mismatch. Otherwise, bubble the real error.
    if (!isOnConflictSchemaError(res.error)) throw res.error;
  }

  if (lastErr) throw lastErr;
  return null;
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

  const res = await supabase
    .from('meals')
    .upsert(payload, { onConflict: 'user_id,client_id' })
    .select('id')
    .maybeSingle();

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
  protein_g = null,
  carbs_g = null,
  fat_g = null,
  food_id = null,
  portion_id = null,
  portion_label = null,
  qty = 1,
  unit = 'serving',
  food_name = null,
  local_day = null,
} = {}) {
  if (!user_id) return { ok: false, reason: 'no_user' };

  const cid = client_id || (crypto?.randomUUID?.() || uuidv4Fallback());
  const eatenAt = eaten_at || new Date().toISOString();
  const dayISO = local_day || localDayISO(new Date(eatenAt));

  const payload = {
    user_id,
    client_id: cid,
    eaten_at: eatenAt,
    local_day: dayISO,
    title: title || food_name || 'Meal',
    total_calories: Math.round(safeNum(total_calories, 0)),
    protein_g: protein_g == null ? null : safeNum(protein_g, null),
    carbs_g: carbs_g == null ? null : safeNum(carbs_g, null),
    fat_g: fat_g == null ? null : safeNum(fat_g, null),
    food_id,
    portion_id,
    portion_label,
    qty,
    unit,
    updated_at: new Date().toISOString(),
  };

  try {
    const saved = await upsertMealCloud(payload);
    return { ok: true, id: saved?.id || null, data: saved, client_id: cid };
  } catch (e) {
    try {
      enqueueOp({ type: 'upsert', table: 'meals', user_id, client_id: cid, payload });
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
  exercises,
  name = 'Workout',
} = {}) {
  // ANTI_CLOBBER_WORKOUTS: never persist empty workouts (prevents banner/today list resetting to 0)
  // IMPORTANT: workouts table enforces items.exercises to be a non-empty array (check constraint).
  const exInput = Array.isArray(exercises) ? exercises : null;
  const exFromItems = (items && typeof items === 'object' && !Array.isArray(items) && Array.isArray(items.exercises))
    ? items.exercises
    : null;
  const exArrRaw = exInput || exFromItems || [];
  const exArr = Array.isArray(exArrRaw) ? exArrRaw : [];
  if (exArr.length === 0) {
    return { ok: true, skipped: true, reason: 'empty_workout' };
  }

  const nowISO = new Date().toISOString();
  const startISO = started_at || nowISO;
  const dayISO = local_day || localDayISO(new Date(startISO));

  // Deterministic client_id per (user_id, local_day) so all devices upsert the SAME row.
  // Falls back to a random uuid for guests.
  const cid = client_id || (user_id ? stableUuidFromString(`workout:${user_id}:${dayISO}`) : (crypto?.randomUUID?.() || `${getClientId()}_${Date.now()}_${Math.random().toString(16).slice(2)}`));

  const total = Math.round(safeNum(total_calories, 0));

  // Update burned totals locally right away (scoped) — ABSOLUTE from today's workoutHistory
  // This prevents double-counting when draft upserts happen repeatedly while typing.
  if (user_id) {
    try {
      const dayUS = (() => {
        try { return new Date(`${dayISO}T00:00:00`).toLocaleDateString('en-US'); } catch { return dayISO; }
      })();

      ensureScopedFromLegacy(KEYS.workoutHistory, user_id);
      const wh = readScopedJSON(KEYS.workoutHistory, user_id, []);
      const arr = Array.isArray(wh) ? wh : [];

      const hasThis = arr.some(w =>
        String(w?.client_id || w?.id || '') === String(cid) &&
        (w?.__local_day === dayISO || w?.local_day === dayISO || w?.date === dayUS || w?.date === dayISO)
      );

      const burnedAbs = Math.round(
        arr
          .filter(w => (w?.__local_day === dayISO || w?.local_day === dayISO || w?.date === dayUS || w?.date === dayISO))
          .reduce((s, w) => s + (Number(w?.totalCalories ?? w?.total_calories) || 0), 0) + (hasThis ? 0 : total)
      );

      ensureScopedFromLegacy(KEYS.dailyMetricsCache, user_id);
      const cache = readScopedJSON(KEYS.dailyMetricsCache, user_id, {}) || {};
      const prev = cache[dayISO] || {};
      const consumed = Math.round(safeNum(prev?.consumed ?? prev?.calories_eaten ?? 0, 0));

      writeDailyMetricsCache(dayISO, { consumed, burned: burnedAbs }, user_id);
      setConvenienceTotals(dayISO, consumed, burnedAbs, user_id);
    } catch {}
  } else {
    dispatchBurned(dayISO, total);
  }

  
  // Build cloud-safe row matching Supabase schema (public.workouts)
  const normalizedItems = (() => {
    // Schema requires items to be an object with non-empty items.exercises array
    if (items && typeof items === 'object' && !Array.isArray(items)) {
      if (Array.isArray(items.exercises) && items.exercises.length > 0) return items;
    }
    if (exArr.length > 0) {
      return {
        exercises: exArr.map(ex => ({
          name: ex?.name || ex?.exerciseName || '',
          sets: ex?.sets ?? null,
          reps: ex?.reps ?? null,
          weight: ex?.weight ?? null,
          calories: ex?.calories ?? null,
        })).filter(x => String(x.name || '').trim().length > 0)
      };
    }
    return { exercises: [] };
  })();

  if (!normalizedItems.exercises || normalizedItems.exercises.length === 0) {
    throw new Error('Workout must include at least 1 exercise (items.exercises required)');
  }

  const row = {
    user_id,
    client_id: cid,
    started_at: started_at || new Date().toISOString(),
    ended_at: ended_at || new Date().toISOString(),
    total_calories: safeNum(total_calories, total),
    local_day: dayISO,
    items: normalizedItems,
    // keep updated_at for compatibility; harmless if column exists, ignored if not
    updated_at: new Date().toISOString(),
  };


  // Guests: just return local result (WorkoutPage writes local history)
  if (!user_id) return { ok: true, localOnly: true, client_id: cid };

  try {
    const saved = await upsertWorkoutCloud(row);
    return { ok: true, id: saved?.id || null, data: saved, client_id: cid };
  } catch (e) {
    // Make failures visible; otherwise you only see GETs and think nothing happened.
    try { console.warn('[localFirst] workouts upsert failed', e, row); } catch {}
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
