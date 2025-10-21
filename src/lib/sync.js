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

  const res = await supabase
    .from('workouts')
    .upsert(row, { onConflict: 'client_id' })
    .select()
    .maybeSingle();

  if (res.error) {
    // fallback insert if unique index not present yet
    const ins = await supabase.from('workouts').insert(row).select().maybeSingle();
    if (ins.error) throw ins.error;
  }
}

async function deleteWorkout(op) {
  const { client_id } = op.payload || {};
  if (!client_id) return;
  const { error } = await supabase.from('workouts').delete().eq('client_id', client_id);
  if (error) throw error;
}

async function upsertDailyMetrics(op) {
  const p = op.payload || {};
  const rowNew = mapDailyMetricsNew(p);
  if (!rowNew.user_id) return; // skip cloud for anonymous

  // Try new schema first (user_id, local_day)
  let { error } = await supabase
    .from('daily_metrics')
    .upsert(rowNew, { onConflict: 'user_id,local_day' })
    .select()
    .maybeSingle();

  // Fallback to legacy if the new columns don't exist yet
  if (error && /column .* does not exist/i.test(error.message || '')) {
    const rowLegacy = mapDailyMetricsLegacy(p);
    const res2 = await supabase
      .from('daily_metrics')
      .upsert(rowLegacy, { onConflict: 'user_id,day' })
      .select()
      .maybeSingle();
    if (res2.error) throw res2.error;
    return;
  }
  if (error) throw error;
}

async function upsertMeal(op) {
  const p = op.payload || {};
  const row = {
    client_id: p.client_id,
    user_id: p.user_id ?? null,
    eaten_at: p.eaten_at,
    title: p.title ?? null,
    total_calories: Number(p.total_calories) || 0,
  };
  const { error } = await supabase.from('meals').upsert(row, { onConflict: 'client_id' }).select().maybeSingle();
  if (error) throw error;
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
