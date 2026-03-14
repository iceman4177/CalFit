import { readScopedJSON, KEYS } from './scopedStorage.js';

export function localDayISO(d = new Date()) {
  try {
    const ld = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return ld.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function dayISOFromAny(v) {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) return localDayISO(dt);
  return null;
}

export function safeNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function getWorkoutCalories(workout) {
  return safeNum(
    workout?.total_calories ??
      workout?.totalCalories ??
      workout?.calories_burned ??
      workout?.calories ??
      workout?.burned,
    0
  );
}

export function isDraftWorkout(workout) {
  return Boolean(
    workout?.isDraft ||
      workout?.draft === true ||
      workout?.status === 'draft'
  );
}

export function readWorkoutHistoryLocal(userId) {
  const raw = readScopedJSON(KEYS.workoutHistory, userId, []);
  return Array.isArray(raw) ? raw : [];
}

export function buildWorkoutBurnedTotalsByDay(userId) {
  const wh = readWorkoutHistoryLocal(userId);
  const byDay = new Map();

  const put = (dayISO, key, calories) => {
    if (!dayISO || !calories) return;
    const m = byDay.get(dayISO) || new Map();
    const prev = Number(m.get(key) || 0);
    m.set(key, Math.max(prev, Number(calories) || 0));
    byDay.set(dayISO, m);
  };

  for (let i = 0; i < wh.length; i += 1) {
    const w = wh[i] || {};
    const dayISO = dayISOFromAny(
      w?.local_day ||
        w?.__local_day ||
        w?.day ||
        w?.date ||
        w?.started_at ||
        w?.createdAt ||
        w?.created_at
    );
    if (!dayISO) continue;
    if (isDraftWorkout(w)) continue;

    const kcal = getWorkoutCalories(w);
    const key = String(w?.client_id || w?.id || i);
    put(dayISO, key, kcal);
  }

  const totals = new Map();
  for (const [dayISO, m] of byDay.entries()) {
    let sum = 0;
    for (const v of m.values()) sum += Number(v) || 0;
    totals.set(dayISO, sum);
  }
  return totals;
}

export function getTodayBurnedFromWorkoutHistory(userId, dayISO = localDayISO()) {
  const totals = buildWorkoutBurnedTotalsByDay(userId);
  return Number(totals.get(dayISO) || 0);
}
