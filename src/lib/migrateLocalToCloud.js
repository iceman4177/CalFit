// src/lib/migrateLocalToCloud.js
// One-time bootstrap sync (idempotent): localStorage → Supabase after login.
// - Ensures stable client_id on local entries (and persists it back to localStorage)
// - Upserts workouts/meals by client_id
// - Upserts DAILY TOTALS (per day) to daily_metrics so we don't overwrite totals per item
// - Stores a per-user bootstrap map to prevent duplicates across sessions/devices

import { supabase } from './supabaseClient';
import { ensureScopedFromLegacy, readScopedJSON, writeScopedJSON, KEYS } from './scopedStorage.js';
// --- helpers ---------------------------------------------------------------
function isUUID(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ''));
}

function localDayISO(d = new Date()) {
  const dt = new Date(d);
  return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}


// ---------- small utils ----------
function readLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function writeLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
function uuidv4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
function safeNum(n, fallback = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
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
function todayUS() {
  try {
    return new Date().toLocaleDateString('en-US');
  } catch {
    return '';
  }
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

// ---------- Stable client_id helpers (persist back to LS) ----------
function ensureClientId(obj) {
  if (!obj) return null;
  if (!obj.client_id) obj.client_id = uuidv4();
  return obj.client_id;
}

function persistClientIdsBackToLocalStorage(userId, { workoutHistory, mealHistory }) {
  // Persist updated workoutHistory if we added client_id to any workout
  try {
    writeScopedJSON(KEYS.workoutHistory, userId, workoutHistory);
  } catch {}

  // Persist updated mealHistory if we added client_id to any meal entry
  try {
    writeScopedJSON(KEYS.mealHistory, userId, mealHistory);
  } catch {}
}

// ---------- Collect local data in your current formats ----------
export function collectAllLocalData() {
  const workoutHistoryRaw = readScopedJSON(KEYS.workoutHistory, userId, []);
  const mealHistoryRaw = readScopedJSON(KEYS.mealHistory, userId, []);

  const workoutHistory = Array.isArray(workoutHistoryRaw) ? workoutHistoryRaw : [];
  const mealHistory = Array.isArray(mealHistoryRaw) ? mealHistoryRaw : [];

  // Ensure client_id on workouts (and keep them stable by persisting)
  for (const w of workoutHistory) {
    ensureClientId(w);
  }

  // Normalize meals to a flat list with stable client_id.
  // IMPORTANT: do NOT use "now" for eaten_at if we can infer anything.
  // Some builds store createdAt/eatenAt on meal objects. If not present, we fall back.
  const mealsFlat = [];
  for (const day of mealHistory) {
    const dayKey = day?.date || toLocalDayKey();
    const mealsArr = Array.isArray(day?.meals) ? day.meals : [];
    for (const m of mealsArr) {
      ensureClientId(m);

      const eatenAt =
        m.eaten_at ||
        m.eatenAt ||
        m.createdAt ||
        m.created_at ||
        // best-effort: anchor to that dayKey at noon local to reduce cross-day drift
        (() => {
          try {
            const [y, mo, da] = String(dayKey).split('-').map(Number);
            const d = new Date(y, (mo || 1) - 1, da || 1, 12, 0, 0, 0);
            return d.toISOString();
          } catch {
            return new Date().toISOString();
          }
        })();

      mealsFlat.push({
        client_id: m.client_id,
        eaten_at: eatenAt,
        title:
          m.title ||
          m.food_name ||
          m.foodName ||
          m.displayName ||
          m.label ||
          m.name ||
          null,
        total_calories: safeNum(m.total_calories ?? m.calories ?? 0, 0),
        __day: dayKey,
      });
    }
  }

  // Persist any newly created client_ids back to LS so bootstrap stays idempotent forever
  persistClientIdsBackToLocalStorage(userId, { workoutHistory, mealHistory });

  return { workouts: workoutHistory, meals: mealsFlat };
}

// ---------- Compute day totals from local caches (prevents daily_metrics overwrite) ----------
function computeLocalDailyTotals() {
  const dUS = todayUS(); // used by some local caches
  const workoutHistory = readScopedJSON(KEYS.workoutHistory, userId, []);
  const mealHistory = readScopedJSON(KEYS.mealHistory, userId, []);

  const dayTotals = new Map(); // dayKey -> { consumed, burned }

  // Meals: mealHistory is [{ date: 'MM/DD/YYYY'? or 'YYYY-MM-DD' in your app }, meals: [...] }]
  for (const day of Array.isArray(mealHistory) ? mealHistory : []) {
    const dayKey = day?.date || null;
    if (!dayKey) continue;

    const meals = Array.isArray(day?.meals) ? day.meals : [];
    const consumed = meals.reduce((s, m) => s + safeNum(m?.total_calories ?? m?.calories ?? 0, 0), 0);

    const prev = dayTotals.get(dayKey) || { consumed: 0, burned: 0 };
    prev.consumed += consumed;
    dayTotals.set(dayKey, prev);
  }

  // Workouts: workoutHistory is array of workouts, filter by date = todayUS style (MM/DD/YYYY)
  const wh = Array.isArray(workoutHistory) ? workoutHistory : [];
  for (const w of wh) {
    const dayKey = w?.date || dUS || null;
    if (!dayKey) continue;
    const burned = safeNum(w?.totalCalories ?? w?.total_calories ?? w?.calories ?? 0, 0);

    const prev = dayTotals.get(dayKey) || { consumed: 0, burned: 0 };
    prev.burned += burned;
    dayTotals.set(dayKey, prev);
  }

  // Also consider dailyMetricsCache if present (some builds store ISO day keys)
  try {
    const cache = readScopedJSON(KEYS.dailyMetricsCache, userId, {});
    if (cache && typeof cache === 'object') {
      for (const [k, row] of Object.entries(cache)) {
        const consumed = safeNum(row?.consumed ?? row?.eaten ?? row?.calories_eaten ?? 0, 0);
        const burned = safeNum(row?.burned ?? row?.calories_burned ?? 0, 0);
        if (!consumed && !burned) continue;

        const prev = dayTotals.get(k) || { consumed: 0, burned: 0 };
        // Prefer cache values only if they are larger (avoid shrinking totals)
        prev.consumed = Math.max(prev.consumed, consumed);
        prev.burned = Math.max(prev.burned, burned);
        dayTotals.set(k, prev);
      }
    }
  } catch {}

  return dayTotals; // keys can be MM/DD/YYYY or YYYY-MM-DD depending on caller
}

// ---------- Normalize day keys to ISO (YYYY-MM-DD) ----------
function normalizeDayKeyToISO(dayKey) {
  // If already YYYY-MM-DD, keep
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey))) return String(dayKey);

  // If MM/DD/YYYY, convert to YYYY-MM-DD
  const m = String(dayKey || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = String(m[1]).padStart(2, '0');
    const dd = String(m[2]).padStart(2, '0');
    const yyyy = String(m[3]);
    return `${yyyy}-${mm}-${dd}`;
  }

  // fallback: today
  return toLocalDayKey();
}

