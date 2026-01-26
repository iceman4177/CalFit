// src/lib/hydrateCloudToLocal.js
// Pull "cloud truth" into local caches to make cross-device totals instant.
// This runs after login bootstrap (useBootstrapSync) and fixes the banner/PC sync.

import { supabase } from './supabaseClient';

// ---------------- Local-day helpers (avoid UTC drift) ----------------
// ---------------- Local-day helpers (avoid UTC drift) ----------------
function startOfLocalDay(d = new Date()) {
  const dt = new Date(d);
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(d = new Date()) {
  const dt = new Date(d);
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1, 0, 0, 0, 0);
}

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
    0;

  const burned =
    safeNum(row.calories_burned) ||
    safeNum(row.cals_burned) ||
    safeNum(row.burned) ||
    0;

  return { eaten, burned };
}

function writeDailyMetricsCache(dayISO, eaten, burned) {
  try {
    const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
    cache[dayISO] = {
      consumed: safeNum(eaten, 0), // ✅ canonical key used by banner
      burned: safeNum(burned, 0),
      net: safeNum(eaten, 0) - safeNum(burned, 0),
      updated_at: new Date().toISOString()
    };
    localStorage.setItem('dailyMetricsCache', JSON.stringify(cache));
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

// ✅ NEW: Burned should be computed via local_day (no timezone mismatch)
async function sumBurnedFromWorkouts(userId, dayISO) {
  if (!supabase || !userId) return 0;

  // Prefer reliable timestamp range on started_at (avoids schema drift on local_day).
  const now = new Date();
  const start = startOfLocalDay(now).toISOString();
  const end = endOfLocalDay(now).toISOString();

  // Try started_at range first
  try {
    const res1 = await supabase
      .from('workouts')
      .select('id,total_calories,started_at,created_at')
      .eq('user_id', userId)
      .gte('started_at', start)
      .lt('started_at', end);

    if (!res1?.error && res1?.data) {
      return (res1.data || []).reduce((s, w) => s + safeNum(w.total_calories, 0), 0);
    }

    // If started_at column missing, fall back to created_at
    if (res1?.error && /column .*started_at.* does not exist/i.test(res1.error.message || '')) {
      const res2 = await supabase
        .from('workouts')
        .select('id,total_calories,created_at')
        .eq('user_id', userId)
        .gte('created_at', start)
        .lt('created_at', end);

      if (!res2?.error && res2?.data) {
        return (res2.data || []).reduce((s, w) => s + safeNum(w.total_calories, 0), 0);
      }
    }

    // Legacy: if local_day exists, try it (safe select list)
    if (res1?.error && /column .*local_day.* does not exist/i.test(res1.error.message || '')) {
      // ignore
    }
  } catch (e) {
    console.warn('[hydrateCloudToLocal] workouts range query failed', e);
  }

  // Fallback: attempt local_day if present in schema (older deployments)
  try {
    const { data, error } = await supabase
      .from('workouts')
      .select('id,total_calories,local_day')
      .eq('user_id', userId)
      .eq('local_day', dayISO);

    if (error) {
      // If local_day doesn't exist, that's fine — we already tried the range method.
      return 0;
    }

    return (data || []).reduce((s, w) => s + safeNum(w.total_calories, 0), 0);
  } catch (e) {
    return 0;
  }
}

// Optional backup for eaten from meals table (if daily_metrics missing)
async function sumEatenFromMeals(userId, dayISO) {
  if (!supabase || !userId) return 0;

  // Meals query also should rely on local_day if you have it.
  // But if your meals table doesn't have local_day, fallback safely.
  let total = 0;

  // Attempt local_day first
  try {
    const res = await supabase
      .from('meals')
      .select('id,total_calories,local_day,eaten_at,created_at')
      .eq('user_id', userId)
      .eq('local_day', dayISO);

    if (!res?.error) {
      total = (res.data || []).reduce((s, m) => s + safeNum(m.total_calories, 0), 0);
      return total;
    }
  } catch {}

  // Fallback to eaten_at range (best effort)
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
 * - If burned missing/0, computes burned from workouts table (local_day ✅)
 * - Writes local cache (dailyMetricsCache) so NetCalorieBanner becomes cross-device
 * - Dispatches events so UI updates immediately
 * - Repairs Supabase daily_metrics so future loads are perfect
 */
export async function hydrateTodayTotalsFromCloud(user, { alsoDispatch = true } = {}) {
  const userId = user?.id || null;
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

  // 3) If burned missing, sum workouts from workouts.local_day ✅
  let burnedFromWorkouts = 0;
  if (!burned || burned <= 0) {
    burnedFromWorkouts = await sumBurnedFromWorkouts(userId, dayISO);
    if (burnedFromWorkouts > 0) burned = burnedFromWorkouts;
  }

  // 4) If eaten missing, sum meals (backup)
  if (!eaten || eaten <= 0) {
    const eatenFromMeals = await sumEatenFromMeals(userId, dayISO);
    if (eatenFromMeals > 0) eaten = eatenFromMeals;
  }

  // 5) Write local cache so the banner is correct on this device immediately
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
