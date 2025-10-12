// src/analytics.js
import ReactGA from 'react-ga4';

// Replace with your actual GA4 Measurement ID
export function initGA() {
  ReactGA.initialize('G-0PBM0SW18X');
}

// Log a page view event to GA4
export function logPageView(page) {
  ReactGA.send({ hitType: 'pageview', page });
}

/* --------------------------- Hybrid Calc Helpers --------------------------- */
/**
 * Proprietary Hybrid “Mechanical + Physiological” Calorie‐burn:
 * total_kcal = MET_kcal + Mechanical_kcal
 * MET_kcal = MET * bodyKg * activeMinutes
 * Mechanical_kcal = (m(kg) * g * ROM(m) * reps*sets) / (4184 * EFFICIENCY)
 * Tempo-aware active time; intent-aware defaults & MET scaling.
 */

export const EFFICIENCY = 0.20; // typical muscular efficiency (0.20–0.25)
export const G = 9.81;          // gravity

// Intent → default tempo [concentric, isometric, eccentric] and small MET bias
const INTENT_PROFILES = {
  bodybuilder:   { defaultTempo: [2, 1, 3], metFactor: 1.00 }, // slower eccentrics for hypertrophy
  powerlifter:   { defaultTempo: [1, 0, 2], metFactor: 1.05 }, // brief reps, higher peak effort/bracing
  endurance:     { defaultTempo: [2, 1, 2], metFactor: 1.10 }, // more sustained metabolic demand
  yoga_pilates:  { defaultTempo: [3, 1, 3], metFactor: 0.90 }, // lower global intensity
  general:       { defaultTempo: [2, 1, 2], metFactor: 1.00 },
};

function getIntentProfile(intent) {
  const key = String(intent || 'general').toLowerCase();
  return INTENT_PROFILES[key] || INTENT_PROFILES.general;
}

// Parse "8-12" → 12; "10" → 10
function parseReps(reps) {
  if (typeof reps === 'string' && reps.includes('-')) {
    const [a, b] = reps.split('-').map((x) => parseInt(x, 10));
    return Number.isFinite(b) ? b : (Number.isFinite(a) ? a : 0);
  }
  const n = parseInt(reps, 10);
  return Number.isFinite(n) ? n : 0;
}

// Parse tempo with intent-aware fallback
function parseTempoSeconds(tempo, conc, ecc, intentProfile) {
  // If an explicit tempo string exists (e.g., "2-1-2"), respect it.
  if (tempo && typeof tempo === 'string') {
    const parts = tempo.split(/[-–—x]/).map(s => parseFloat(s) || 0);
    if (parts.length === 3) {
      const [c, i, e] = parts;
      const sum = c + i + e;
      if (sum > 0) return sum;
    }
  }

  // Otherwise, build from provided phases or intent defaults
  const prof = intentProfile || INTENT_PROFILES.general;
  const c = Number(conc);
  const e = Number(ecc);
  const [dc, di, de] = prof.defaultTempo;

  const C = Number.isFinite(c) && c > 0 ? c : dc;
  const E = Number.isFinite(e) && e > 0 ? e : de;
  const I = di;

  return C + I + E; // seconds per rep
}

// Fuzzy MET lookup so different lifts get different intensities
export function metForExercise(name, MET_VALUES) {
  if (!name) return MET_VALUES?.default ?? 6.0;
  if (MET_VALUES?.[name]) return MET_VALUES[name];

  const n = String(name).toLowerCase();
  const tokenMap = [
    [/deadlift/, 7.0],
    [/squat|front squat|back squat/, 6.5],
    [/bench|incline/, 6.0],
    [/overhead press|shoulder press|press\b/, 6.0],
    [/row(?!ing)|seated row|barbell row/, 5.5],
    [/pulldown|pull-down|lat pull/, 5.5],
    [/fly|cable fly/, 5.5],
    [/lunge|split squat/, 6.0],
    [/curl/, 5.0],
    [/triceps|pressdown|extension/, 5.0],
    [/lateral raise/, 5.0],
    [/kettlebell|swing/, 6.5],
    [/rowing machine|rower/, 7.0],
    [/bike|cycling/, 7.0],
    [/jump rope/, 11.8],
    [/plank|core/, 3.0],
    [/yoga|pilates/, 3.0],
    [/push-up|push up/, 4.0],
    [/pull-up|pull up/, 5.0],
  ];

  for (const [re, val] of tokenMap) {
    if (re.test(n)) return val;
  }
  return MET_VALUES?.default ?? 6.0;
}

/** Primary calculator: Hybrid MET + Mechanical Work (intent-aware)
 * entry: { exerciseName|name|exercise, sets, reps, tempo?, concentricTime?, eccentricTime?, weight }
 * user:  { weight (lbs) }
 * tables: { MET_VALUES, EXERCISE_ROM }
 * intent: 'bodybuilder' | 'powerlifter' | 'endurance' | 'yoga_pilates' | 'general'
 */
export function calcExerciseCaloriesHybrid(entry, user, tables, intent = 'general') {
  const { MET_VALUES, EXERCISE_ROM } = tables || {};
  const profile = getIntentProfile(intent);

  const bodyLbs = Number(user?.weight) || Number(user?.weight_lbs) || 0;
  const bodyKg  = bodyLbs > 0 ? bodyLbs * 0.453592 : 80; // default 80 kg
  const sets    = parseInt(entry?.sets,10) || 1;
  const reps    = parseReps(entry?.reps);

  // Intent-aware tempo fallback if none explicitly set
  const tempoS  = parseTempoSeconds(
    entry?.tempo,
    entry?.concentricTime,
    entry?.eccentricTime,
    profile
  );

  // 1) MET component with intent factor
  const baseMet = metForExercise(entry?.exerciseName || entry?.name || entry?.exercise, MET_VALUES);
  const met     = baseMet * profile.metFactor;
  const activeMin = (sets * reps * tempoS) / 60;
  const metCals = met * bodyKg * activeMin;            // (kcal)

  // 2) Mechanical-work component (physics-based)
  const loadKg  = (Number(entry?.weight) || 0) * 0.453592;
  const rom     = EXERCISE_ROM?.[entry?.exerciseName] ?? EXERCISE_ROM?.[entry?.name] ?? 0.5; // meters
  const workJ   = loadKg * G * rom * (sets * reps);    // Joules
  const mechCals= workJ / (4184 * EFFICIENCY);         // kcal

  const total   = metCals + mechCals;
  return Number.isFinite(total) && total > 0 ? total : 0;
}
