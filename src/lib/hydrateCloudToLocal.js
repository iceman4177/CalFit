// src/lib/hydrateCloudToLocal.js
// Pull "cloud truth" into local caches to make cross-device totals instant.
// This runs after login bootstrap (useBootstrapSync) and fixes the banner/PC sync.

import { supabase } from './supabaseClient';
import { ensureScopedFromLegacy, readScopedJSON, writeScopedJSON, scopedKey, KEYS } from './scopedStorage.js';

// Pending ops queue key (used by local-first sync)
const OPS_KEY = 'slimcal:pendingOps:v1';

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

function hasPendingOpsForUser(userId) {
  try {
    const raw = localStorage.getItem(OPS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list) || !list.length) return false;
    return list.some(op => String(op?.user_id || op?.userId || '') === String(userId));
  } catch {
    return false;
  }
}

function dayISOToUS(dayISO) {
  try {
    // Construct local midnight for that day, then format in US locale.
    const d = safeLocalMidnight(dayISO);
    return d.toLocaleDateString('en-US');
  } catch {
    return dayISO;
  }
}

function sumLocalWorkoutsBurned(userId, dayISO) {
  try {
    ensureScopedFromLegacy(KEYS.workoutHistory, userId);
    const list = readScopedJSON(KEYS.workoutHistory, userId, []) || [];
    const dayUS = dayISOToUS(dayISO);
    return (Array.isArray(list) ? list : [])
      .filter(w => String(w?.local_day || w?.__local_day || '') === String(dayISO) || String(w?.date || '') === String(dayUS) || String(w?.date || '') === String(dayISO))
      .reduce((s, w) => s + safeNum(w?.totalCalories ?? w?.total_calories, 0), 0);
  } catch {
    return 0;
  }
}

function sumLocalMealsEaten(userId, dayISO) {
  try {
    ensureScopedFromLegacy(KEYS.mealHistory, userId);
    const hist = readScopedJSON(KEYS.mealHistory, userId, []) || [];
    const dayUS = dayISOToUS(dayISO);
    const rec = (Array.isArray(hist) ? hist : []).find(r => String(r?.date || '') === String(dayUS) || String(r?.date || '') === String(dayISO));
    const meals = rec?.meals || [];
    return (Array.isArray(meals) ? meals : []).reduce((s, m) => s + safeNum(m?.calories, 0), 0);
  } catch {
    return 0;
  }
}

// ---------------- Workouts → local workoutHistory (for banner + on-page history) ----------------
function localDayFromTs(ts) {
  try {
    const d = new Date(ts);
    return localDayISO(d);
  } catch {
    return localDayISO(new Date());
  }
}

function normalizeWorkoutForLocal(w) {
  const startedAt = w?.started_at || w?.created_at || w?.createdAt || new Date().toISOString();
  const endedAt = w?.ended_at || startedAt;
  const dayISO = w?.local_day || w?.__local_day || localDayFromTs(startedAt);
  const dayUS = dayISOToUS(dayISO);

  // Use client_id if present (stable cross-device). Fall back to id.
  const cid = w?.client_id || w?.id || `cloud_${String(startedAt)}_${String(w?.total_calories || '')}`;

  const total = safeNum(w?.total_calories ?? w?.totalCalories, 0);

  return {
    id: cid,
    client_id: cid,
    // Keep both for compatibility with older code paths
    local_day: dayISO,
    __local_day: dayISO,
    date: dayUS,
    started_at: startedAt,
    ended_at: endedAt,
    createdAt: startedAt,
    totalCalories: total,
    total_calories: total,
    name: w?.name || 'Workout',
    exercises: (Array.isArray(w?.exercises) ? w.exercises : (Array.isArray(w?.items) ? w.items : (Array.isArray(w?.items?.exercises) ? w.items.exercises : []))),
    uploaded: true,
    __cloud: true
  };
}

