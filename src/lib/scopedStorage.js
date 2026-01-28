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

export function ensureScopedFromLegacy(base, userId) {
  // If legacy unscoped data exists, move it into the scoped key for the
  // currently logged-in user (best-effort). This prevents cross-account bleed.
  if (!userId) return;
  try {
    const scoped = scopedKey(base, userId);
    const hasScoped = localStorage.getItem(scoped) != null;
    const legacy = localStorage.getItem(base);
    if (!hasScoped && legacy != null) {
      localStorage.setItem(scoped, legacy);
      localStorage.removeItem(base);
    }
  } catch {}
}

export const KEYS = {
  mealHistory: 'mealHistory',
  workoutHistory: 'workoutHistory',
  dailyMetricsCache: 'dailyMetricsCache',
};
