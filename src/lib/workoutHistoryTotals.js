import { readScopedJSON, writeScopedJSON, KEYS } from './scopedStorage.js';

export const VISIBLE_WORKOUT_ROWS_KEY = 'workoutHistoryVisibleRows';

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
      workout?.status === 'draft' ||
      workout?.__draft === true
  );
}

export function getWorkoutDedupKey(workout, fallback = '') {
  const explicit = workout?.client_id || workout?.id || workout?.workout_id || workout?.session_id;
  if (explicit) return String(explicit);

  const dayISO = dayISOFromAny(
    workout?.local_day ||
      workout?.__local_day ||
      workout?.day ||
      workout?.date ||
      workout?.started_at ||
      workout?.createdAt ||
      workout?.created_at
  ) || 'unknown-day';

  const kcal = Math.round(getWorkoutCalories(workout));
  const exercises = Array.isArray(workout?.exercisesForShare)
    ? workout.exercisesForShare
    : Array.isArray(workout?.items?.exercises)
      ? workout.items.exercises
      : Array.isArray(workout?.exercises)
        ? workout.exercises
        : [];

  const names = exercises
    .map((ex) => String(ex?.exerciseName || ex?.name || ex?.exercise_name || '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8)
    .join('|');

  return `${dayISO}::${kcal}::${names || fallback}`;
}

export function readWorkoutHistoryLocal(userId) {
  const raw = readScopedJSON(KEYS.workoutHistory, userId, []);
  return Array.isArray(raw) ? raw : [];
}

export function readVisibleWorkoutRows(userId) {
  const raw = readScopedJSON(VISIBLE_WORKOUT_ROWS_KEY, userId, []);
  return Array.isArray(raw) ? raw : [];
}

export function writeVisibleWorkoutRows(userId, rows) {
  try {
    writeScopedJSON(VISIBLE_WORKOUT_ROWS_KEY, userId, Array.isArray(rows) ? rows : []);
  } catch {}
}

export function buildWorkoutBurnedTotalsByDay(userId) {
  const visibleRows = readVisibleWorkoutRows(userId);
  const source = visibleRows.length ? visibleRows : readWorkoutHistoryLocal(userId);
  const byDay = new Map();

  const put = (dayISO, key, calories) => {
    if (!dayISO || !calories) return;
    const m = byDay.get(dayISO) || new Map();
    const prev = Number(m.get(key) || 0);
    m.set(key, Math.max(prev, Number(calories) || 0));
    byDay.set(dayISO, m);
  };

  for (let i = 0; i < source.length; i += 1) {
    const w = source[i] || {};
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
    const key = getWorkoutDedupKey(w, String(i));
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
