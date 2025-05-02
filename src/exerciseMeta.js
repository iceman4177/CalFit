// src/exerciseMeta.js

/**
 * MET values drawn from the 2011 Compendium of Physical Activities:
 * Ainsworth BE, Haskell WL, Herrmann SD, et al.
 * “2011 Compendium of Physical Activities: a second update of codes and MET values.”
 * Medicine & Science in Sports & Exercise. 2011;43(8):1575–1581.
 * PDF reference: /mnt/data/2011 Compendium of Physical Activities.pdf
 *   – see pp.1575–1584 for codes and METs
 */

export const MET_VALUES = {
    // — Machine exercises —
    'Chest Press Machine':              3.5,  // generic resistance training, 8–15 reps contentReference[oaicite:2]contentReference[oaicite:3]
    'Cable Crossover/Functional Trainer': 3.5,  
    'Shoulder Press Machine':           3.5,  
    'Seated Row Machine':               3.5,  
    'Lat Pulldown Machine':             3.5,  
    'Leg Press Machine':                5.0,  // analogous to squats contentReference[oaicite:4]contentReference[oaicite:5]
    'Leg Extension Machine':            3.5,  
    'Leg Curl Machine':                 3.5,  
    'Abdominal Crunch Machine':         2.8,  // sit-ups/crunches contentReference[oaicite:6]contentReference[oaicite:7]
    'Pec Fly / Rear Deltoid Machine':   3.5,  
    'Assisted Pull-Up/Dip Machine':     3.8,  // pull-ups (moderate effort) contentReference[oaicite:8]contentReference[oaicite:9]
  
    // — Dumbbell exercises —
    'Dumbbell Bench Press':             3.5,  
    'Dumbbell Flyes':                   3.5,  
    'Dumbbell Shoulder Press':          3.5,  
    'Dumbbell Lateral Raise':           3.5,  
    'Dumbbell Bicep Curls':             3.5,  
    'Hammer Curls':                     3.5,  
    'Dumbbell Triceps Extensions':      3.5,  
    'Dumbbell Rows (One-Arm Row)':      3.5,  
    'Dumbbell Shrugs':                  3.5,  
    'Dumbbell Squats':                  5.0,  // squats contentReference[oaicite:10]contentReference[oaicite:11]
    'Dumbbell Lunges':                  3.8,  // lunges contentReference[oaicite:12]contentReference[oaicite:13]
    'Dumbbell Deadlifts':               3.5,  
    'Dumbbell Step-Ups':                3.5,  
  
    // — Barbell exercises —
    'Barbell Bench Press':              3.5,  
    'Overhead Press (Barbell Press)':   3.5,  
    'Barbell Upright Row':              3.5,  
    'Barbell Row':                      3.5,  
    'Barbell Bicep Curls':              3.5,  
    'Barbell Squat':                    5.0,  // squats contentReference[oaicite:14]contentReference[oaicite:15]
    'Barbell Deadlift':                 3.5,  
    'Barbell Lunges':                   3.8,  // lunges contentReference[oaicite:16]contentReference[oaicite:17]
    'Barbell Hip Thrusts':              3.5,  
    'Barbell Clean and Press / Power Clean': 6.0,  // power clean contentReference[oaicite:18]contentReference[oaicite:19]
    'Barbell Shrugs':                   3.5,  
  
    // Fallback for anything we miss
    default:                            3.5   // general resistance training contentReference[oaicite:20]
  };
  