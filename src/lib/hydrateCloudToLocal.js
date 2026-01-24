// src/lib/hydrateCloudToLocal.js
import { supabase } from './supabaseClient';

function localDayISO(d = new Date()) {
  try {
    const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return ld.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function num(n, d = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : d;
}

export async function hydrateTodayTotalsFromCloud(user, opts = {}) {
  const alsoDispatch = opts?.alsoDispatch !== false;

  const user_id = user?.id || null;
  if (!user_id) return { ok: false, reason: 'no_user' };

  const todayLocal = localDayISO(new Date());

  try {
    const { data, error } = await supabase
      .from('daily_metrics')
      .select('*')
      .eq('user_id', user_id)
      .eq('local_day', todayLocal)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) throw error;

    const row = Array.isArray(data) && data.length ? data[0] : null;

    if (!row) {
      try {
        localStorage.setItem('consumedToday', String(0));
        localStorage.setItem('burnedToday', String(0));
        localStorage.setItem('netToday', String(0));
      } catch {}

      // also keep dailyMetricsCache consistent
      try {
        const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
        cache[todayLocal] = { consumed: 0, burned: 0, net: 0, updated_at: new Date().toISOString() };
        localStorage.setItem('dailyMetricsCache', JSON.stringify(cache));
      } catch {}

      if (alsoDispatch) {
        try {
          window.dispatchEvent(new CustomEvent('slimcal:consumed:update', { detail: { date: todayLocal, consumed: 0 } }));
        } catch {}
        try {
          window.dispatchEvent(new CustomEvent('slimcal:burned:update', { detail: { date: todayLocal, burned: 0 } }));
        } catch {}
        try {
          window.dispatchEvent(new CustomEvent('slimcal:net:update', { detail: { date: todayLocal, net: 0 } }));
        } catch {}
      }

      return { ok: true, empty: true, local_day: todayLocal };
    }

    const consumed = num(row.calories_eaten, 0);
    const burned = num(row.calories_burned, 0);
    const net = num(row.net_calories, consumed - burned);

    try {
      localStorage.setItem('consumedToday', String(consumed));
      localStorage.setItem('burnedToday', String(burned));
      localStorage.setItem('netToday', String(net));
      localStorage.setItem('slimcal:lastHydratedLocalDay', todayLocal);
      localStorage.setItem('slimcal:lastHydratedAt', String(Date.now()));
    } catch {}

    // ✅ keep existing fallback cache in sync
    try {
      const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
      cache[todayLocal] = {
        consumed,
        burned,
        net,
        calories_eaten: consumed,
        calories_burned: burned,
        net_calories: net,
        updated_at: new Date().toISOString()
      };
      localStorage.setItem('dailyMetricsCache', JSON.stringify(cache));
    } catch {}

    if (alsoDispatch) {
      try {
        window.dispatchEvent(new CustomEvent('slimcal:consumed:update', { detail: { date: todayLocal, consumed } }));
      } catch {}
      try {
        window.dispatchEvent(new CustomEvent('slimcal:burned:update', { detail: { date: todayLocal, burned } }));
      } catch {}
      try {
        window.dispatchEvent(new CustomEvent('slimcal:net:update', { detail: { date: todayLocal, net } }));
      } catch {}
    }

    return { ok: true, local_day: todayLocal, consumed, burned, net, raw: row };
  } catch (e) {
    console.warn('[hydrateTodayTotalsFromCloud] failed', e);
    return { ok: false, error: e };
  }
}
