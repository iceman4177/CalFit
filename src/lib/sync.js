// src/lib/sync.js
// Offline sync engine: pending queue + auto-flush with idempotent upserts.
// This version uses native crypto.randomUUID() to avoid external deps.

import { isOnline } from '../utils/network';
import { supabase } from '../lib/supabaseClient'; // matches your existing import style

const PENDING_KEY = 'pendingOps';

// ---------- small utils ----------
function uuidv4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback (RFC4122-ish) for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function nowIso() {
  return new Date().toISOString();
}

// ---------- queue helpers ----------
function readQueue() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { return []; }
}
function writeQueue(q) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(q));
}

// ---------- public helpers ----------
export function ensureClientId(obj) {
  if (!obj.client_id) obj.client_id = uuidv4();
  return obj;
}

export function enqueue(op) {
  const q = readQueue();
  q.push({ id: uuidv4(), ts: Date.now(), retry_count: 0, ...op });
  writeQueue(q);
}

// ---------- processors ----------
async function upsertWorkout(op) {
  const row = { ...op.payload, client_updated_at: nowIso() };
  const { error } = await supabase.from('workouts').upsert(row, { onConflict: 'client_id' });
  if (error) throw error;
}

async function deleteWorkout(op) {
  const { client_id } = op.payload || {};
  if (!client_id) return;
  const { error } = await supabase.from('workouts').delete().eq('client_id', client_id);
  if (error) throw error;
}

async function upsertDailyMetrics(op) {
  const row = { ...op.payload, client_updated_at: nowIso(), local_authoritative: true };
  const { error } = await supabase.from('daily_metrics').upsert(row, { onConflict: 'user_id,date_key' });
  if (error) throw error;
}

async function processItem(op) {
  switch (op.type) {
    case 'workout.upsert':       return upsertWorkout(op);
    case 'workout.delete':       return deleteWorkout(op);
    case 'daily_metrics.upsert': return upsertDailyMetrics(op);
    default: return;
  }
}

// ---------- flush + listener logic ----------
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function flushPending({ maxTries = 1 } = {}) {
  if (!isOnline()) return { ok: false, reason: 'offline' };
  const q = readQueue();
  if (!q.length) return { ok: true, flushed: 0 };

  console.log('[Sync] flush start, items:', q.length);
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
      console.warn('[Sync] item failed', item.type, item.id, err?.message);
    }
  }

  writeQueue(remain);
  console.log('[Sync] flush done. ok:', flushed, 'failed:', remain.length);

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
