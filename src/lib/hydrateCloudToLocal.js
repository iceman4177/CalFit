// src/lib/hydrateCloudToLocal.js
// Pull cloud "today totals" into localStorage caches so UI carries across devices.

import { supabase } from './supabaseClient';

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

function normalizeDailyMetricsRow(row) {
  if (!row || typeof row !== 'object') return null;

  // Accept new schema OR legacy schema
  const local_day =
    row.local_day ||
    row.day ||
    row.date_key ||
    localDayISO();

  const eaten =
    safeNum(
      row.calories_eaten ??
      row.cals_eaten ??
      row.consumed ??
      row.eaten ??
      0,
      0
    );

  const burned =
    safeNum(
      row.calories_burned ??
      row.cals_burned ??
      row.burned ??
      0,
      0
    );

  const net =
    safeNum(
      row.net_calories ??
      row.net_cals ??
      row.net ??
      (eaten - burned),
      eaten - burned
    );

  return { local_day, eaten, burned, net };
}

async function fetchTodayDailyMetricsRow(userId, todayISO) {
  if (!supabase) return null;

  // ✅ Try new schema first (local_day)
  try {
    const res = await supabase
      .from('daily_metrics')
      .select('*')
      .eq('user_id', userId)
      .eq('local_day', todayISO)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!res?.error && res?.data) return res.data;

    // If no data, continue to legacy fallback
  } catch {}

  // ✅ Legacy schema fallback (day)
  try {
    const res2 = await supabase
      .from('daily_metrics')
      .select('*')
      .eq('user_id', userId)
      .eq('day', todayISO)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!res2?.error && res2?.data) return res2.data;
  } catch {}

  // ✅ If neither worked, return null
  return null;
}

/**
 * hydrateTodayTotalsFromCloud
 * - Reads today's daily_metrics from Supabase
 * - Writes it into localStorage.dailyMetricsCache[todayISO]
 * - Dispatches update events so NetCalorieBanner refreshes instantly
 */
export async function hydrateTodayTotalsFromCloud(user, { alsoDispatch = true } = {}) {
  const userId = user?.id || null;
  if (!userId || !supabase) return { ok: false, reason: 'no-user-or-supabase' };

  const todayISO = localDayISO();
  const row = await fetchTodayDailyMetricsRow(userId, todayISO);

  if (!row) {
    // No cloud row yet — do nothing
    return { ok: true, hydrated: false, todayISO };
  }

  const norm = normalizeDailyMetricsRow(row);
  if (!norm) return { ok: false, reason: 'bad-row' };

  // ✅ Write to local cache
  try {
    const bag = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
    bag[todayISO] = {
      eaten: safeNum(norm.eaten, 0),
      burned: safeNum(norm.burned, 0),
      net: safeNum(norm.net, safeNum(norm.eaten, 0) - safeNum(norm.burned, 0)),
      updated_at: new Date().toISOString(),
      _hydrated_from_cloud: true,
    };
    localStorage.setItem('dailyMetricsCache', JSON.stringify(bag));
  } catch {}

  // ✅ Dispatch events so UI updates immediately
  if (alsoDispatch) {
    try {
      window.dispatchEvent(new CustomEvent('slimcal:consumed:update', {
        detail: { date: todayISO, eaten: safeNum(norm.eaten, 0) }
      }));
      window.dispatchEvent(new CustomEvent('slimcal:burned:update', {
        detail: { date: todayISO, burned: safeNum(norm.burned, 0) }
      }));
    } catch {}
  }

  return { ok: true, hydrated: true, todayISO, values: norm };
}
