// src/utils/cals.js
// Local-only calorie estimator (no network). Uses simple MET defaults.
// If your exercise objects already carry `calories`, we prefer those.
// Otherwise we estimate from MET × body weight × duration.

const MET_TABLE = {
  // Strength-ish
  'Bench': 6.0,
  'Bench Press': 6.0,
  'Chest Press Machine': 3.5,
  'Squat': 5.5,
  'Deadlift': 6.0,
  'Row': 7.0,
  'Lat Pulldown': 3.5,
  'Bicep Curl': 3.0,
  'Tricep Pushdown': 3.0,

  // Cardio examples
  'Running': 9.8,
  'Treadmill': 8.0,
  'Cycling': 7.5,
  'Elliptical': 5.0,
};

function toKg(weight) {
  if (!weight) return 77.1; // ~170 lb default
  const n = Number(weight);
  if (!Number.isFinite(n) || n <= 0) return 77.1;
  // If > 140 assume pounds, else assume kg
  return n > 140 ? n * 0.453592 : n;
}

function estimateDurationMin(ex) {
  // If duration exists, use it; otherwise estimate ~2s/rep, 3s/set padding
  if (Number.isFinite(Number(ex.durationMin)) && Number(ex.durationMin) > 0) {
    return Number(ex.durationMin);
  }
  const sets = Number(ex.sets) || 1;
  const reps = Number(ex.reps) || 10;
  const sec = sets * reps * 2 + sets * 3;
  return Math.max(sec / 60, 0.5); // at least 0.5 min
}

export function estimateExerciseCalories(ex, userData) {
  // Prefer explicit calories if provided
  const c = Number(ex.calories);
  if (Number.isFinite(c) && c > 0) return c;

  const weightKg =
    toKg(userData?.weightKg) ||
    toKg(userData?.weight) ||
    toKg(userData?.weightLbs);

  const name = (ex.name || '').trim();
  const met = MET_TABLE[name] || 3.5;  // safe default MET
  const minutes = estimateDurationMin(ex);

  // kcal/min = (MET × 3.5 × kg) / 200
  return (met * 3.5 * weightKg / 200) * minutes;
}

export function calcWorkoutCalories(exercises = [], userData) {
  return exercises.reduce((sum, ex) => sum + estimateExerciseCalories(ex, userData), 0);
}
