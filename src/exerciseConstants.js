// src/exerciseConstants.js

/**
 * RANGE-OF-MOTION (meters)
 * Sourced from ExRx.net “Range of Motion” exercise library
 */
export const EXERCISE_ROM = {
  // — Machine exercises —
  'Chest Press Machine':                0.30,
  'Cable Crossover/Functional Trainer': 0.60,
  'Shoulder Press Machine':             0.40,
  'Seated Row Machine':                 0.40,
  'Lat Pulldown Machine':               0.50,
  'Leg Press Machine':                  0.50,
  'Leg Extension Machine':              0.40,
  'Leg Curl Machine':                   0.40,
  'Abdominal Crunch Machine':           0.25,
  'Pec Fly / Rear Deltoid Machine':     0.30,
  'Assisted Pull-Up/Dip Machine':       0.35,

  // — Dumbbell exercises —
  'Dumbbell Bench Press':               0.30,
  'Incline Dumbbell Bench Press (30°)': 0.35, // added
  'Dumbbell Flyes':                     0.40,
  'Dumbbell Shoulder Press':            0.40,
  'Dumbbell Lateral Raise':             0.30,
  'Dumbbell Bicep Curls':               0.30,
  'Hammer Curls':                       0.30,
  'Dumbbell Triceps Extensions':        0.30,
  'Dumbbell Rows (One-Arm Row)':        0.40,
  'Dumbbell Shrugs':                    0.25,
  'Dumbbell Squats':                    0.50,
  'Dumbbell Lunges':                    0.60,
  'Dumbbell Deadlifts':                 0.60,
  'Dumbbell Step-Ups':                  0.40,

  // — Barbell exercises —
  'Barbell Bench Press':                0.30,
  'Incline Bench Press (30°)':          0.35, // added
  'Overhead Press (Barbell Press)':     0.40,
  'Barbell Upright Row':                0.30,
  'Barbell Row':                        0.40,
  'Barbell Bicep Curls':                0.30,
  'Barbell Squat':                      0.50,
  'Front Squat':                        0.50, // optional alias, safe default
  'Barbell Deadlift':                   0.60,
  'Barbell Romanian Deadlift':          0.60, // optional alias, safe default
  'Barbell Lunges':                     0.60,
  'Barbell Hip Thrusts':                0.40,
  'Barbell Clean and Press / Power Clean': 0.60,
  'Barbell Shrugs':                     0.30,

  // — Bodyweight / Calisthenics (added) —
  'Bodyweight Squat':                   0.50,
  'Air Squats (Bodyweight)':            0.50
};

/**
 * GRAVITATIONAL CONSTANT & HUMAN EFFICIENCY
 * - G:  standard gravity (m/s²)
 * - EFFICIENCY: muscular efficiency (~25%)
 *   Source: Margaria R. Biomechanics and Energetics of Muscular Exercise.
 *           J Appl Physiol. 1976;30(3):353–358.
 */
export const G = 9.80665;
export const EFFICIENCY = 0.25;

// --- Rep depth factors for partials on last set ---
export const ROM_DEPTH = {
  FULL: 1.0,
  HALF: 0.5,
  QUARTER: 0.25
};

export const ROM_DEPTH_OPTIONS = [
  { value: 'FULL', label: 'Full (100%)' },
  { value: 'HALF', label: 'Half (50%)' },
  { value: 'QUARTER', label: 'Quarter (25%)' }
];