// ---------- One-time, idempotent bootstrap ----------
export async function migrateLocalToCloudOneTime(user) {
  const userId = user?.id || null;
  ensureScopedFromLegacy(KEYS.mealHistory, userId);
  ensureScopedFromLegacy(KEYS.workoutHistory, userId);
  ensureScopedFromLegacy(KEYS.dailyMetricsCache, userId);

  // If supabase client is missing/misconfigured, don't crash
  if (!supabase) return { ok: false, skipped: 'no-supabase-client' };

  if (!user?.id) return { ok: true, skipped: 'no-user' };
  const userKey = getUserKey(user);

  // Previously you rate-limited 12h which can block real users.
  // Make it much shorter (2 minutes) as a safety guard against rapid reruns.
  const minInterval = 2 * 60 * 1000;
  if (Date.now() - getLastBootstrapTs(userKey) < minInterval) {
    return { ok: true, skipped: 'recently-ran' };
  }

  const { workouts, meals } = collectAllLocalData();

  let pushedW = 0, skippedW = 0;
  let pushedM = 0, skippedM = 0;
  let pushedD = 0, skippedD = 0;

  // --- Workouts: ensure client_id and upsert (onConflict: client_id)
  for (const w of workouts) {
    const cid = ensureClientId(w);
    if (!cid) { skippedW++; continue; }
    if (hasSynced(userKey, 'workouts', cid)) { skippedW++; continue; }

    const startedAt = w.started_at || w.startedAt || w.createdAt || new Date().toISOString();
    const endedAt = w.ended_at || w.endedAt || startedAt;

    // workouts.local_day is NOT NULL — derive it if missing
    const localDay = (w.local_day || w.__local_day || w.localDay || null) || localDayISO(new Date(startedAt));

    // workouts.items (jsonb) must contain items.exercises[] with at least 1 entry (workouts_has_exercises CHECK)
    const exFromItems = (w?.items && typeof w.items === 'object' && Array.isArray(w.items.exercises)) ? w.items.exercises : null;
    const exFromLegacy = Array.isArray(w?.exercises) ? w.exercises : null;
    const exArr = exFromItems || exFromLegacy || [];

    const normExercises = (exArr || []).map((e) => {
      const name = String(e?.name || e?.exerciseName || '').trim();
      if (!name) return null;
      return {
        name,
        sets: safeNum(e?.sets, 0),
        reps: e?.reps ?? null,
        weight: (e?.weight == null ? null : e.weight),
        calories: safeNum(e?.calories, 0),
        equipment: e?.equipment ?? null,
        muscle_group: e?.muscle_group ?? e?.muscleGroup ?? null,
      };
    }).filter(Boolean);

    if (!normExercises.length) { skippedW++; continue; }

    const totalCalories = safeNum(w.totalCalories ?? w.total_calories ?? w.calories ?? 0, 0);

    const row = {
      user_id: user.id,
      client_id: cid,
      started_at: startedAt,
      ended_at: endedAt,
      local_day: localDay,
      total_calories: totalCalories,
      items: { exercises: normExercises },
      goal: w.goal ?? null,
      notes: w.notes ?? null,
    };

    try {
      const { error } = await supabase.from('workouts').upsert(row, { onConflict: 'client_id' });
      if (!error) {
        pushedW++;
        markSynced(userKey, 'workouts', cid);
      }
    } catch {
      // swallow and continue; queue is handled elsewhere
    }
  }

  // --- Meals: ensure client_id and upsert
  for (const m of meals) {
    const cid = ensureClientId(m);
    if (!cid) { skippedM++; continue; }
    if (hasSynced(userKey, 'meals', cid)) { skippedM++; continue; }

    const row = {
      user_id: user.id,
      client_id: cid,
      eaten_at: m.eaten_at || new Date().toISOString(),
      title: m.title ?? null,
      total_calories: safeNum(m.total_calories ?? 0, 0),
      client_updated_at: new Date().toISOString(),
    };

    try {
      const { error } = await supabase.from('meals').upsert(row, { onConflict: 'client_id' });
      if (!error) {
        pushedM++;
        markSynced(userKey, 'meals', cid);
      }
    } catch {
      // swallow and continue
    }
  }

  // --- Daily Metrics: compute totals per day and upsert ONCE PER DAY (prevents overwrite)
  // We mark daily synced by dayISO.
  const totalsMap = computeLocalDailyTotals();

  for (const [dayKeyRaw, totals] of totalsMap.entries()) {
    const dayISO = normalizeDayKeyToISO(dayKeyRaw);
    if (hasSynced(userKey, 'daily', dayISO)) { skippedD++; continue; }

    const consumed = Math.round(safeNum(totals?.consumed ?? 0, 0));
    const burned = Math.round(safeNum(totals?.burned ?? 0, 0));
    const net = consumed - burned;

    // Try NEW schema first (user_id, local_day, calories_eaten, calories_burned, net_calories)
    const rowNew = {
      user_id: user.id,
      local_day: dayISO,
      calories_eaten: consumed,
      calories_burned: burned,
      net_calories: net,
      updated_at: new Date().toISOString(),
    };

    try {
      let { error } = await supabase
        .from('daily_metrics')
        .upsert(rowNew, { onConflict: 'user_id,local_day' });

      // Fallback to legacy schema (user_id, day, cals_eaten, cals_burned, net_cals)
      if (error && /column .* does not exist/i.test(error.message || '')) {
        const rowLegacy = {
          user_id: user.id,
          day: dayISO,
          cals_eaten: consumed,
          cals_burned: burned,
          net_cals: net,
          updated_at: new Date().toISOString(),
        };
        const r2 = await supabase
          .from('daily_metrics')
          .upsert(rowLegacy, { onConflict: 'user_id,day' });
        if (r2.error) throw r2.error;
        error = null;
      }

      if (!error) {
        pushedD++;
        markSynced(userKey, 'daily', dayISO);
      }
    } catch {
      // swallow and continue
    }
  }

  setLastBootstrapTs(userKey);

  return {
    ok: true,
    pushed: { workouts: pushedW, meals: pushedM, daily: pushedD },
    skipped: { workouts: skippedW, meals: skippedM, daily: skippedD },
  };
}