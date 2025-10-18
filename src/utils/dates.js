// src/utils/dates.js
// Single source of truth for local-day keys (never UTC parsing)

export function getLocalDayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`; // YYYY-MM-DD in LOCAL time
}

export function parseDayKeyToLocalDate(key) {
  // IMPORTANT: do NOT use new Date(key) which is UTC-parse in JS
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d); // local date
}

// Convert any timestamp (e.g., Supabase created_at) to a local day key
export function dayKeyFromTimestampLocal(ts) {
  return getLocalDayKey(new Date(ts));
}

// Sort helpers
export const sortDayKeysDesc = (a, b) => b.localeCompare(a);
export const sortDayKeysAsc = (a, b) => a.localeCompare(b);
