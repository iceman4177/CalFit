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

function normalizeExerciseName(v) {
  return String(v || '').trim().toLowerCase();
}

function getWorkoutExercises(workout) {
  if (Array.isArray(workout?.exercises)) return workout.exercises;
  if (Array.isArray(workout?.items)) return workout.items;
  if (workout?.items && typeof workout.items === 'object' && Array.isArray(workout.items.exercises)) {
    return workout.items.exercises;
  }
  return [];
}

function buildExerciseSignature(workout) {
  const ex = getWorkoutExercises(workout);
  if (!Array.isArray(ex) || ex.length === 0) return '';
  const parts = ex
    .map((item) => {
      const name = normalizeExerciseName(item?.name || item?.exerciseName || item?.exercise_name);
      if (!name) return '';
      const sets = Number(item?.sets || 0) || 0;
      const reps = Number(item?.reps || 0) || 0;
      const weight = Number(item?.weight || 0) || 0;
      const cal = Number(item?.calories || 0) || 0;
      return `${name}|${sets}|${reps}|${weight}|${cal}`;
    })
    .filter(Boolean)
    .sort();
  return parts.join('||');
}

export function getWorkoutDedupKey(workout, fallbackKey = '') {
  const idKey = String(workout?.client_id || workout?.id || '').trim();
  if (idKey) return `id:${idKey}`;

  const sig = buildExerciseSignature(workout);
  const kcal = Math.round(getWorkoutCalories(workout) || 0);
  const started = String(workout?.started_at || workout?.createdAt || workout?.created_at || '').trim();

  if (sig) return `sig:${sig}::kcal:${kcal}`;
  if (started) return `time:${started}::kcal:${kcal}`;
  return String(fallbackKey || '');
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
    const key = getWorkoutDedupKey(w, i);
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
