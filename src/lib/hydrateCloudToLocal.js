// src/lib/hydrateCloudToLocal.js
import { supabase } from './supabaseClient';

function localDayISO(d = new Date()) {
  const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return ld.toISOString().slice(0, 10);
}

function boundsForLocalDayISO(dayISO) {
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
      // ✅ include BOTH styles so everything works everywhere
      eaten: safeNum(eaten, 0),
      consumed: safeNum(eaten, 0),
      calories_eaten: safeNum(eaten, 0),

      burned: safeNum(burned, 0),
      calories_burned: safeNum(burned, 0),

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

  const res = await supabase
    .from('daily_metrics')
    .upsert(rowNew, { onConflict: 'user_id,local_day' })
    .select()
    .maybeSingle();

  if (!res?.error) return;

  // legacy fallback
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
  } else {
    console.warn('[hydrateCloudToLocal] daily_metrics upsert failed', res.error);
  }
}

async function sumBurnedFromWorkouts(userId, dayISO) {
  if (!supabase || !userId) return 0;

  const { startISO, nextStartISO } = boundsForLocalDayISO(dayISO);

  // started_at query first
  const { data, error } = await supabase
    .from('workouts')
    .select('id, started_at, total_calories, created_at')
    .eq('user_id', userId)
    .gte('started_at', startISO)
    .lt('started_at', nextStartISO)
    .order('started_at', { ascending: false });

  if (error) {
    // fallback: created_at if started_at not present
    if (/column .*started_at.* does not exist/i.test(error.message || '')) {
      const fb = await supabase
        .from('workouts')
        .select('id, created_at, total_calories')
        .eq('user_id', userId)
        .gte('created_at', startISO)
        .lt('created_at', nextStartISO)
        .order('created_at', { ascending: false });

      if (fb.error) {
        console.warn('[hydrateCloudToLocal] workout fallback query failed', fb.error);
        return 0;
      }

      return (fb.data || []).reduce((s, w) => s + safeNum(w.total_calories, 0), 0);
    }

    console.warn('[hydrateCloudToLocal] workouts query failed', error);
    return 0;
  }

  return (data || []).reduce((s, w) => s + safeNum(w.total_calories, 0), 0);
}

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

export async function hydrateTodayTotalsFromCloud(user, { alsoDispatch = true } = {}) {
  const userId = user?.id || null;
  if (!userId || !supabase) return { ok: false, reason: 'no-user-or-supabase' };

  const dayISO = localDayISO(new Date());

  let eaten = 0;
  let burned = 0;

  // 1) read daily_metrics first
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

  // 2) burned fallback from workouts
  if (!burned || burned <= 0) {
    const burnedFromWorkouts = await sumBurnedFromWorkouts(userId, dayISO);
    if (burnedFromWorkouts > 0) burned = burnedFromWorkouts;
  }

  // 3) eaten fallback from meals
  if (!eaten || eaten <= 0) {
    const eatenFromMeals = await sumEatenFromMeals(userId, dayISO);
    if (eatenFromMeals > 0) eaten = eatenFromMeals;
  }

  // 4) write local cache for banner
  writeDailyMetricsCache(dayISO, eaten, burned);

  try {
    localStorage.setItem('consumedToday', String(Math.round(eaten || 0)));
    localStorage.setItem('burnedToday', String(Math.round(burned || 0)));
  } catch {}

  // 5) dispatch so UI updates instantly
  if (alsoDispatch) {
    dispatchTotals(dayISO, eaten, burned);
  }

  // 6) repair daily_metrics so future reads match perfectly
  try {
    await upsertDailyMetricsCloud(userId, dayISO, eaten, burned);
  } catch (e) {
    console.warn('[hydrateCloudToLocal] repair upsert failed', e);
  }

  return { ok: true, dayISO, eaten, burned };
}
