// src/lib/sync.js
// Local-first queued sync engine (Supabase best-effort).
// Provides:
// - enqueueOp(op)  [ok] (this fixes your build error)
// - flushPending({ maxTries })
// - attachSyncListeners()
//
// Queue is stored in localStorage so offline writes are safe.

import { supabase } from './supabaseClient';

const OPS_KEY = 'slimcal:pendingOps:v1';
const LOCK_KEY = 'slimcal:pendingOps:lock:v1';
const LOCK_MS = 8000;

function nowIso() {
  try { return new Date().toISOString(); } catch (e) { return String(Date.now()); }
}

function safeJsonParse(s, fallback) {
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

function readOps() {
  const ops = safeJsonParse(localStorage.getItem(OPS_KEY) || '[]', []);
  return Array.isArray(ops) ? ops : [];
}

function writeOps(ops) {
  try {
    localStorage.setItem(OPS_KEY, JSON.stringify(Array.isArray(ops) ? ops : []));
  } catch (e) {}
}

function withLock(fn) {
  const t = Date.now();
  try {
    const lock = safeJsonParse(localStorage.getItem(LOCK_KEY) || '{}', {});
    if (lock?.until && lock.until > t) {
      return { ok: false, reason: 'locked' };
    }
    localStorage.setItem(LOCK_KEY, JSON.stringify({ until: t + LOCK_MS }));
  } catch (e) {}

  const done = () => {
    try { localStorage.removeItem(LOCK_KEY); } catch (e) {}
  };

  return Promise.resolve()
    .then(fn)
    .then(
      (res) => { done(); return res; },
      (err) => { done(); throw err; }
    );
}

// Normalize op so it's safe + consistent
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
 * [ok] enqueueOp
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
    // PostgREST will throw 400/409 if `onConflict` doesn't match a REAL unique constraint.
    // Use explicit per-table conflict targets (do NOT guess based on payload shape).
    const onConflictByTable = {
      // Your meals table is unique on client_id (single column)
      meals: 'client_id',
      // Workouts are unique per user + client_id
      workouts: 'user_id,client_id',
      // Daily metrics are unique per user + local_day
      daily_metrics: 'user_id,local_day',
    };

    const onConflict = onConflictByTable[table] || (
      (payload?.user_id && payload?.client_id) ? 'user_id,client_id' : undefined
    );

    const res = await supabase
      .from(table)
      .upsert(payload, onConflict ? { onConflict } : undefined)
      .select()
      .maybeSingle();

    // Workouts: try alternate conflict targets so rows always insert/update like meals.
    // Handles cases where DB has UNIQUE(client_id) or UNIQUE(user_id,local_day) instead.
    let resFinal = res;
    if (resFinal?.error && table === 'workouts') {
      const msg0 = String(resFinal.error?.message || '');
      const code0 = String(resFinal.error?.code || '');
      const conflictErr = /there is no unique or exclusion constraint|no unique constraint|on conflict/i.test(msg0) || code0 === '42P10';
      if (conflictErr) {
        const tries = ['client_id', 'user_id,local_day'];
        for (const alt of tries) {
          const r2 = await supabase
            .from(table)
            .upsert(payload, { onConflict: alt })
            .select()
            .maybeSingle();
          if (!r2?.error) { resFinal = r2; break; }
          // if still conflict-target error, continue; otherwise stop and return the real error
          const msg2 = String(r2.error?.message || '');
          const code2 = String(r2.error?.code || '');
          const stillConflict = /there is no unique or exclusion constraint|no unique constraint|on conflict/i.test(msg2) || code2 === '42P10';
          if (!stillConflict) { resFinal = r2; break; }
        }
      }
    }

    if (resFinal?.error) {
      // if RLS blocks, don't retry forever
      const msg = String(resFinal.error.message || '');
      const code = String(resFinal.error.code || '');

      // 42501 = insufficient privilege / RLS issues sometimes
      if (code === '42501' || /permission|rls|policy/i.test(msg)) {
        return { ok: false, retry: false, reason: 'rls' };
      }

      return { ok: false, retry: true, reason: 'upsert-error', error: resFinal.error };
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
      const msg = String(resFinal.error.message || '');
      const code = String(resFinal.error.code || '');

      if (code === '42501' || /permission|rls|policy/i.test(msg)) {
        return { ok: false, retry: false, reason: 'rls' };
      }

      return { ok: false, retry: true, reason: 'delete-error', error: resFinal.error };
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
        // done [ok]
        continue;
      }

      if (!result.retry) {
        // don't retry - drop it
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
      try { await flushPending({ maxTries: 2 }); } catch (e) {}
    };
    const onFocus = async () => {
      try { await flushPending({ maxTries: 1 }); } catch (e) {}
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
  } catch (e) {
    return () => {};
  }
}