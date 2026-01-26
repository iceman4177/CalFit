// src/lib/hydrateCloudToLocal.js
import { supabase } from './supabaseClient';

// ---------- Local-day helpers ----------
function startOfLocalDay(d = new Date()) {
  const dt = new Date(d);
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 0, 0, 0, 0);
}
function endOfLocalDay(d = new Date()) {
  const dt = new Date(d);
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1, 0, 0, 0, 0);
}
function localDayISO(d = new Date()) {
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

function readCacheForDay(dayISO) {
  try {
    const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
    const row = cache?.[dayISO] || {};
    return row && typeof row === 'object' ? row : {};
  } catch {
    return {};
  }
}

function writeCacheForDay(dayISO, nextRow) {
  try {
    const cache = JSON.parse(localStorage.getItem('dailyMetricsCache') || '{}') || {};
    cache[dayISO] = nextRow;
    localStorage.setItem('dailyMetricsCache', JSON.stringify(cache));
  } catch {}
}

function toMs(ts) {
  try {
    const t = new Date(ts).getTime();
    return Number.isFinite(t) ? t : 0;
  } catch {
    return 0;
  }
}

function dispatchConsumed(dayISO, consumed) {
  try {
    window.dispatchEvent(
      new CustomEvent('slimcal:consumed:update', { detail: { date: dayISO, consumed } })
    );
  } catch {}
}

function dispatchBurned(dayISO, burned) {
  try {
    window.dispatchEvent(
      new CustomEvent('slimcal:burned:update', { detail: { date: dayISO, burned } })
    );
  } catch {}
}

// ---------- Cloud fallback helpers ----------
async function sumWorkoutsForToday(user_id, now = new Date()) {
  const start = startOfLocalDay(now).toISOString();
  const end = endOfLocalDay(now).toISOString();

  const { data: rows, error } = await supabase
    .from('workouts')
    .select('total_calories,started_at')
    .eq('user_id', user_id)
    .gte('started_at', start)
    .lt('started_at', end);

  if (error) throw error;

  const arr = Array.isArray(rows) ? rows : [];
  const sum = arr.reduce((s, r) => s + safeNum(r?.total_calories, 0), 0);
  return Math.round(sum);
}

/**
 * ✅ hydrateTodayTotalsFromCloud(user_id)
 *
 * Authoritative summary source is daily_metrics, BUT:
 * - daily_metrics can be stale for a few seconds/minutes during device drift
 * - if it returns 0 burned while workouts exist, the banner flickers to 0
 *
 * FIX:
 * - merge cloud values with local cache
 * - never clobber local >0 with cloud 0
 * - if cloud burned is 0, compute burned from today's workouts as a fallback
 */
export async function hydrateTodayTotalsFromCloud(user_id) {
  if (!user_id) return { ok: false, reason: 'no-user' };

  const now = new Date();
  const dayISO = localDayISO(now);

  const prev = readCacheForDay(dayISO);
  const localEaten = Math.round(safeNum(prev?.consumed ?? prev?.calories_eaten ?? 0, 0));
  const localBurned = Math.round(safeNum(prev?.burned ?? prev?.calories_burned ?? 0, 0));
  const localUpdatedMs = toMs(prev?.updated_at);

  const { data, error } = await supabase
    .from('daily_metrics')
    .select('calories_eaten, calories_burned, net_calories, updated_at, local_day')
    .eq('user_id', user_id)
    .eq('local_day', dayISO)
    .maybeSingle();

  if (error) {
    console.warn('[hydrateTodayTotalsFromCloud] error', error);
    return { ok: false, error };
  }

  // If no daily_metrics row yet, do NOT overwrite local cache to 0 (prevents flicker)
  // We'll still try to compute burned from workouts as a fallback.
  let cloudEaten = 0;
  let cloudBurned = 0;
  let cloudUpdatedMs = 0;

  if (data) {
    cloudEaten = Math.round(safeNum(data?.calories_eaten, 0));
    cloudBurned = Math.round(safeNum(data?.calories_burned, 0));
    cloudUpdatedMs = toMs(data?.updated_at);
  }

  // Fallback: if cloud burned is 0, compute from workouts table (today)
  let workoutBurned = 0;
  try {
    workoutBurned = await sumWorkoutsForToday(user_id, now);
  } catch (e) {
    // ignore; don't break hydration on transient errors
  }

  // Merge rule:
  // - prefer newer cloud when non-zero
  // - never overwrite local/workout >0 with cloud 0
  const cloudIsNewer = cloudUpdatedMs >= localUpdatedMs;

  let nextEaten = localEaten;
  let nextBurned = localBurned;

  // eaten: if cloud has a value or local is 0, accept newer cloud
  if (cloudIsNewer && (cloudEaten > 0 || localEaten === 0)) nextEaten = cloudEaten;
  if (!cloudIsNewer && localEaten === 0 && cloudEaten > 0) nextEaten = cloudEaten;

  // burned: take the max of (localBurned, workoutBurned, cloudBurned) with anti-clobber rules
  const bestBurned = Math.max(localBurned || 0, workoutBurned || 0, cloudBurned || 0);
  nextBurned = bestBurned;

  // Write merged cache
  const nextRow = {
    ...prev,
    consumed: Math.round(nextEaten || 0),
    burned: Math.round(nextBurned || 0),
    updated_at: new Date().toISOString(),
  };
  writeCacheForDay(dayISO, nextRow);

  // convenience keys (banner reads these as strongest truth)
  try {
    localStorage.setItem('consumedToday', String(Math.round(nextEaten || 0)));
    localStorage.setItem('burnedToday', String(Math.round(nextBurned || 0)));
  } catch {}

  // dispatch UI updates
  dispatchConsumed(dayISO, Math.round(nextEaten || 0));
  dispatchBurned(dayISO, Math.round(nextBurned || 0));

  return { ok: true, eaten: Math.round(nextEaten || 0), burned: Math.round(nextBurned || 0) };
}

// ---- Meals hydration (never clobbers burned) ---------------------------------

function upsertMealHistoryFromCloudRows(rows, dayDisplay) {
  try {
    const key = 'mealHistory';
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    const list = Array.isArray(existing) ? existing : [];

    const others = list.filter(r => r?.date !== dayDisplay);

    const meals = (rows || []).map(r => ({
      title: r?.title || 'Meal',
      calories: safeNum(r?.total_calories, 0),
      protein: 0,
      carbs: 0,
      fat: 0,
      createdAt: r?.eaten_at || r?.created_at || new Date().toISOString(),
      client_id: r?.client_id || null,
      cloud_id: r?.id || null,
    }));

    const nextToday = { date: dayDisplay, meals };
    const next = [nextToday, ...others].slice(0, 60);
    localStorage.setItem(key, JSON.stringify(next));
  } catch {}
}

/**
 * ✅ Hydrate TODAY MEALS from Supabase into localStorage mealHistory + banner
 * Uses eaten_at because meals table does NOT have local_day.
 *
 * CRITICAL RULE:
 * - Only update consumed
 * - Never touch burned
 */
export async function hydrateTodayMealsFromCloud(user_id) {
  if (!user_id) return { ok: false, reason: 'no-user' };

  const now = new Date();
  const dayISO = localDayISO(now);
  const dayDisplay = now.toLocaleDateString('en-US');

  const start = startOfLocalDay(now).toISOString();
  const end = endOfLocalDay(now).toISOString();

  const { data: rows, error } = await supabase
    .from('meals')
    .select('id,user_id,client_id,eaten_at,title,total_calories,created_at,updated_at')
    .eq('user_id', user_id)
    .gte('eaten_at', start)
    .lt('eaten_at', end)
    .order('eaten_at', { ascending: false });

  if (error) {
    console.warn('[hydrateTodayMealsFromCloud] error', error);
    return { ok: false, error };
  }

  const meals = Array.isArray(rows) ? rows : [];
  upsertMealHistoryFromCloudRows(meals, dayDisplay);

  const consumedToday = meals.reduce((s, m) => s + safeNum(m?.total_calories, 0), 0);
  const consumedRounded = Math.round(consumedToday);

  // Merge into cache WITHOUT touching burned
  const prev = readCacheForDay(dayISO);
  const nextRow = {
    ...prev,
    consumed: consumedRounded,
    updated_at: new Date().toISOString(),
  };
  writeCacheForDay(dayISO, nextRow);

  try {
    localStorage.setItem('consumedToday', String(consumedRounded));
  } catch {}

  dispatchConsumed(dayISO, consumedRounded);

  return { ok: true, count: meals.length, consumedToday: consumedRounded };
}
