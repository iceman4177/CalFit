// src/lib/sync.js
// Offline sync engine: pending queue + auto-flush with idempotent upserts.

import { isOnline } from '../utils/network';
import { supabase } from '../lib/supabaseClient';

const PENDING_KEY = 'pendingOps';

// ---------- small utils ----------
const nowIso = () => new Date().toISOString();
const toLocalDayISO = (d = new Date()) => {
  const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return ld.toISOString().slice(0, 10);
};
const asNum = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// ---------- queue helpers ----------
function readQueue() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { return []; }
}
function writeQueue(q) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(q)); } catch {}
}

// ---------- public helpers ----------
export function ensureClientId(obj) {
  if (obj?.client_id) return obj;
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    obj.client_id = crypto.randomUUID();
  } else {
    obj.client_id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  return obj;
}

export function enqueue(op) {
  const q = readQueue();
  q.push({
    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now() + Math.random()),
    ts: Date.now(),
    retry_count: 0,
    ...op,
  });
  writeQueue(q);
}

// ---------- mappers ----------
function mapDailyMetricsNew(payload) {
  // Accept new or legacy input; emit ONLY valid columns for the new schema
  const local_day = payload.local_day || payload.date_key || toLocalDayISO();
  const calories_eaten  = asNum(payload.calories_eaten ?? payload.consumed);
  const calories_burned = asNum(payload.calories_burned ?? payload.burned);
  const net_calories    = asNum(payload.net_calories ?? payload.net ?? (calories_eaten - calories_burned));
  return {
    user_id: payload.user_id ?? null,
    local_day,
    calories_eaten,
    calories_burned,
    net_calories,
    updated_at: nowIso(),
  };
}

function mapDailyMetricsLegacy(payload) {
  const day = payload.local_day || payload.date_key || toLocalDayISO();
  const cals_eaten  = asNum(payload.calories_eaten ?? payload.consumed);
  const cals_burned = asNum(payload.calories_burned ?? payload.burned);
  const net_cals    = asNum(payload.net_calories ?? payload.net ?? (cals_eaten - cals_burned));
  return {
    user_id: payload.user_id ?? null,
    day,
    cals_eaten,
    cals_burned,
    net_cals,
    updated_at: nowIso(),
  };
}

// ---------- processors ----------
async function upsertWorkout(op) {
  if (!supabase) return;
  const p = op.payload || {};
  if (!p.user_id) return; // skip cloud for anonymous

  const total_calories =
    Number.isFinite(p.total_calories) ? p.total_calories
    : Number.isFinite(p.totalCalories) ? p.totalCalories
    : 0;

  const row = {
    user_id: p.user_id,
    client_id: p.client_id,
    started_at: p.started_at || nowIso(),
    ended_at: p.ended_at || p.started_at || nowIso(),
    total_calories,
    goal: p.goal ?? null,
    notes: p.notes ?? null,
  };

  // Try upsert if constraint exists; otherwise fallback to update+insert
  const res = await supabase
    .from('workouts')
    .upsert(row, { onConflict: 'client_id' })
    .select();

  if (res.error) {
    const msg = String(res.error.message || '');
    const onConflictBad = /no unique|exclusion constraint|on conflict/i.test(msg);

    if (onConflictBad) {
      // update by client_id; if no rows affected, insert
      const up = await supabase
        .from('workouts')
        .update(row)
        .eq('client_id', row.client_id)
        .select();

      if (up.error) throw up.error;
      if (!up.data || up.data.length === 0) {
        const ins = await supabase.from('workouts').insert(row).select();
        if (ins.error) throw ins.error;
      }
      return;
    }

    // fallback insert if unique index not present yet
    const ins = await supabase.from('workouts').insert(row).select();
    if (ins.error) throw ins.error;
  }
}

async function deleteWorkout(op) {
  if (!supabase) return;
  const { client_id } = op.payload || {};
  if (!client_id) return;
  const { error } = await supabase.from('workouts').delete().eq('client_id', client_id);
  if (error) throw error;
}

