// src/lib/hydrateCloudToLocal.js
// Pull Supabase data into localStorage caches so totals carry across devices.

import { supabase } from './supabaseClient';

function localISODay(d = new Date()) {
  try {
    const dt = new Date(d);
    const localMidnight = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    return localMidnight.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function safeNum(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function readLS(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function writeLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/**
 * Hydrate today's totals from Supabase daily_metrics into localStorage so the UI works cross-device.
 *
 * Supports:
 * - New schema: (local_day, calories_eaten, calories_burned, net_calories)
 * - Legacy schema: (day, cals_eaten, cals_burned, net_cals)
 */
export async function hydrateTodayTotalsFromCloud(user, { alsoDispatch = true } = {}) {
  const userId = user?.id || null;
  if (!userId) return { ok: false, reason: 'no-user' };
  if (!supabase) return { ok: false, reason: 'no-supabase' };

  const today = localISODay();

  let eaten = 0;
  let burned = 0;
  let net = 0;
  let updated_at = new Date().toISOString();

  // Try new schema first
  try {
    const res = await supabase
      .from('daily_metrics')
      .select('local_day, calories_burned, calories_eaten, net_calories, updated_at')
      .eq('user_id', userId)
      .eq('local_day', today)
      .maybeSingle();

    if (res?.data) {
      burned = safeNum(res.data.calories_burned, 0);
      eaten = safeNum(res.data.calories_eaten, 0);
      net = safeNum(res.data.net_calories, eaten - burned);
      updated_at = res.data.updated_at || updated_at;
    }

    // If table is legacy (missing local_day), fall through to legacy query
    if (res?.error && /column .* does not exist/i.test(res.error.message || '')) {
      throw res.error;
    }
  } catch {
    // Legacy schema fallback
    try {
      const res2 = await supabase
        .from('daily_metrics')
        .select('day, cals_burned, cals_eaten, net_cals, updated_at')
        .eq('user_id', userId)
        .eq('day', today)
        .maybeSingle();

      if (res2?.data) {
        burned = safeNum(res2.data.cals_burned, 0);
        eaten = safeNum(res2.data.cals_eaten, 0);
        net = safeNum(res2.data.net_cals, eaten - burned);
        updated_at = res2.data.updated_at || updated_at;
      }
    } catch (e2) {
      return { ok: false, reason: 'query-failed', error: e2 };
    }
  }

  // Mirror into local cache (NetCalorieBanner reads this as a fallback)
  const cache = readLS('dailyMetricsCache', {});
  cache[today] = {
    // include both key styles for compatibility across components
    consumed: eaten,
    eaten,
    burned,
    net,
    calories_eaten: eaten,
    calories_burned: burned,
    net_calories: net,
    updated_at,
  };
  writeLS('dailyMetricsCache', cache);

  // Convenience value some components read
  try {
    localStorage.setItem('consumedToday', String(eaten));
  } catch {}

  if (alsoDispatch && typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('slimcal:consumed:update', {
        detail: { date: today, consumed: eaten, eaten }
      }));
      window.dispatchEvent(new CustomEvent('slimcal:burned:update', {
        detail: { date: today, burned }
      }));
    } catch {}
  }

  return { ok: true, today, eaten, burned, net };
}
