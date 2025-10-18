// src/utils/dates.js
// Single source of truth for LOCAL day keys (prevents UTC drift)

export function getLocalDayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`; // YYYY-MM-DD (LOCAL)
}

export function parseDayKeyToLocalDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d); // LOCAL date (avoid new Date(key) which is UTC)
}

export const sortDayKeysDesc = (a, b) => b.localeCompare(a);
export const sortDayKeysAsc = (a, b) => a.localeCompare(b);
