// src/lib/hydrateCloudToLocal.js
// Pull "cloud truth" into local caches to make cross-device totals instant.
// This runs after login bootstrap (useBootstrapSync) and fixes the banner/PC sync.

import { supabase } from './supabaseClient';

// ---------------- Local-day helpers (avoid UTC drift) ----------------
function localDayISO(d = new Date()) {
  const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return ld.toISOString().slice(0, 10);
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
    safeNum(row.caloriesEaten) ||
    0;

  const burned =
    safeNum(row.calories_burned) ||
    safeNum(row.cals_burned) ||
    safeNum(row.burned) ||
    safeNum(row.caloriesBurned) ||
    0;

  return {
    eaten: Math.round(eaten),
    burned: Math.round(burned),
  };
}

function getUserId(user) {
  if (!user) return null;
  if (typeof user === 'string') return user;
  return user?.id || user?.user_id || null;
}

function writeDailyMetricsCache(dayISO, eaten, burned) {
  try {
    const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
    const prev = cache[dayISO] || {};
    cache[dayISO] = {
      ...prev,
      consumed: Math.round(eaten || 0),
      burned: Math.round(burned || 0),
      updated_at: new Date().toISOString(),
    };
    localStorage.setItem('dailyMetricsCache', JSON.stringify(cache));
  } catch {}
}

function readDailyMetricsCache(dayISO) {
  try {
    const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
    return cache[dayISO] || {};
  } catch {
    return {};
  }
}

function dispatchTotals(dayISO, eaten, burned) {
  try {
    window.dispatchEvent(
      new CustomEvent('slimcal:consumed:update', {
        detail: { date: dayISO, consumed: Math.round(eaten || 0) },
      })
    );
  } catch {}
  try {
    window.dispatchEvent(
      new CustomEvent('slimcal:burned:update', {
        detail: { date: dayISO, burned: Math.round(burned || 0) },
      })
    );
  } catch {}
}

// ---------------- Supabase helpers ----------------
async function fetchDailyMetricsRow(userId, dayISO) {
  try {
    const { data, error } = await supabase
      .from('daily_metrics')
      .select('user_id, local_day, calories_eaten, calories_burned, updated_at')
      .eq('user_id', userId)
      .eq('local_day', dayISO)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  } catch (e) {
    console.warn('[hydrateCloudToLocal] daily_metrics fetch failed', e);
    return null;
  }
}

async function upsertDailyMetricsCloud(userId, dayISO, eaten, burned) {
  try {
    const payload = {
      user_id: userId,
      local_day: dayISO,
      calories_eaten: Math.round(eaten || 0),
      calories_burned: Math.round(burned || 0),
      net_calories: Math.round((eaten || 0) - (burned || 0)),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('daily_metrics').upsert(payload, {
      onConflict: 'user_id,local_day',
      returning: 'minimal',
    });
    if (error) throw error;
    return true;
  } catch (e) {
    throw e;
  }
}

// ---------------- Workouts fallback (truthy burned) ----------------
async function computeBurnedFromWorkouts(userId, dayISO) {
  // Use started_at time range so it matches local day drift and works even if workouts.local_day is missing or null.
  const startLocal = new Date(`${dayISO}T00:00:00`);
  const nextLocal = new Date(startLocal.getTime() + 24 * 60 * 60 * 1000);

  // Attempt started_at range first (most accurate)
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
  } catch {}

  // Fallback: last 24h by created_at (less accurate but better than 0)
  try {
    const { data, error } = await supabase
      .from('workouts')
      .select('id,total_calories,created_at')
      .eq('user_id', userId)
      .gte('created_at', startLocal.toISOString())
      .lt('created_at', nextLocal.toISOString());

    if (!error) {
      return (data || []).reduce((s, w) => s + safeNum(w?.total_calories, 0), 0);
    }
  } catch {}

  return 0;
}

/**
 * ✅ hydrateTodayTotalsFromCloud(user, { alsoDispatch })
 *
 * Authoritative summary source is daily_metrics, BUT:
 * - daily_metrics can be stale for a few seconds/minutes during device drift
 * - if it returns 0 burned while workouts exist, the banner flickers / stays 0
 *
 * Fix:
 * - merge daily_metrics with local cache
 * - if burned is 0 but workouts exist today, compute burned from workouts table and use it
 * - write local cache + dispatch UI events
 */
