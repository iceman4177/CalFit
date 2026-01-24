// src/lib/hydrateCloudToLocal.js
import { supabase } from './supabaseClient';

// Local-day ISO helper (local midnight; avoids UTC off-by-one)
function localDayISO(d = new Date()) {
  try {
    const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return ld.toISOString().slice(0, 10); // YYYY-MM-DD
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function num(n, d = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : d;
}

/**
 * Pull today's cloud daily_metrics → write to localStorage keys used by UI:
 * - consumedToday
 * - burnedToday
 * - netToday
 *
 * Also dispatches events so any banner/UI updates immediately.
 */
export async function hydrateTodayTotalsFromCloud(user, opts = {}) {
  const alsoDispatch = opts?.alsoDispatch !== false;

  const user_id = user?.id || null;
  if (!user_id) return { ok: false, reason: 'no_user' };

  const todayLocal = localDayISO(new Date());

  try {
    // Try modern schema first: daily_metrics.local_day
    const { data, error } = await supabase
      .from('daily_metrics')
      .select('*')
      .eq('user_id', user_id)
      .eq('local_day', todayLocal)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      // If no row exists yet, default zeros
      try {
        localStorage.setItem('consumedToday', String(0));
        localStorage.setItem('burnedToday', String(0));
        localStorage.setItem('netToday', String(0));
      } catch {}

      if (alsoDispatch) {
        try {
          window.dispatchEvent(
            new CustomEvent('slimcal:consumed:update', {
              detail: { date: todayLocal, consumed: 0 }
            })
          );
        } catch {}
        try {
          window.dispatchEvent(
            new CustomEvent('slimcal:burned:update', {
              detail: { date: todayLocal, burned: 0 }
            })
          );
        } catch {}
        try {
          window.dispatchEvent(
            new CustomEvent('slimcal:net:update', {
              detail: { date: todayLocal, net: 0 }
            })
          );
        } catch {}
      }

      return { ok: true, empty: true, local_day: todayLocal };
    }

    const consumed = num(data.calories_eaten, 0);
    const burned = num(data.calories_burned, 0);
    const net = num(data.net_calories, consumed - burned);

    // Write to localStorage so existing UI reads correct numbers immediately
    try {
      localStorage.setItem('consumedToday', String(consumed));
      localStorage.setItem('burnedToday', String(burned));
      localStorage.setItem('netToday', String(net));
      localStorage.setItem('slimcal:lastHydratedLocalDay', todayLocal);
      localStorage.setItem('slimcal:lastHydratedAt', String(Date.now()));
    } catch {}

    // Dispatch events so any components listening update
    if (alsoDispatch) {
      try {
        window.dispatchEvent(
          new CustomEvent('slimcal:consumed:update', {
            detail: { date: todayLocal, consumed }
          })
        );
      } catch {}
      try {
        window.dispatchEvent(
          new CustomEvent('slimcal:burned:update', {
            detail: { date: todayLocal, burned }
          })
        );
      } catch {}
      try {
        window.dispatchEvent(
          new CustomEvent('slimcal:net:update', {
            detail: { date: todayLocal, net }
          })
        );
      } catch {}
    }

    return { ok: true, local_day: todayLocal, consumed, burned, net, raw: data };
  } catch (e) {
    console.warn('[hydrateTodayTotalsFromCloud] failed', e);
    return { ok: false, error: e };
  }
}
