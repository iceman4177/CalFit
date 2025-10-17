// src/exerciseMeta.js

/**
 * MET values drawn primarily from the 2011 Compendium of Physical Activities
 * (Ainsworth et al.), aligned to simple buckets for app stability:
 * - Resistance (moderate): ~3.5 MET
 * - Squat/Leg-press class: ~5.0 MET
 * - Lunges/Step-ups class: ~3.8 MET
 * - Olympic/power variations (vigorous): ~6.0 MET
 * - Crunches/sit-ups: ~2.8 MET
 * Notes: We choose conservative, consistent values to avoid inflated burns.
 */

export const MET_VALUES = {
  // --- Machines (selectorized / guided) ---
  'Chest Press Machine':                 3.5,
  'Pec Fly / Rear Deltoid Machine':      3.5,
  'Shoulder Press Machine':              3.5,
  'Seated Row Machine':                  3.5,
  'Lat Pulldown Machine':                3.5,
  'Cable Crossover/Functional Trainer':  3.5,
  'Assisted Pull-Up/Dip Machine':        3.8,
  'Leg Press Machine':                   5.0,
  'Leg Extension Machine':               3.5,
  'Leg Curl Machine':                    3.5,
  'Abductor Machine (Hip Abduction)':    3.5,
  'Adductor Machine (Hip Adduction)':    3.5,
  'Calf Raise Machine (Seated/Standing)':3.5,
  'Smith Machine Squat':                 5.0,
  'Smith Machine Bench Press':           3.5,
  'Hack Squat Machine':                  5.0,
  'Pullover Machine':                    3.5,
  'Back Extension Machine':              3.5,
  'Abdominal Crunch Machine':            2.8,

  // --- Dumbbells ---
  'Dumbbell Bench Press':                3.5,
  'Incline Dumbbell Bench Press (30°)':  3.8, // slight ROM/stability increase
  'Decline Dumbbell Bench Press':        3.5,
  'Dumbbell Flyes':                      3.5,
  'Dumbbell Shoulder Press':             3.5,
  'Arnold Press':                        3.5,
  'Dumbbell Lateral Raise':              3.5,
  'Dumbbell Front Raise':                3.5,
  'Dumbbell Rear Delt Fly':              3.5,
  'Dumbbell Row (One-Arm)':              3.5,
  'Dumbbell Row (Both-Hands Supported)': 3.5,
  'Dumbbell Shrugs':                     3.5,
  'Dumbbell Bicep Curls':                3.5,
  'Hammer Curls':                        3.5,
  'Concentration Curl':                  3.5,
  'Preacher Curl (DB)':                  3.5,
  'Dumbbell Triceps Extensions':         3.5,
  'Skull Crushers (DB)':                 3.5,
  'Dumbbell Lunges':                     3.8,
  'Dumbbell Bulgarian Split Squat':      3.8,
  'Dumbbell Squats':                     5.0,
  'Dumbbell Romanian Deadlift':          3.5,
  'Dumbbell Deadlifts':                  3.5,
  'Dumbbell Step-Ups':                   3.8,
  'Dumbbell Hip Thrusts':                3.5,
  'Dumbbell Chest-Supported Row':        3.5,

  // --- Barbells ---
  'Barbell Bench Press':                 3.5,
  'Incline Bench Press (30°)':           3.8,
  'Decline Bench Press':                 3.5,
  'Close-Grip Bench Press':              3.5,
  'Overhead Press (Barbell Press)':      3.5,
  'Push Press':                          6.0, // dynamic/power
  'Barbell Upright Row':                 3.5,
  'Barbell Row':                         3.5,
  'Pendlay Row':                         3.5,
  'T-Bar Row (Barbell Landmine)':        3.5,
  'Barbell Shrugs':                      3.5,
  'Barbell Bicep Curls':                 3.5,
  'Barbell Squat':                       5.0,
  'Front Squat':                         5.0,
  'Safety Bar Squat':                    5.0,
  'Barbell Lunge':                       3.8,
  'Barbell Romanian Deadlift':           3.5,
  'Barbell Deadlift':                    3.5,
  'Barbell Hip Thrusts':                 3.5,
  'Barbell Good Morning':                3.5,
  'Barbell Clean and Press / Power Clean': 6.0,
  'Power Clean':                         6.0,
  'Hang Clean':                          6.0,

  // --- Bodyweight / Calisthenics ---
  'Bodyweight Squat':                    5.0,
  'Air Squats (Bodyweight)':             5.0, // alias
  'Push-Ups':                            3.8,
  'Dips (Bodyweight)':                   3.8,
  'Pull-Ups (Bodyweight)':               3.8,
  'Chin-Ups (Bodyweight)':               3.8,
  'Inverted Rows':                       3.5,
  'Hanging Leg Raises':                  3.0,
  'Plank (Standard)':                    3.0,
  'Side Plank':                          3.0,
  'Sit-Ups / Crunches (Floor)':          2.8,
  'Mountain Climbers':                   4.0,
  'Burpees (Calisthenics)':              6.0, // high dynamic effort

  // --- Cables / Bands ---
  'Cable Flyes':                         3.5,
  'Cable Row':                           3.5,
  'Cable Lat Pulldown':                  3.5,
  'Face Pulls (Cable)':                  3.5,
  'Triceps Rope Pushdown':               3.5,
  'Cable Biceps Curl':                   3.5,
  'Cable Lateral Raise':                 3.5,
  'Cable Crunch':                        3.0,
  'Band Pull-Aparts':                    3.0,

  // --- Kettlebell ---
  'Kettlebell Swing':                    6.0, // ballistic/hip hinge, vigorous
  'Kettlebell Goblet Squat':             5.0,
  'Kettlebell Clean & Press':            6.0,
  'Kettlebell Snatch':                   6.0,
  'Kettlebell Row':                      3.5,
  'Kettlebell Lunge':                    3.8,

  // --- Core / Glutes (non-machine) ---
  'Hip Thrust (Bodyweight/Barbell)':     3.5,
  'Glute Bridge (Bodyweight)':           3.0,
  'Russian Twist':                       3.0,
  'Back Extensions (Floor/Roman Chair)': 3.5,
  'Dead Bug':                            3.0,
  'Pallof Press (Cable/Band)':           3.5,
  'Hanging Knee Raises':                 3.0,

  // --- Aliases / common names mapping to existing buckets ---
  'Landmine Press':                      3.5, // similar to OHP pattern
  'Landmine Squat':                      5.0,
  'Farmer’s Carry (DB/Kettlebell)':      3.5,
  'Sled Push/Pull':                      6.0, // vigorous, power-oriented

  // Fallback
  default:                               3.5
};