export async function hydrateTodayTotalsFromCloud(user, { alsoDispatch = true } = {}) {
  const userId = getUserId(user);
  if (!userId) return { ok: false, reason: 'no-user' };

  const dayISO = localDayISO(new Date());

  // 1) read local cache first (avoid overwriting with 0)
  const local = readDailyMetricsCache(dayISO);
  const localNums = readDailyMetricsNums(local);

  // 2) fetch cloud daily_metrics
  const cloudRow = await fetchDailyMetricsRow(userId, dayISO);
  const cloudNums = readDailyMetricsNums(cloudRow);

  // 3) merge eaten/burned with "never clobber non-zero local with zero cloud"
  let eaten = localNums.eaten;
  let burned = localNums.burned;

  // Prefer cloud if it has real values
  if (cloudNums.eaten > 0 || eaten === 0) eaten = cloudNums.eaten;
  if (cloudNums.burned > 0 || burned === 0) burned = cloudNums.burned;

  // 4) if burned still 0, compute from workouts to prevent stuck-at-0
  let burnedFromWorkouts = 0;
  if ((burned || 0) === 0) {
    try {
      burnedFromWorkouts = await computeBurnedFromWorkouts(userId, dayISO);
      if (burnedFromWorkouts > 0) burned = Math.round(burnedFromWorkouts);
    } catch {}
  }

  // 5) Write local cache so banner is correct on this device immediately
  writeDailyMetricsCache(dayISO, eaten, burned);

  // Convenience keys used elsewhere
  try {
    localStorage.setItem('consumedToday', String(Math.round(eaten || 0)));
    localStorage.setItem('burnedToday', String(Math.round(burned || 0)));
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

// ---------------- Workouts hydration (meal-style) ----------------
// Hydrates today's workouts into localStorage.workoutHistory so the Net Banner
// can show burned calories immediately without needing to visit Workout History.
export async function hydrateTodayWorkoutsFromCloud(user, { alsoDispatch = true } = {}) {
  try {
    const userId = typeof user === 'string' ? user : (user?.id || user?.user_id || null);
    if (!userId) return { ok: false, reason: 'no-user' };

    const now = new Date();
    const dayISO = localDayISO(now);
    const dayDisplay = now.toLocaleDateString('en-US');

    const startLocal = new Date(`${dayISO}T00:00:00`);
    const nextLocal = new Date(startLocal.getTime() + 24 * 60 * 60 * 1000);

    const { data: rows, error } = await supabase
      .from('workouts')
      .select('client_id,total_calories,started_at,created_at,updated_at')
      .eq('user_id', userId)
      .gte('started_at', startLocal.toISOString())
      .lt('started_at', nextLocal.toISOString())
      .order('started_at', { ascending: false });

    if (error) {
      console.warn('[hydrateTodayWorkoutsFromCloud] error', error);
      return { ok: false, error };
    }

    const workouts = Array.isArray(rows) ? rows : [];
    const burnedToday = Math.round(
      workouts.reduce((s, w) => s + safeNum(w?.total_calories, 0), 0)
    );

    // Merge into local workoutHistory while preserving any detailed sessions already stored
    try {
      const key = 'workoutHistory';
      const existing = JSON.parse(localStorage.getItem(key) || '[]');
      const list = Array.isArray(existing) ? existing : [];

      const isToday = (sess) => sess?.date === dayDisplay;
      const others = list.filter((s) => !isToday(s));
      const todaysLocal = list.filter((s) => isToday(s));

      const byCid = new Map();
      for (const s of todaysLocal) {
        const cid = s?.client_id || s?.id || null;
        if (cid) byCid.set(String(cid), s);
      }

      const todaysMerged = workouts.map((w) => {
        const cid = String(w?.client_id || '');
        const prev = byCid.get(cid);

        // Preserve exercises/notes if they exist locally
        const keepExercises =
          prev && Array.isArray(prev.exercises) && prev.exercises.length > 0;

        return {
          ...(prev || {}),
          id: prev?.id || w?.client_id || cid,
          client_id: prev?.client_id || w?.client_id || cid,
          date: dayDisplay,
          name: prev?.name || 'Workout',
          totalCalories: safeNum(w?.total_calories, prev?.totalCalories || 0),
          exercises: keepExercises ? prev.exercises : (prev?.exercises || []),
          createdAt: w?.started_at || w?.created_at || prev?.createdAt || new Date().toISOString(),
          uploaded: true,
          __draft: false,
        };
      });

      // If there were local sessions today that don't exist in cloud (drafts), keep them too
      const cloudCids = new Set(workouts.map((w) => String(w?.client_id || '')));
      const keepDrafts = todaysLocal.filter((s) => {
        const cid = String(s?.client_id || s?.id || '');
        return cid && !cloudCids.has(cid) && (s?.__draft || false);
      });

      const next = [...todaysMerged, ...keepDrafts, ...others].slice(0, 300);
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}

    // Merge burned into dailyMetricsCache WITHOUT touching consumed
    try {
      const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
      const prev = cache[dayISO] || {};
      cache[dayISO] = {
        ...prev,
        burned: Math.max(safeNum(prev?.burned, 0), burnedToday),
        updated_at: new Date().toISOString(),
      };
      localStorage.setItem('dailyMetricsCache', JSON.stringify(cache));
    } catch {}

    try {
      localStorage.setItem('burnedToday', String(burnedToday));
    } catch {}

    if (alsoDispatch) {
      try {
        window.dispatchEvent(
          new CustomEvent('slimcal:burned:update', { detail: { date: dayISO, burned: burnedToday } })
        );
      } catch {}
    }

    return { ok: true, dayISO, count: workouts.length, burnedToday };
  } catch (e) {
    console.warn('[hydrateTodayWorkoutsFromCloud] failed', e);
    return { ok: false, error: e };
  }
}
