// src/lib/sync.js
// Local-first queued sync engine (Supabase best-effort).
// Provides:
// - enqueueOp(op)  ✅ (this fixes your build error)
// - flushPending({ maxTries })
// - attachSyncListeners()
//
// Queue is stored in localStorage so offline writes are safe.

import { supabase } from './supabaseClient';


async function fallbackWorkoutUpsert(payload) {
  const { user_id, client_id } = payload || {};
  if (!supabase || !user_id) throw new Error('missing_user_or_supabase');

  const ex = await supabase
    .from('workouts')
    .select('id')
    .eq('user_id', user_id)
    .eq('client_id', client_id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (ex?.data?.id) {
    const upd = await supabase
      .from('workouts')
      .update(payload)
      .eq('id', ex.data.id);
    if (upd?.error) throw upd.error;
    return;
  }

  const ins = await supabase
    .from('workouts')
    .insert(payload);
  if (ins?.error) throw ins.error;
}

const OPS_KEY = 'slimcal:pendingOps:v1';
const LOCK_KEY = 'slimcal:pendingOps:lock:v1';
const LOCK_MS = 8000;

function nowIso() {
  try { return new Date().toISOString(); } catch { return String(Date.now()); }
}

function safeJsonParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function readOps() {
  const ops = safeJsonParse(localStorage.getItem(OPS_KEY) || '[]', []);
  return Array.isArray(ops) ? ops : [];
}

function writeOps(ops) {
  try {
    localStorage.setItem(OPS_KEY, JSON.stringify(Array.isArray(ops) ? ops : []));
  } catch {}
}

function withLock(fn) {
  const t = Date.now();
  try {
    const lock = safeJsonParse(localStorage.getItem(LOCK_KEY) || '{}', {});
    if (lock?.until && lock.until > t) {
      return { ok: false, reason: 'locked' };
    }
    localStorage.setItem(LOCK_KEY, JSON.stringify({ until: t + LOCK_MS }));
  } catch {}

  const done = () => {
    try { localStorage.removeItem(LOCK_KEY); } catch {}
  };

  return Promise.resolve()
    .then(fn)
    .then(
      (res) => { done(); return res; },
      (err) => { done(); throw err; }
    );
}

// Normalize op so it’s safe + consistent
function normalizeOp(op) {
  const base = op && typeof op === 'object' ? op : {};
  return {
    op_id: base.op_id || base.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `op_${Date.now()}_${Math.random().toString(16).slice(2)}`),
    created_at: base.created_at || nowIso(),
    tries: Number.isFinite(base.tries) ? base.tries : 0,

    // intent
    type: base.type || 'upsert', // 'upsert' | 'delete'
    table: base.table || '',

    // payload
    payload: base.payload || null,

    // metadata (optional)
    user_id: base.user_id || null,
    client_id: base.client_id || null
  };
}

/**
 * ✅ enqueueOp
 * Adds an operation to the pending queue.
 */
export function enqueueOp(op) {
  try {
    const norm = normalizeOp(op);
    const ops = readOps();

    // de-dupe by op_id
    if (ops.some(o => o?.op_id === norm.op_id)) return norm.op_id;

    ops.push(norm);
    writeOps(ops);
    return norm.op_id;
  } catch (e) {
    console.warn('[sync] enqueueOp failed', e);
    return null;
  }
}

function canUseSupabase() {
  return !!supabase && typeof supabase.from === 'function';
}

async function runOneOp(op) {
  if (!canUseSupabase()) {
    return { ok: false, retry: true, reason: 'no-supabase' };
  }

  const table = op?.table;
  const type = op?.type;
  const payload = op?.payload;

  if (!table) return { ok: true, retry: false, reason: 'no-table' };

  // ---- UPSERT ----
  if (type === 'upsert') {
    if (!payload || typeof payload !== 'object') {
      return { ok: true, retry: false, reason: 'no-payload' };
    }

    // IMPORTANT:
    // We rely on your DB unique constraints (like user_id+local_day or user_id+client_id)
    // So upsert will behave idempotently.
    const res = await supabase
      .from(table)
      .upsert(payload)
      .select()
      .maybeSingle();

    if (res?.error) {
      // if RLS blocks, don't retry forever
      const msg = String(res.error.message || '');
      const code = String(res.error.code || '');

      // 42501 = insufficient privilege / RLS issues sometimes
      if (code === '42501' || /permission|rls|policy/i.test(msg)) {
        return { ok: false, retry: false, reason: 'rls' };
      }

      return { ok: false, retry: true, reason: 'upsert-error', error: res.error };
    }

    return { ok: true, retry: false };
  }

  // ---- DELETE ----
  if (type === 'delete') {
    // payload should describe the where clause
    // Example payload:
    // { where: { id: '...', user_id: '...' } }
    const where = payload?.where || null;
    if (!where || typeof where !== 'object') {
      return { ok: true, retry: false, reason: 'no-where' };
    }

    let q = supabase.from(table).delete();
    for (const [k, v] of Object.entries(where)) {
      if (v === undefined || v === null) continue;
      q = q.eq(k, v);
    }

    const res = await q;
    if (res?.error) {
      const msg = String(res.error.message || '');
      const code = String(res.error.code || '');

      if (code === '42501' || /permission|rls|policy/i.test(msg)) {
        return { ok: false, retry: false, reason: 'rls' };
      }

      return { ok: false, retry: true, reason: 'delete-error', error: res.error };
    }

    return { ok: true, retry: false };
  }

  // unknown op type, drop it
  return { ok: true, retry: false, reason: 'unknown-type' };
}

/**
 * flushPending
 * Runs pending ops in order. Removes successful ops from queue.
 */
export async function flushPending({ maxTries = 2 } = {}) {
  const lockRes = await withLock(async () => {
    const ops = readOps();
    if (!ops.length) return { ok: true, processed: 0 };

    const remaining = [];
    let processed = 0;

    for (const op of ops) {
      const tries = Number(op?.tries || 0);
      if (tries >= maxTries) {
        // give up and drop it
        continue;
      }

      const result = await runOneOp(op);
      processed += 1;

      if (result.ok) {
        // done ✅
        continue;
      }

      if (!result.retry) {
        // don't retry — drop it
        continue;
      }

      // retry later
      remaining.push({ ...op, tries: tries + 1 });
    }

    writeOps(remaining);
    return { ok: true, processed, remaining: remaining.length };
  });

  if (lockRes?.ok === false && lockRes?.reason === 'locked') {
    return { ok: true, processed: 0, remaining: readOps().length, locked: true };
  }

  return lockRes;
}

/**
 * attachSyncListeners
 * Flush on online + visibility/focus.
 */
export function attachSyncListeners() {
  try {
    const onOnline = async () => {
      try { await flushPending({ maxTries: 2 }); } catch {}
    };
    const onFocus = async () => {
      try { await flushPending({ maxTries: 1 }); } catch {}
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') onFocus();
    });

    // return cleanup
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
    };
  } catch {
    return () => {};
  }
}