function mergeWorkoutsIntoLocalHistory(dayISO, cloudWorkouts, userId) {
  try {
    ensureScopedFromLegacy(KEYS.workoutHistory, userId);
    const list = readScopedJSON(KEYS.workoutHistory, userId, []) || [];

    // Map by stable key, preserve any richer local exercise details
    const map = new Map();
    for (const sess of (list || [])) {
      const cid = sess?.client_id || sess?.id;
      if (!cid) continue;
      const fixed = (sess?.local_day || sess?.__local_day) ? sess : { ...sess, local_day: localDayFromTs(sess?.started_at || sess?.createdAt || sess?.created_at), __local_day: localDayFromTs(sess?.started_at || sess?.createdAt || sess?.created_at) };
      map.set(String(cid), fixed);
    }

    for (const w of (cloudWorkouts || [])) {
      const norm = normalizeWorkoutForLocal(w);
      const cid = String(norm.client_id || norm.id);
      const existing = map.get(cid);

      if (existing) {
        const keepExercises = Array.isArray(existing?.exercises) && existing.exercises.length > 0;
        const keepName = !!existing?.name && existing.name !== 'Workout';
        map.set(cid, {
          ...norm,
          ...existing,
          exercises: keepExercises ? existing.exercises : norm.exercises,
          name: keepName ? existing.name : norm.name,
          totalCalories: safeNum(existing?.totalCalories ?? existing?.total_calories, norm.totalCalories),
          total_calories: safeNum(existing?.total_calories ?? existing?.totalCalories, norm.total_calories),
          local_day: existing?.local_day || existing?.__local_day || norm.local_day,
          __local_day: existing?.__local_day || existing?.local_day || norm.__local_day,
          date: existing?.date || norm.date
        });
      } else {
        map.set(cid, norm);
      }
    }

    const merged = Array.from(map.values());

    // Sort by started/created desc
    merged.sort((a, b) => {
      const ta = new Date(a?.started_at || a?.createdAt || a?.created_at || 0).getTime();
      const tb = new Date(b?.started_at || b?.createdAt || b?.created_at || 0).getTime();
      return tb - ta;
    });

    writeScopedJSON(KEYS.workoutHistory, userId, merged.slice(0, 300));

    try {
      window.dispatchEvent(new CustomEvent('slimcal:workoutHistory:update', { detail: { dayISO } }));
    } catch {}
  } catch (e) {
    console.warn('[hydrateCloudToLocal] mergeWorkoutsIntoLocalHistory failed', e);
  }
}

async function pullWorkoutsForDay(userId, dayISO) {
  if (!supabase || !userId) return [];

  // ✅ Best: local_day equality (your workouts.local_day is a DATE)
  try {
    const res0 = await supabase
      .from('workouts')
      .select('id,client_id,total_calories,started_at,ended_at,created_at,local_day')
      .eq('user_id', userId)
      .eq('local_day', dayISO);

    if (!res0?.error && Array.isArray(res0?.data) && res0.data.length > 0) {
      return res0.data;
    }

    // If local_day isn't a column, fall through to timestamp range below
    if (res0?.error && /column .*local_day.* does not exist/i.test(res0.error?.message || '')) {
      // continue
    }
  } catch {}

  const startLocal = safeLocalMidnight(dayISO);
  const nextLocal = new Date(startLocal.getTime() + 24 * 60 * 60 * 1000);

  // Prefer started_at range (same as meals hydration)
  try {
    const res = await supabase
      .from('workouts')
      .select('id,client_id,total_calories,items,started_at,ended_at,created_at')
      .eq('user_id', userId)
      .gte('started_at', startLocal.toISOString())
      .lt('started_at', nextLocal.toISOString());

    if (!res?.error) return Array.isArray(res?.data) ? res.data : [];

    // If started_at is missing, fall through to created_at range
    if (!/column .*started_at.* does not exist/i.test(res.error?.message || '')) {
      console.warn('[hydrateCloudToLocal] workouts pull (started_at) failed', res.error);
    }
  } catch {}

  // Fallback: created_at range
  try {
    const res2 = await supabase
      .from('workouts')
      .select('id,client_id,total_calories,items,created_at')
      .eq('user_id', userId)
      .gte('created_at', startLocal.toISOString())
      .lt('created_at', nextLocal.toISOString());

    if (res2?.error) {
      console.warn('[hydrateCloudToLocal] workouts pull (created_at) failed', res2.error);
      return [];
    }
    return Array.isArray(res2?.data) ? res2.data : [];
  } catch {
    return [];
  }
}

