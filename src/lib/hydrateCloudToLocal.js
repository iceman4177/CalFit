// src/lib/hydrateCloudToLocal.js
// Pull cloud daily_metrics for "today" into localStorage so totals carry across devices.

import { supabase } from '../lib/supabaseClient';

// ---------- Local-day helpers ----------
function localDayISO(d = new Date()) {
  try {
    const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return ld.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Writes a normalized "today totals" row into dailyMetricsCache
 * so NetCalorieBanner + dashboards can display cross-device values.
 */
function writeDailyMetricsCache(dayISO, { eaten, burned, net }) {
  try {
    const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
    cache[dayISO] = {
      // keep both names to satisfy ALL readers in the app
      eaten: safeNum(eaten),
      burned: safeNum(burned),
      net: safeNum(net),

      // legacy-friendly fields (some screens check these)
      consumed: safeNum(eaten),
      calories_eaten: safeNum(eaten),
      calories_burned: safeNum(burned),
      net_calories: safeNum(net),

      updated_at: new Date().toISOString(),
    };
    localStorage.setItem('dailyMetricsCache', JSON.stringify(cache));

    // optional convenience keys used in some parts of UI
    localStorage.setItem('consumedToday', String(safeNum(eaten)));
    localStorage.setItem('burnedToday', String(safeNum(burned)));
  } catch {}
}

/**
 * Dispatches update events so components refresh instantly without reload.
 */
function dispatchTotals(dayISO, { eaten, burned }) {
  try {
    window.dispatchEvent(
      new CustomEvent('slimcal:consumed:update', { detail: { date: dayISO, consumed: safeNum(eaten) } })
    );
  } catch {}
  try {
    window.dispatchEvent(
      new CustomEvent('slimcal:burned:update', { detail: { date: dayISO, burned: safeNum(burned) } })
    );
  } catch {}
}

/**
 * Attempt read from daily_metrics using modern schema
 */
async function fetchDailyMetricsModern(userId, dayISO) {
  const res = await supabase
    .from('daily_metrics')
    .select('local_day, calories_eaten, calories_burned, net_calories, updated_at')
    .eq('user_id', userId)
    .eq('local_day', dayISO)
    .maybeSingle();

  if (res.error) throw res.error;
  return res.data || null;
}

/**
 * Attempt read from daily_metrics using legacy schema
 */
async function fetchDailyMetricsLegacy(userId, dayISO) {
  const res = await supabase
    .from('daily_metrics')
    .select('day, cals_eaten, cals_burned, net_cals, updated_at')
    .eq('user_id', userId)
    .eq('day', dayISO)
    .maybeSingle();

  if (res.error) throw res.error;
  return res.data || null;
}

/**
 * ✅ hydrateTodayTotalsFromCloud(user, { alsoDispatch })
 * Pulls cloud truth for today and stores into localStorage dailyMetricsCache.
 */
export async function hydrateTodayTotalsFromCloud(user, { alsoDispatch = true } = {}) {
  if (!supabase) return { ok: false, reason: 'no-supabase-client' };

  const userId = user?.id || null;
  if (!userId) return { ok: false, reason: 'no-user' };

  const dayISO = localDayISO();

  let data = null;

  // 1) Try modern schema
  try {
    data = await fetchDailyMetricsModern(userId, dayISO);
  } catch (e) {
    const msg = String(e?.message || e || '');
    const looksLikeSchemaMismatch =
      /column .* does not exist/i.test(msg) ||
      /invalid input syntax/i.test(msg) ||
      /could not find/i.test(msg);

    // 2) If schema mismatch, try legacy
    if (looksLikeSchemaMismatch) {
      try {
        data = await fetchDailyMetricsLegacy(userId, dayISO);
      } catch (e2) {
        console.warn('[hydrateTodayTotalsFromCloud] legacy fetch failed', e2);
        return { ok: false, reason: 'fetch-failed', error: e2 };
      }
    } else {
      console.warn('[hydrateTodayTotalsFromCloud] modern fetch failed', e);
      return { ok: false, reason: 'fetch-failed', error: e };
    }
  }

  if (!data) {
    // Nothing in cloud yet for today
    return { ok: true, dayISO, empty: true };
  }

  // Normalize both schemas into one row
  const eaten =
    data.calories_eaten != null ? safeNum(data.calories_eaten)
    : data.cals_eaten != null ? safeNum(data.cals_eaten)
    : 0;

  const burned =
    data.calories_burned != null ? safeNum(data.calories_burned)
    : data.cals_burned != null ? safeNum(data.cals_burned)
    : 0;

  const net =
    data.net_calories != null ? safeNum(data.net_calories)
    : data.net_cals != null ? safeNum(data.net_cals)
    : (eaten - burned);

  // ✅ Write to cache in the format the UI expects
  writeDailyMetricsCache(dayISO, { eaten, burned, net });

  // ✅ Trigger UI refresh
  if (alsoDispatch) {
    dispatchTotals(dayISO, { eaten, burned });
  }

  return { ok: true, dayISO, eaten, burned, net };
}