async function upsertDailyMetrics(op) {
  if (!supabase) return;
  const p = op.payload || {};
  const rowNew = mapDailyMetricsNew(p);
  if (!rowNew.user_id) return; // skip cloud for anonymous

  // Try new schema first (user_id, local_day)
  let res = await supabase
    .from('daily_metrics')
    .upsert(rowNew, { onConflict: 'user_id,local_day' })
    .select();

  if (res.error) {
    const msg = String(res.error.message || '');

    // ✅ Case 1: columns don't exist → legacy
    if (/column .* does not exist/i.test(msg)) {
      const rowLegacy = mapDailyMetricsLegacy(p);
      const res2 = await supabase
        .from('daily_metrics')
        .upsert(rowLegacy, { onConflict: 'user_id,day' })
        .select();
      if (res2.error) throw res2.error;
      return;
    }

    // ✅ Case 2: ON CONFLICT target invalid (NO UNIQUE CONSTRAINT) → manual update/insert
    if (/no unique|exclusion constraint|on conflict/i.test(msg)) {
      // try update by match
      const up = await supabase
        .from('daily_metrics')
        .update(rowNew)
        .eq('user_id', rowNew.user_id)
        .eq('local_day', rowNew.local_day)
        .select();

      if (up.error) throw up.error;

      // if nothing updated, insert new row
      if (!up.data || up.data.length === 0) {
        const ins = await supabase
          .from('daily_metrics')
          .insert(rowNew)
          .select();
        if (ins.error) throw ins.error;
      }
      return;
    }

    // other error
    throw res.error;
  }
}

async function upsertMeal(op) {
  if (!supabase) return;
  const p = op.payload || {};
  if (!p.user_id) return; // ✅ IMPORTANT: don't try cloud writes when anonymous

  const row = {
    client_id: p.client_id,
    user_id: p.user_id,
    eaten_at: p.eaten_at,
    title: p.title ?? null,
    total_calories: Number(p.total_calories) || 0,
  };

  const res = await supabase
    .from('meals')
    .upsert(row, { onConflict: 'client_id' })
    .select();

  if (res.error) {
    const msg = String(res.error.message || '');
    const onConflictBad = /no unique|exclusion constraint|on conflict/i.test(msg);

    if (onConflictBad) {
      const up = await supabase
        .from('meals')
        .update(row)
        .eq('client_id', row.client_id)
        .select();

      if (up.error) throw up.error;
      if (!up.data || up.data.length === 0) {
        const ins = await supabase.from('meals').insert(row).select();
        if (ins.error) throw ins.error;
      }
      return;
    }

    throw res.error;
  }
}

async function processItem(op) {
  switch (op.type) {
    case 'workout.upsert':       return upsertWorkout(op);
    case 'workout.delete':       return deleteWorkout(op);
    case 'daily_metrics.upsert': return upsertDailyMetrics(op);
    case 'meal.upsert':          return upsertMeal(op);
    default: return;
  }
}

// ---------- flush + listener logic ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function flushPending({ maxTries = 1 } = {}) {
  if (!isOnline()) return { ok: false, reason: 'offline' };
  const q = readQueue();
  if (!q.length) return { ok: true, flushed: 0 };
  if (!supabase) return { ok: false, reason: 'no-supabase-client' };

  const remain = [];
  let flushed = 0;

  for (const item of q) {
    const ready = !item.next_after || item.next_after <= Date.now();
    if (!ready) { remain.push(item); continue; }
    try {
      await processItem(item);
      flushed += 1;
    } catch (err) {
      const backoff = Math.min(30000, 1000 * Math.pow(2, item.retry_count || 0));
      remain.push({ ...item, retry_count: (item.retry_count || 0) + 1, next_after: Date.now() + backoff });
    }
  }

  writeQueue(remain);

  if (maxTries > 1 && remain.length) {
    await sleep(1200);
    return flushPending({ maxTries: maxTries - 1 });
  }
  return { ok: true, flushed, failed: remain.length };
}

export function attachSyncListeners() {
  const tryFlush = () => flushPending({ maxTries: 2 }).catch(() => {});
  if (typeof window !== 'undefined') {
    window.addEventListener('online', tryFlush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') tryFlush();
    });
    // initial attempt
    tryFlush();
  }
}