// Try to upsert daily_metrics in Supabase (new schema first, legacy fallback)
async function upsertDailyMetricsCloud(userId, dayISO, eaten, burned) {
  if (!supabase || !userId) return;

  const rowNew = {
    user_id: userId,
    local_day: dayISO,
    calories_eaten: safeNum(eaten, 0),
    calories_burned: safeNum(burned, 0),
    net_calories: safeNum(eaten, 0) - safeNum(burned, 0),
    updated_at: new Date().toISOString()
  };

  // New schema attempt
  const res = await supabase
    .from('daily_metrics')
    .upsert(rowNew, { onConflict: 'user_id,local_day' })
    .select()
    .maybeSingle();

  if (!res?.error) return;

  // Legacy fallback if new columns missing
  if (/column .* does not exist/i.test(res.error?.message || '')) {
    const legacy = {
      user_id: userId,
      day: dayISO,
      cals_eaten: safeNum(eaten, 0),
      cals_burned: safeNum(burned, 0),
      net_cals: safeNum(eaten, 0) - safeNum(burned, 0),
      updated_at: new Date().toISOString()
    };

    const res2 = await supabase
      .from('daily_metrics')
      .upsert(legacy, { onConflict: 'user_id,day' })
      .select()
      .maybeSingle();

    if (res2?.error) {
      console.warn('[hydrateCloudToLocal] daily_metrics legacy upsert failed', res2.error);
    }
    return;
  }

  console.warn('[hydrateCloudToLocal] daily_metrics upsert failed', res.error);
}

// ✅ Burned should be computed via local_day (no timezone mismatch)
async function sumBurnedFromWorkouts(userId, dayISO) {
  if (!supabase || !userId) return 0;

  // ✅ Best: local_day equality (DATE)
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

  // Fallback: started_at local-day range
  const startLocal = safeLocalMidnight(dayISO);
  const nextLocal = new Date(startLocal.getTime() + 24 * 60 * 60 * 1000);

  try {
    const { data, error } = await supabase
      .from('workouts')
      .select('id,total_calories,started_at,created_at')
      .eq('user_id', userId)
      .gte('started_at', startLocal.toISOString())
      .lt('started_at', nextLocal.toISOString());

    if (!error) {
      return (data || []).reduce((s, w) => s + safeNum(w?.total_calories, 0), 0);
    }

    if (/column .*started_at.* does not exist/i.test(error?.message || '')) {
      // continue to created_at fallback
    } else {
      console.warn('[hydrateCloudToLocal] workouts started_at query failed', error);
    }
  } catch {}

  // Fallback: created_at range
  try {
    const { data, error } = await supabase
      .from('workouts')
      .select('id,total_calories,created_at')
      .eq('user_id', userId)
      .gte('created_at', startLocal.toISOString())
      .lt('created_at', nextLocal.toISOString());

    if (error) {
      console.warn('[hydrateCloudToLocal] workouts created_at query failed', error);
      return 0;
    }

    return (data || []).reduce((s, w) => s + safeNum(w?.total_calories, 0), 0);
  } catch (e) {
    console.warn('[hydrateCloudToLocal] workouts fallback failed', e);
    return 0;
  }
}

// Optional backup for eaten from meals table (if daily_metrics missing)
async function sumEatenFromMeals(userId, dayISO) {
  if (!supabase || !userId) return 0;

  // Attempt local_day first
  try {
    const res = await supabase
      .from('meals')
      .select('id,total_calories,local_day,eaten_at,created_at')
      .eq('user_id', userId)
      .eq('local_day', dayISO);

    if (!res?.error) {
      return (res.data || []).reduce((s, m) => s + safeNum(m.total_calories, 0), 0);
    }
  } catch {}

  // Fallback to eaten_at range
  try {
    const startLocal = new Date(`${dayISO}T00:00:00`);
    const nextLocal = new Date(startLocal.getTime() + 24 * 60 * 60 * 1000);

    const res2 = await supabase
      .from('meals')
      .select('id,total_calories,eaten_at,created_at')
      .eq('user_id', userId)
      .gte('eaten_at', startLocal.toISOString())
      .lt('eaten_at', nextLocal.toISOString());

    if (res2?.error) {
      console.warn('[hydrateCloudToLocal] meals fallback query failed', res2.error);
      return 0;
    }

    return (res2.data || []).reduce((s, m) => s + safeNum(m.total_calories, 0), 0);
  } catch (e) {
    console.warn('[hydrateCloudToLocal] meals fallback failed', e);
    return 0;
  }
}

/**
 * hydrateTodayTotalsFromCloud
 * - Reads daily_metrics if available
 * - Always computes burned from workouts table (local_day ✅)
 * - Writes local cache (dailyMetricsCache) so NetCalorieBanner becomes cross-device
 * - Dispatches events so UI updates immediately
 * - Repairs Supabase daily_metrics so future loads are perfect
 */
