// src/lib/migrateLocalToCloud.js
// One-time bootstrap sync (idempotent): localStorage → Supabase after login.
// Ensures client_id on old entries, upserts with onConflict, and stores a per-user
// map of what has already been bootstrapped to prevent duplicates.

import { supabase } from './supabaseClient';

// ---------- small utils ----------
function readLS(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}
function writeLS(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
function uuidv4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
function ensureClientId(obj) {
  if (!obj.client_id) obj.client_id = uuidv4();
  return obj.client_id;
}
function toLocalDayKey(tsLike) {
  const d = tsLike ? new Date(tsLike) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function getUserKey(user) {
  return user?.id || user?.uid || user?.user?.id || 'anon';
}

// ---------- per-user bootstrap map ----------
// Shape:
// {
//   "<userId>": {
//     lastBootstrapSyncTs: 1690000000000,
//     workouts: { "<client_id>": "ISO" },
//     meals:    { "<client_id>": "ISO" },
//     daily:    { "<yyyy-mm-dd>": "ISO" }
//   }
// }
function getBootstrapMap() {
  return readLS('bootstrapSynced', {});
}
function setBootstrapMap(map) {
  writeLS('bootstrapSynced', map);
}
function hasSynced(userKey, domain, key) {
  const map = getBootstrapMap();
  return !!map?.[userKey]?.[domain]?.[key];
}
function markSynced(userKey, domain, key) {
  const map = getBootstrapMap();
  if (!map[userKey]) map[userKey] = { workouts: {}, meals: {}, daily: {} };
  if (!map[userKey][domain]) map[userKey][domain] = {};
  map[userKey][domain][key] = new Date().toISOString();
  setBootstrapMap(map);
}
function setLastBootstrapTs(userKey) {
  const map = getBootstrapMap();
  if (!map[userKey]) map[userKey] = { workouts: {}, meals: {}, daily: {} };
  map[userKey].lastBootstrapSyncTs = Date.now();
  setBootstrapMap(map);
}
function getLastBootstrapTs(userKey) {
  const map = getBootstrapMap();
  return map?.[userKey]?.lastBootstrapSyncTs || 0;
}

// ---------- Collect local data in your current formats ----------
export function collectAllLocalData() {
  const workoutHistory = readLS('workoutHistory', []); // array of workouts { ..., client_id? }
  const mealHistory    = readLS('mealHistory', []);    // array of { date: 'YYYY-MM-DD', meals: [{name, calories,...}] }

  // Normalize meals to a flat list with client_id
  const meals = [];
  for (const day of Array.isArray(mealHistory) ? mealHistory : []) {
    const dayKey = day?.date || toLocalDayKey();
    for (const m of Array.isArray(day?.meals) ? day.meals : []) {
      const item = {
        client_id: m.client_id || null,
        eaten_at: new Date().toISOString(), // historic per-meal time not stored; best-effort
        title: m.name,
        total_calories: Number(m.calories || 0) || 0,
        __day: dayKey
      };
      meals.push(item);
    }
  }

  return { workouts: Array.isArray(workoutHistory) ? workoutHistory : [], meals, dailyMetrics: [] };
}

// ---------- One-time, idempotent bootstrap ----------
export async function migrateLocalToCloudOneTime(user) {
  if (!user?.id) return { ok: true, skipped: 'no-user' };
  const userKey = getUserKey(user);

  // Rate-limit: if we ran in the last 12h, skip
  const twelveHours = 12 * 60 * 60 * 1000;
  if (Date.now() - getLastBootstrapTs(userKey) < twelveHours) {
    return { ok: true, skipped: 'recently-ran' };
  }

  const { workouts, meals } = collectAllLocalData();

  let pushedW = 0, skippedW = 0;
  let pushedM = 0, skippedM = 0;
  let pushedD = 0, skippedD = 0;

  // --- Workouts: ensure client_id and upsert (onConflict: client_id)
  for (const w of workouts) {
    const cid = ensureClientId(w);
    if (hasSynced(userKey, 'workouts', cid)) { skippedW++; continue; }

    const row = {
      user_id: user.id,
      client_id: cid,
      // Best-effort times if not present
      started_at: w.started_at || new Date().toISOString(),
      ended_at:   w.ended_at   || new Date().toISOString(),
      goal:       w.goal ?? null,
      notes:      w.notes ?? null,
      client_updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from('workouts').upsert(row, { onConflict: 'client_id' });
    if (!error) {
      pushedW++;
      markSynced(userKey, 'workouts', cid);
      // daily metrics bump if we have calories on the workout object
      const dayKey = toLocalDayKey(w.createdAt || w.started_at || Date.now());
      const burned = Number(w.totalCalories || w.calories || 0) || 0;
      if (burned > 0) {
        const dm = {
          user_id: user.id,
          date_key: dayKey,
          consumed: 0,
          burned,
          net: 0, // server may compute; we send 0 and let backend recompute, or keep client-side consistent views
          client_updated_at: new Date().toISOString(),
          local_authoritative: true
        };
        const r = await supabase
          .from('daily_metrics')
          .upsert(dm, { onConflict: 'user_id,date_key' });
        if (!r.error) { pushedD++; markSynced(userKey, 'daily', dayKey); }
      }
    } else {
      // swallow and continue; queue is handled elsewhere
    }
  }

  // --- Meals: ensure client_id and upsert
  for (const m of meals) {
    const cid = ensureClientId(m);
    if (hasSynced(userKey, 'meals', cid)) { skippedM++; continue; }

    const row = {
      user_id: user.id,
      client_id: cid,
      eaten_at: m.eaten_at || new Date().toISOString(),
      title: m.title ?? null,
      total_calories: Number(m.total_calories || 0) || 0,
      client_updated_at: new Date().toISOString()
    };
    const { error } = await supabase.from('meals').upsert(row, { onConflict: 'client_id' });
    if (!error) {
      pushedM++;
      markSynced(userKey, 'meals', cid);

      // daily metrics bump for consumed
      const dayKey = m.__day || toLocalDayKey(m.eaten_at);
      const consumed = Number(m.total_calories || 0) || 0;
      if (consumed > 0) {
        const dm = {
          user_id: user.id,
          date_key: dayKey,
          consumed,
          burned: 0,
          net: 0,
          client_updated_at: new Date().toISOString(),
          local_authoritative: true
        };
        const r = await supabase
          .from('daily_metrics')
          .upsert(dm, { onConflict: 'user_id,date_key' });
        if (!r.error) { pushedD++; markSynced(userKey, 'daily', dayKey); }
      }
    }
  }

  setLastBootstrapTs(userKey);
  return {
    ok: true,
    pushed: { workouts: pushedW, meals: pushedM, daily: pushedD },
    skipped: { workouts: skippedW, meals: skippedM, daily: skippedD }
  };
}
