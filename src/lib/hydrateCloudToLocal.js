// src/lib/hydrateCloudToLocal.js
// Pull "cloud truth" into local caches to make cross-device totals instant.
// This runs after login bootstrap (useBootstrapSync) and fixes the banner/PC sync.

import { supabase } from './supabaseClient';

// ---------------- Local-day helpers (avoid UTC drift) ----------------
function localDayISO(d = new Date()) {
  const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return ld.toISOString().slice(0, 10);
}

function boundsForLocalDayISO(dayISO) {
  // dayISO like "2026-01-24"
  const [y, m, d] = String(dayISO).split('-').map(Number);
  const startLocal = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  const nextDayStartLocal = new Date(y, (m || 1) - 1, (d || 1) + 1, 0, 0, 0, 0);

  return {
    startISO: startLocal.toISOString(),
    nextStartISO: nextDayStartLocal.toISOString()
  };
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
      // ✅ include both naming styles so banner always finds it
      eaten: safeNum(eaten, 0),
      consumed: safeNum(eaten, 0),
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
        detail: { date: dayISO, consumed: safeNum(eaten, 0) }
      })
    );
  } catch {}

  try {
    window.dispatchEvent(
      new CustomEvent('slimcal:burned:update', {
        detail: { date: dayISO, burned: safeNum(burned, 0) }
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

// Pull workouts for today and sum their calories
async function sumBurnedFromWorkouts(userId, dayISO) {
  if (!supabase || !userId) return 0;

  const { startISO, nextStartISO } = boundsForLocalDayISO(dayISO);

  // Primary query: started_at bounds
  const { data, error } = await supabase
    .from('workouts')
    .select('id, started_at, total_calories, totalCalories, calories_burned, kcal, created_at')
    .eq('user_id', userId)
    .gte('started_at', startISO)
    .lt('started_at', nextStartISO)
    .order('started_at', { ascending: false });

  // Fallback if schema doesn't have started_at
  if (error) {
    if (/column .*started_at.* does not exist/i.test(error.message || '')) {
      const fb = await supabase
        .from('workouts')
        .select('id, created_at, total_calories, totalCalories, calories_burned, kcal')
        .eq('user_id', userId)
        .gte('created_at', startISO)
        .lt('created_at', nextStartISO)
        .order('created_at', { ascending: false });

      if (fb.error) {
        console.warn('[hydrateCloudToLocal] workout fallback query failed', fb.error);
        return 0;
      }

      return (fb.data || []).reduce((s, w) => {
        const kcal =
          safeNum(w.total_calories) ||
          safeNum(w.totalCalories) ||
          safeNum(w.calories_burned) ||
          safeNum(w.kcal) ||
          0;
        return s + kcal;
      }, 0);
    }

    console.warn('[hydrateCloudToLocal] workouts query failed', error);
    return 0;
  }

  return (data || []).reduce((s, w) => {
    const kcal =
      safeNum(w.total_calories) ||
      safeNum(w.totalCalories) ||
      safeNum(w.calories_burned) ||
      safeNum(w.kcal) ||
      0;
    return s + kcal;
  }, 0);
}

// Pull meals for today and sum calories (optional fallback for eaten)
async function sumEatenFromMeals(userId, dayISO) {
  if (!supabase || !userId) return 0;

  const { startISO, nextStartISO } = boundsForLocalDayISO(dayISO);

  const { data, error } = await supabase
    .from('meals')
    .select('id, eaten_at, total_calories, created_at')
    .eq('user_id', userId)
    .gte('eaten_at', startISO)
    .lt('eaten_at', nextStartISO)
    .order('eaten_at', { ascending: false });

  if (error) {
    if (/column .*eaten_at.* does not exist/i.test(error.message || '')) {
      const fb = await supabase
        .from('meals')
        .select('id, created_at, total_calories')
        .eq('user_id', userId)
        .gte('created_at', startISO)
        .lt('created_at', nextStartISO)
        .order('created_at', { ascending: false });

      if (fb.error) {
        console.warn('[hydrateCloudToLocal] meals fallback query failed', fb.error);
        return 0;
      }

      return (fb.data || []).reduce((s, m) => s + safeNum(m.total_calories, 0), 0);
    }

    console.warn('[hydrateCloudToLocal] meals query failed', error);
    return 0;
  }

  return (data || []).reduce((s, m) => s + safeNum(m.total_calories, 0), 0);
}

/**
 * hydrateTodayTotalsFromCloud
 * - Reads daily_metrics if available
 * - If burned missing/0, computes burned from workouts table
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

  // 1) Try daily_metrics new schema
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
    } else if (
      resNew?.error &&
      /column .*local_day.* does not exist/i.test(resNew.error.message || '')
    ) {
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

  // 3) If burned is missing, compute from workouts table
  let burnedFromWorkouts = 0;
  if (!burned || burned <= 0) {
    burnedFromWorkouts = await sumBurnedFromWorkouts(userId, dayISO);
    if (burnedFromWorkouts > 0) burned = burnedFromWorkouts;
  }

  // 4) If eaten missing, compute from meals table (backup)
  if (!eaten || eaten <= 0) {
    const eatenFromMeals = await sumEatenFromMeals(userId, dayISO);
    if (eatenFromMeals > 0) eaten = eatenFromMeals;
  }

  // 5) Write local cache so the banner is correct on this device immediately
  writeDailyMetricsCache(dayISO, eaten, burned);

  // optional: convenience keys (some parts of app still use these)
  try {
    localStorage.setItem('consumedToday', String(Math.round(eaten || 0)));
    localStorage.setItem('burnedToday', String(Math.round(burned || 0)));
  } catch {}

  // 6) Dispatch events so UI updates without refresh
  if (alsoDispatch) {
    dispatchTotals(dayISO, eaten, burned);
  }

  // 7) Repair Supabase daily_metrics (important for future loads + consistency)
  try {
    // repair whenever we have *any* signal, not only workouts
    await upsertDailyMetricsCloud(userId, dayISO, eaten, burned);
  } catch (e) {
    console.warn('[hydrateCloudToLocal] repair upsert failed', e);
  }

  return { ok: true, dayISO, eaten, burned };
}
