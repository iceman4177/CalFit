// src/lib/scopedStorage.js
// User-scoped localStorage helpers so multiple accounts on the same device
// don't see each other's cached meals/workouts/totals.

export function scopedKey(base, userId) {
  return userId ? `${base}:${userId}` : base;
}

export function safeJsonParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

export function readScopedJSON(base, userId, fallback) {
  try {
    const key = scopedKey(base, userId);
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return safeJsonParse(raw, fallback);
  } catch {
    return fallback;
  }
}

export function writeScopedJSON(base, userId, value) {
  try {
    const key = scopedKey(base, userId);
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function ensureScopedFromLegacy(key, userId, legacyKey = key) {
  // Legacy keys (unscoped) can exist from old builds. If you ever sign in with
  // multiple accounts on the same device, blindly migrating legacy values can
  // cross-contaminate users and cause banner flicker.
  if (!userId) return;

  const sk = scopedKey(key, userId);

  // Already migrated
  if (localStorage.getItem(sk) != null) return;

  // If ANY scoped keys exist for *any* user, do not migrate the unscoped value.
  // This prevents taking a previous user's legacy cache and assigning it to a new user.
  try {
    const prefix = `${key}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) {
        return;
      }
    }
  } catch (_) {
    // ignore
  }

  const legacy = localStorage.getItem(legacyKey);
  if (legacy == null) return;

  // If the legacy value is a JSON array/object, try to filter by userId when possible.
  // Otherwise, migrate as-is (primarily for simple scalar legacy keys).
  let toWrite = legacy;
  try {
    const parsed = JSON.parse(legacy);

    const filterByUser = (v) => {
      if (!Array.isArray(v)) return v;
      const filtered = v.filter((item) => {
        if (!item || typeof item !== 'object') return true;
        const uid = item.user_id || item.userId || (item.user && item.user.id) || null;
        return !uid || uid === userId;
      });
      return filtered;
    };

    const filtered = filterByUser(parsed);

    // If we filtered an array down to empty AND it looked user-scoped, skip migration.
    if (Array.isArray(parsed) && Array.isArray(filtered)) {
      const hadAnyUserIds = parsed.some((it) => it && typeof it === 'object' && (it.user_id || it.userId || (it.user && it.user.id)));
      if (hadAnyUserIds && filtered.length === 0) return;
    }

    toWrite = JSON.stringify(filtered);
  } catch (_) {
    // not JSON, keep raw
  }

  localStorage.setItem(sk, toWrite);
}


export const KEYS = {
  mealHistory: 'mealHistory',
  workoutHistory: 'workoutHistory',
  dailyMetricsCache: 'dailyMetricsCache',
};
