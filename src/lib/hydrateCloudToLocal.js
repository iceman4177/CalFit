// src/lib/hydrateCloudToLocal.js
// Pull "cloud truth" into local caches to make cross-device totals instant.
// This runs after login bootstrap (useBootstrapSync) and fixes the banner/PC sync.

import { supabase } from './supabaseClient';
import { ensureScopedFromLegacy, readScopedJSON, writeScopedJSON, scopedKey, KEYS } from './scopedStorage.js';

// ---------------- Local-day helpers (avoid UTC drift) ----------------
function localDayISO(d = new Date()) {
  const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return ld.toISOString().slice(0, 10);
}

function safeLocalMidnight(dayISO) {
  try {
    const [y, m, d] = String(dayISO).split('-').map(n => parseInt(n, 10));
    if (!y || !m || !d) return new Date(`${dayISO}T00:00:00`);
    return new Date(y, m - 1, d, 0, 0, 0, 0);
  } catch {
    return new Date(`${dayISO}T00:00:00`);
  }
}

function safeNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function readDailyMetricsNums(row) {
  if (!row || typeof row !== 'object') return { eaten: 0, burned: 0 };

  const eaten =
    safeNum(row.calories_eaten) ||
    safeNum(row.cals_eaten) ||
    safeNum(row.consumed) ||
    safeNum(row.eaten) ||
    0;

  const burned =
    safeNum(row.calories_burned) ||
    safeNum(row.cals_burned) ||
    safeNum(row.burned) ||
    0;

  return { eaten, burned };
}

// ---------------- Local cache / pending-ops guards ----------------
// Prevent "snap back to 0" when cloud hydration runs before queued writes reach Supabase.

const PENDING_OPS_KEY = 'slimcal:pendingOps:v1';

function readPrevDailyCacheRow(userId, dayISO) {
  try {
    ensureScopedFromLegacy(KEYS.dailyMetricsCache, userId);
    const cache = readScopedJSON(KEYS.dailyMetricsCache, userId, {}) || {};
    const row = cache?.[dayISO] || {};
    const nums = readDailyMetricsNums(row);
    const updatedAt = row?.updated_at || row?.updatedAt || null;
    const updatedAtMs = updatedAt ? new Date(updatedAt).getTime() : 0;
    return { eaten: nums.eaten, burned: nums.burned, updatedAtMs };
  } catch {
    return { eaten: 0, burned: 0, updatedAtMs: 0 };
  }
}

