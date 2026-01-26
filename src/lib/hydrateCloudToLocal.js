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

  // This select ONLY uses columns we know exist now.
  // Avoids PostgREST 400 from selecting non-existent columns.
  const { data, error } = await supabase
    .from('workouts')
    .select('id,total_calories,local_day,started_at,created_at')
    .eq('user_id', userId)
    .eq('local_day', dayISO);

  if (error) {
    console.warn('[hydrateCloudToLocal] workouts query failed', error);
    return 0;
  }

  return (data || []).reduce((s, w) => s + safeNum(w.total_calories, 0), 0);
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


// ---------------- Meals hydration (cloud -> local) ----------------
function startOfLocalDayISO(d = new Date()) {
  const dt = new Date(d);
  const start = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0);
  return start.toISOString();
}
function endOfLocalDayISO(d = new Date()) {
  const dt = new Date(d);
  const end = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1, 0, 0, 0, 0);
  return end.toISOString();
}

function upsertTodayMealHistory(dayDisplay, mealsArr) {
  try {
    const key = 'mealHistory';
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    const list = Array.isArray(existing) ? existing : [];

    const others = list.filter(r => r?.date !== dayDisplay);

    const todayRec = {
      date: dayDisplay,
      meals: mealsArr,
    };

    localStorage.setItem(key, JSON.stringify([todayRec, ...others].slice(0, 60)));
  } catch {}
}

export async function hydrateTodayMealsFromCloud(user, { alsoDispatch = true } = {}) {
  const userId = user?.id || null;
  if (!userId) return { ok: false, reason: 'no-user' };

  const now = new Date();
  const dayISO = localDayISO(now);
  const dayDisplay = now.toLocaleDateString('en-US');

  // meals table has: user_id, eaten_at, title, total_calories, client_id, created_at, updated_at
  const startISO = startOfLocalDayISO(now);
  const endISO = endOfLocalDayISO(now);

  const { data, error } = await supabase
    .from('meals')
    .select('id,user_id,client_id,eaten_at,title,total_calories,created_at,updated_at')
    .eq('user_id', userId)
    .gte('eaten_at', startISO)
    .lt('eaten_at', endISO)
    .order('eaten_at', { ascending: false });

  if (error) {
    console.warn('[hydrateTodayMealsFromCloud] failed', error);
    return { ok: false, error };
  }

  const rows = Array.isArray(data) ? data : [];

  const mealsArr = rows.map(r => ({
    title: r?.title || 'Meal',
    calories: safeNum(r?.total_calories, 0),
    protein: 0,
    carbs: 0,
    fat: 0,
    createdAt: r?.eaten_at || r?.created_at || new Date().toISOString(),
    client_id: r?.client_id || null,
    cloud_id: r?.id || null,
  }));

  // Update local mealHistory so MealTracker on PC shows meals logged on mobile.
  upsertTodayMealHistory(dayDisplay, mealsArr);

  // Update dailyMetricsCache consumed for banner.
  const consumed = mealsArr.reduce((s, m) => s + safeNum(m?.calories, 0), 0);

  let burned = 0;
  try {
    const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
    const row = cache[dayISO] || {};
    burned = safeNum(row.burned, 0);
  } catch {}

  writeDailyMetricsCache(dayISO, consumed, burned);

  try {
    localStorage.setItem('consumedToday', String(Math.round(consumed)));
  } catch {}

  if (alsoDispatch) {
    try {
      window.dispatchEvent(
        new CustomEvent('slimcal:consumed:update', { detail: { date: dayISO, consumed: Math.round(consumed) } })
      );
    } catch {}
  }

  return { ok: true, dayISO, consumed, count: mealsArr.length };
}