export async function hydrateTodayTotalsFromCloud(user, { alsoDispatch = true } = {}) {
  const userId = (typeof user === "string") ? user : (user?.id || null);
  if (!userId || !supabase) return { ok: false, reason: 'no-user-or-supabase' };

  const dayISO = localDayISO(new Date());

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

  // 2) Always compute burned from workouts
  let burnedFromWorkouts = 0;
  try {
    burnedFromWorkouts = await sumBurnedFromWorkouts(userId, dayISO);
    if (burnedFromWorkouts >= 0) burned = burnedFromWorkouts;
  } catch {}

  // 3) Pull today's workouts into local workoutHistory
  try {
    const cloudWorkouts = await pullWorkoutsForDay(userId, dayISO);
    if (Array.isArray(cloudWorkouts) && cloudWorkouts.length > 0) {
      mergeWorkoutsIntoLocalHistory(dayISO, cloudWorkouts, userId);

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

  // ✅ Anti-clobber: never overwrite non-zero local totals with transient cloud zeros.
  try {
    ensureScopedFromLegacy(KEYS.dailyMetricsCache, userId);
    const cachePrev = readScopedJSON(KEYS.dailyMetricsCache, userId, {}) || {};
    const prevRow = cachePrev[dayISO] || {};
    const prevConsumed = safeNum(prevRow?.consumed ?? prevRow?.calories_eaten ?? prevRow?.eaten ?? 0, 0);
    const prevBurned = safeNum(prevRow?.burned ?? prevRow?.calories_burned ?? prevRow?.cals_burned ?? 0, 0);

    const localMealsSum = sumLocalMealsEaten(userId, dayISO);
    const localWorkoutsSum = sumLocalWorkoutsBurned(userId, dayISO);

    const pending = hasPendingOpsForUser(userId);

    if ((eaten == null || eaten <= 0) && (prevConsumed > 0 || localMealsSum > 0)) {
      eaten = localMealsSum > 0 ? localMealsSum : prevConsumed;
    }

    if ((burned == null || burned <= 0) && (prevBurned > 0 || localWorkoutsSum > 0)) {
      burned = localWorkoutsSum > 0 ? localWorkoutsSum : prevBurned;
    }

    if (pending) {
      if ((eaten == null || eaten <= 0) && prevConsumed > 0) eaten = prevConsumed;
      if ((burned == null || burned <= 0) && prevBurned > 0) burned = prevBurned;
    }
  } catch {}

  // 5) Write local cache
  writeDailyMetricsCache(dayISO, eaten, burned, userId);

  try {
    localStorage.setItem(scopedKey('consumedToday', userId), String(Math.round(eaten || 0)));
    localStorage.setItem(scopedKey('burnedToday', userId), String(Math.round(burned || 0)));
  } catch {}

  // 6) Dispatch events
  if (alsoDispatch) {
    dispatchTotals(dayISO, eaten, burned);
  }

  // 7) Repair Supabase daily_metrics
  try {
    if ((burnedFromWorkouts || 0) > 0) {
      await upsertDailyMetricsCloud(userId, dayISO, eaten, burned);
    }
  } catch (e) {
    console.warn('[hydrateCloudToLocal] repair upsert failed', e);
  }

  return { ok: true, dayISO, eaten, burned };
}

// Extra: hydrate ONLY workouts into local workoutHistory + burned totals
export async function hydrateTodayWorkoutsFromCloud(user, { alsoDispatch = true } = {}) {
  try {
    const userId = user?.id || user?.user?.id || null;
    if (!userId) return { ok: false, reason: 'no_user' };

    const dayISO = localDayISO(new Date());

    const cloudWorkouts = await pullWorkoutsForDay(userId, dayISO);
    const list = Array.isArray(cloudWorkouts) ? cloudWorkouts : [];

    if (list.length > 0) {
      mergeWorkoutsIntoLocalHistory(dayISO, list, userId);
    } else {
      try {
        window.dispatchEvent(new CustomEvent('slimcal:workoutHistory:update', { detail: { dayISO } }));
      } catch {}
    }

    const burned = list.reduce((s, w) => s + safeNum(w?.total_calories, 0), 0);

    try {
      localStorage.setItem(scopedKey('burnedToday', userId), String(Math.round(burned || 0)));
    } catch {}

    try {
      ensureScopedFromLegacy(KEYS.dailyMetricsCache, userId);
      const cache = readScopedJSON(KEYS.dailyMetricsCache, userId, {}) || {};
      const prev = cache[dayISO] || {};
      const consumed = safeNum(prev?.consumed ?? prev?.calories_eaten ?? prev?.eaten ?? 0, 0);
      cache[dayISO] = {
        ...prev,
        consumed,
        burned: Math.round(safeNum(burned, 0)),
        net: safeNum(consumed, 0) - safeNum(burned, 0),
        updated_at: new Date().toISOString()
      };
      writeScopedJSON(KEYS.dailyMetricsCache, userId, cache);
    } catch {}

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