function readPendingOpsSafe() {
  try {
    const raw = localStorage.getItem(PENDING_OPS_KEY);
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function opAffectsDay(op, dayISO) {
  try {
    const p = op?.payload || op?.data || {};
    const ld = String(p?.local_day || p?.localDay || p?.day || '');
    if (ld && ld === String(dayISO)) return true;

    const ts = p?.started_at || p?.created_at || p?.createdAt || p?.time || null;
    if (ts) return localDayFromTs(ts) === String(dayISO);

    // Some ops only carry a client_id; treat as unknown day.
    return false;
  } catch {
    return false;
  }
}

function hasPendingOpsForDay(dayISO, tables = []) {
  const want = new Set((tables || []).map(t => String(t || '').toLowerCase()).filter(Boolean));
  const ops = readPendingOpsSafe();
  for (const op of (ops || [])) {
    const table = String(op?.table || op?.table_name || op?.target || '').toLowerCase();
    if (want.size && !want.has(table)) continue;
    if (opAffectsDay(op, dayISO)) return true;
  }
  return false;
}

function hasLocalWorkoutsForDay(userId, dayISO) {
  try {
    ensureScopedFromLegacy(KEYS.workoutHistory, userId);
    const list = readScopedJSON(KEYS.workoutHistory, userId, []) || [];
    const arr = Array.isArray(list) ? list : [];
    return arr.some((s) => {
      const cals = safeNum(s?.totalCalories ?? s?.total_calories ?? s?.calories ?? 0, 0);
      if (cals <= 0) return false;

      const ld = String(s?.local_day || s?.__local_day || '');
      if (ld) return ld === String(dayISO);

      const d = String(s?.date || '');
      const dayUS = dayISOToUS(dayISO);
      if (d === String(dayISO) || d === String(dayUS)) return true;

      const ts = s?.started_at || s?.createdAt || s?.created_at;
      if (!ts) return false;
      return localDayFromTs(ts) === String(dayISO);
    });
  } catch {
    return false;
  }
}

function guardZeroFromCloud({ userId, dayISO, eaten, burned, prev }) {
  try {
    const prevE = safeNum(prev?.eaten, 0);
    const prevB = safeNum(prev?.burned, 0);

    // If cloud is 0 but we have strong local evidence for today, keep local.
    const localWorkoutEvidence =
      hasLocalWorkoutsForDay(userId, dayISO) ||
      hasPendingOpsForDay(dayISO, ['workouts', 'daily_metrics']);

    const localMealEvidence =
      hasPendingOpsForDay(dayISO, ['meals', 'meal_items', 'daily_metrics']);

    let nextEaten = safeNum(eaten, 0);
    let nextBurned = safeNum(burned, 0);

    if (nextBurned <= 0 && prevB > 0 && localWorkoutEvidence) nextBurned = prevB;
    if (nextEaten <= 0 && prevE > 0 && localMealEvidence) nextEaten = prevE;

    return { eaten: nextEaten, burned: nextBurned };
  } catch {
    return { eaten, burned };
  }
}

function writeDailyMetricsCache(dayISO, eaten, burned, userId) {
  try {
    ensureScopedFromLegacy(KEYS.dailyMetricsCache, userId);
    const cache = readScopedJSON(KEYS.dailyMetricsCache, userId, {}) || {};
    cache[dayISO] = {
      consumed: safeNum(eaten, 0), // canonical key used by banner
      burned: safeNum(burned, 0),
      net: safeNum(eaten, 0) - safeNum(burned, 0),
      updated_at: new Date().toISOString(),
    };
    writeScopedJSON(KEYS.dailyMetricsCache, userId, cache);
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

// ---------------- Workouts → local workoutHistory (for banner + on-page history) ----------------
function dayISOToUS(dayISO) {
  try {
    const [y, m, d] = String(dayISO).split('-');
    if (!y || !m || !d) return String(dayISO);
    return `${m}/${d}/${y}`;
  } catch {
    return String(dayISO);
  }
}

function localDayFromTs(ts) {
  try {
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return '';
    return localDayISO(d);
  } catch {
    return '';
  }
}

function normalizeWorkoutRow(r, dayISO) {
  const id = r?.id || null;
  const client_id = r?.client_id || id || null;
  const local_day = r?.local_day || dayISO || '';
  const total_calories = safeNum(r?.total_calories ?? r?.calories_burned ?? r?.burned ?? 0, 0);
  const name = r?.name || 'Workout';
  const started_at = r?.started_at || r?.created_at || new Date().toISOString();
  const ended_at = r?.ended_at || started_at;
  const items = r?.items ?? null;

  return {
    id,
    client_id,
    name,
    total_calories,
    started_at,
    ended_at,
    local_day,
    __local_day: local_day,
    items,
    __from_cloud: true,
    updated_at: r?.updated_at || r?.created_at || new Date().toISOString(),
  };
}

function mergeWorkoutsIntoLocalHistory(dayISO, cloudWorkouts, userId) {
  try {
    ensureScopedFromLegacy(KEYS.workoutHistory, userId);
    const list = readScopedJSON(KEYS.workoutHistory, userId, []) || [];

    const isSameDay = (s) => {
      const ld = String(s?.local_day || s?.__local_day || '');
      if (ld) return ld === String(dayISO);
      const d = String(s?.date || '');
      const dayUS = dayISOToUS(dayISO);
      if (d === String(dayISO) || d === String(dayUS)) return true;
      // last resort: derive from timestamp
      const ts = s?.started_at || s?.createdAt || s?.created_at;
      if (!ts) return false;
      return localDayFromTs(ts) === String(dayISO);
    };

    // Map by stable key, preserve any richer local exercise details
    const map = new Map();
    for (const sess of (list || [])) {
      const cid = sess?.client_id || sess?.id;
      if (!cid) continue;
      map.set(String(cid), sess);
    }

    for (const r of (cloudWorkouts || [])) {
      const norm = normalizeWorkoutRow(r, dayISO);
      const key = String(norm.client_id || norm.id || '');
      if (!key) continue;

      const prev = map.get(key);
      if (!prev) {
        map.set(key, norm);
        continue;
      }

      // Merge: keep local "items/exercises" details if present; prefer cloud totals
      const merged = {
        ...prev,
        ...norm,
        items: (prev?.items && Array.isArray(prev.items) && prev.items.length > 0)
          ? prev.items
          : norm.items,
        __from_cloud: true,
      };
      map.set(key, merged);
    }

    // Rebuild list; preserve non-today history unchanged; replace/merge today's
    const mergedList = [];
    const used = new Set();

    for (const sess of (list || [])) {
      const cid = String(sess?.client_id || sess?.id || '');
      if (!cid) {
        mergedList.push(sess);
        continue;
      }

      // If it's today, take merged version if exists
      if (isSameDay(sess) && map.has(cid)) {
        mergedList.push(map.get(cid));
        used.add(cid);
      } else {
        mergedList.push(sess);
      }
    }

    // Add any new cloud sessions not already present
    for (const [cid, sess] of map.entries()) {
      if (used.has(cid)) continue;
      // only add cloud sessions that belong to today if not in list
      if (isSameDay(sess)) mergedList.push(sess);
    }

    // Sort newest first by started_at
    mergedList.sort((a, b) => {
      const ta = new Date(a?.started_at || a?.createdAt || a?.created_at || 0).getTime();
      const tb = new Date(b?.started_at || b?.createdAt || b?.created_at || 0).getTime();
      return tb - ta;
    });

    writeScopedJSON(KEYS.workoutHistory, userId, mergedList.slice(0, 300));

    try {
      window.dispatchEvent(new CustomEvent('slimcal:workoutHistory:update', { detail: { dayISO } }));
    } catch {}
  } catch (e) {
    console.warn('[hydrateCloudToLocal] mergeWorkoutsIntoLocalHistory failed', e);
  }
}

async function pullWorkoutsForDay(userId, dayISO) {
  if (!supabase || !userId) return [];
  try {
    const { data, error } = await supabase
      .from('workouts')
      .select('*')
      .eq('user_id', userId)
      .eq('local_day', dayISO)
      .order('started_at', { ascending: false });

    if (!error && Array.isArray(data)) return data;

    // local_day might not exist
    if (error && /column .*local_day.* does not exist/i.test(error.message || '')) {
      // fallback to started_at range
      const startLocal = safeLocalMidnight(dayISO);
      const nextLocal = new Date(startLocal.getTime() + 24 * 60 * 60 * 1000);

      const { data: d2, error: e2 } = await supabase
        .from('workouts')
        .select('*')
        .eq('user_id', userId)
        .gte('started_at', startLocal.toISOString())
        .lt('started_at', nextLocal.toISOString())
        .order('started_at', { ascending: false });

      if (!e2 && Array.isArray(d2)) return d2;
    }

    return [];
  } catch {
    return [];
  }
}

async function sumBurnedFromWorkouts(userId, dayISO) {
  if (!supabase || !userId) return 0;

  // ✅ Best: local_day equality (DATE) — avoids any started_at null / timezone drift
  try {
    const { data, error } = await supabase
      .from('workouts')
      .select('id,total_calories,local_day')
      .eq('user_id', userId)
      .eq('local_day', dayISO);

    if (!error) {
      return (data || []).reduce((s, w) => s + safeNum(w?.total_calories, 0), 0);
    }

    if (!/column .*local_day.* does not exist/i.test(error?.message || '')) {
      console.warn('[hydrateCloudToLocal] workouts local_day query failed', error);
    }
  } catch {}

  // ✅ Match meals logic: use a local-day timestamp range (started_at) instead of local_day.
  // This avoids drift and works even if workouts.local_day is missing or null.
  const startLocal = safeLocalMidnight(dayISO);
  const nextLocal = new Date(startLocal.getTime() + 24 * 60 * 60 * 1000);

  try {
    const { data, error } = await supabase
      .from('workouts')
      .select('id,total_calories,started_at')
      .eq('user_id', userId)
      .gte('started_at', startLocal.toISOString())
      .lt('started_at', nextLocal.toISOString());

    if (!error) {
      return (data || []).reduce((s, w) => s + safeNum(w?.total_calories, 0), 0);
    }
  } catch {}

  return 0;
}

async function sumEatenFromMeals(userId, dayISO) {
  if (!supabase || !userId) return 0;

  // preferred: meals table has local_day
  try {
    const { data, error } = await supabase
      .from('meals')
      .select('id,total_calories,local_day')
      .eq('user_id', userId)
      .eq('local_day', dayISO);

    if (!error) {
      return (data || []).reduce((s, m) => s + safeNum(m?.total_calories, 0), 0);
    }

    if (!/column .*local_day.* does not exist/i.test(error?.message || '')) {
      console.warn('[hydrateCloudToLocal] meals local_day query failed', error);
    }
  } catch {}

  // fallback: created_at range
  const startLocal = safeLocalMidnight(dayISO);
  const nextLocal = new Date(startLocal.getTime() + 24 * 60 * 60 * 1000);

  try {
    const { data, error } = await supabase
      .from('meals')
      .select('id,total_calories,created_at')
      .eq('user_id', userId)
      .gte('created_at', startLocal.toISOString())
      .lt('created_at', nextLocal.toISOString());

    if (!error) {
      return (data || []).reduce((s, m) => s + safeNum(m?.total_calories, 0), 0);
    }
  } catch {}

  return 0;
}

async function upsertDailyMetricsCloud(userId, dayISO, eaten, burned) {
  if (!supabase || !userId) return;

  // new schema: local_day
  try {
    const { error } = await supabase
      .from('daily_metrics')
      .upsert(
        {
          user_id: userId,
          local_day: dayISO,
          consumed: Math.round(safeNum(eaten, 0)),
          burned: Math.round(safeNum(burned, 0)),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,local_day' }
      );

    if (!error) return;
    if (!/column .*local_day.* does not exist/i.test(error?.message || '')) throw error;
  } catch (e) {
    // legacy schema: day
    try {
      await supabase
        .from('daily_metrics')
        .upsert(
          {
            user_id: userId,
            day: dayISO,
            calories_eaten: Math.round(safeNum(eaten, 0)),
            calories_burned: Math.round(safeNum(burned, 0)),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,day' }
        );
    } catch (e2) {
      console.warn('[hydrateCloudToLocal] upsertDailyMetricsCloud failed', e2);
    }
  }
}

export async function hydrateTodayTotalsFromCloud(user, { alsoDispatch = true } = {}) {
  const userId = (typeof user === "string") ? user : (user?.id || null);
  if (!userId || !supabase) return { ok: false, reason: 'no-user-or-supabase' };

  const dayISO = localDayISO(new Date());

  // Snapshot local cache so we don't clobber fresh local logs with stale cloud 0s.
  const prev = readPrevDailyCacheRow(userId, dayISO);

  let eaten = 0;
  let burned = 0;

  // 1) Read daily_metrics (new schema)
  try {
    const resNew = await supabase
      .from('daily_metrics')
      .select('*')
      .eq('user_id', userId)
      .eq('local_day', dayISO)
      .maybeSingle();

    if (!resNew?.error && resNew?.data) {
      const nums = readDailyMetricsNums(resNew.data);
      eaten = nums.eaten;
      burned = nums.burned;
    } else if (resNew?.error && /column .*local_day.* does not exist/i.test(resNew.error.message || '')) {
      // 2) Legacy schema fallback: day column
      const resOld = await supabase
        .from('daily_metrics')
        .select('*')
        .eq('user_id', userId)
        .eq('day', dayISO)
        .maybeSingle();

      if (!resOld?.error && resOld?.data) {
        const nums = readDailyMetricsNums(resOld.data);
        eaten = nums.eaten;
        burned = nums.burned;
      }
    }
  } catch (e) {
    console.warn('[hydrateCloudToLocal] daily_metrics read failed', e);
  }

  // 3) Always compute burned from today's workouts (prevents stale daily_metrics from leaking prior days)
  let burnedFromWorkouts = 0;
  try {
    burnedFromWorkouts = await sumBurnedFromWorkouts(userId, dayISO);
    if (burnedFromWorkouts >= 0) burned = burnedFromWorkouts;
  } catch {}

  // 3b) Always pull today's workouts into local workoutHistory so banner + in-page history
  // can show cross-device sessions without needing to visit /history.
  try {
    const cloudWorkouts = await pullWorkoutsForDay(userId, dayISO);
    if (Array.isArray(cloudWorkouts) && cloudWorkouts.length > 0) {
      mergeWorkoutsIntoLocalHistory(dayISO, cloudWorkouts, userId);

      // If daily_metrics burned was stale, the list is a strong fallback.
      const sumFromList = (cloudWorkouts || []).reduce((s, w) => s + safeNum(w?.total_calories, 0), 0);
      if (sumFromList > 0 && (!burned || burned <= 0)) {
        burned = sumFromList;
      }
    }
  } catch (e) {
    console.warn('[hydrateCloudToLocal] workoutHistory hydrate failed', e);
  }

  // 4) If eaten missing, sum meals (backup)
  if (!eaten || eaten <= 0) {
    const eatenFromMeals = await sumEatenFromMeals(userId, dayISO);
    if (eatenFromMeals > 0) eaten = eatenFromMeals;
  }

  // 5) Guard against cloud=0 when local has fresh evidence (queued writes / local history)
  try {
    const guarded = guardZeroFromCloud({ userId, dayISO, eaten, burned, prev });
    eaten = guarded.eaten;
    burned = guarded.burned;
  } catch {}

  // 5) Write local cache so the banner is correct on this device immediately
  writeDailyMetricsCache(dayISO, eaten, burned, userId);

  // Convenience keys used elsewhere
  try {
    localStorage.setItem(scopedKey('consumedToday', userId), String(Math.round(eaten || 0)));
    localStorage.setItem(scopedKey('burnedToday', userId), String(Math.round(burned || 0)));
  } catch {}

  // 6) Dispatch events so UI updates without refresh
  if (alsoDispatch) {
    dispatchTotals(dayISO, eaten, burned);
  }

  // 7) Repair Supabase daily_metrics (makes future loads perfect)
  try {
    // If we got better burned from workouts, sync it back
    if ((burnedFromWorkouts || 0) > 0) {
      await upsertDailyMetricsCloud(userId, dayISO, eaten, burned);
    }
  } catch (e) {
    console.warn('[hydrateCloudToLocal] repair upsert failed', e);
  }

  return { ok: true, dayISO, eaten, burned };
}

// This function is called elsewhere and is directly from useBootstrapSync; keep it exported.
// Signature matches hydrateTodayTotalsFromCloud(user, { alsoDispatch })
export async function hydrateTodayWorkoutsFromCloud(user, { alsoDispatch = true } = {}) {
  try {
    const userId = user?.id || user?.user?.id || null;
    if (!userId) return { ok: false, reason: 'no_user' };

    const dayISO = localDayISO(new Date());

    // Snapshot local cache so we don't clobber fresh local logs with stale cloud 0s.
    const prev = readPrevDailyCacheRow(userId, dayISO);

    const cloudWorkouts = await pullWorkoutsForDay(userId, dayISO);
    const list = Array.isArray(cloudWorkouts) ? cloudWorkouts : [];

    // Merge into local workoutHistory (preserve local exercise details if present)
    if (list.length > 0) {
      mergeWorkoutsIntoLocalHistory(dayISO, list, userId);
    } else {
      // still notify listeners (prevents stale UI)
      try {
        window.dispatchEvent(new CustomEvent('slimcal:workoutHistory:update', { detail: { dayISO } }));
      } catch {}
    }

    // Compute burned from cloud sessions for today
    let burned = list.reduce((s, w) => s + safeNum(w?.total_calories, 0), 0);

    // Guard against cloud=0 when local has evidence (queued writes / local history)
    try {
      const guarded = guardZeroFromCloud({ userId, dayISO, eaten: 0, burned, prev });
      burned = guarded.burned;
    } catch {}

    // Update convenience key
    try {
      localStorage.setItem(scopedKey('burnedToday', userId), String(Math.round(burned || 0)));
    } catch {}

    // Update dailyMetricsCache burned without clobbering consumed
    try {
      ensureScopedFromLegacy(KEYS.dailyMetricsCache, userId);
      const cache = readScopedJSON(KEYS.dailyMetricsCache, userId, {}) || {};
      const prevRow = cache[dayISO] || {};
      const consumed = safeNum(prevRow?.consumed ?? prevRow?.calories_eaten ?? prevRow?.eaten ?? 0, 0);
      cache[dayISO] = {
        ...prevRow,
        consumed,
        burned: Math.round(safeNum(burned, 0)),
        net: safeNum(consumed, 0) - safeNum(burned, 0),
        updated_at: new Date().toISOString()
      };
      writeScopedJSON(KEYS.dailyMetricsCache, userId, cache);
    } catch {}

    // Dispatch burned update (banner listens to this)
    if (alsoDispatch) {
      try {
        window.dispatchEvent(new CustomEvent('slimcal:burned:update', {
          detail: { date: dayISO, burned: Math.round(safeNum(burned, 0)) }
        }));
      } catch {}
    }

    return { ok: true, dayISO, burned };
  } catch (e) {
    console.warn('[hydrateCloudToLocal] hydrateTodayWorkoutsFromCloud failed', e);
    return { ok: false, error: String(e?.message || e) };
  }
}
