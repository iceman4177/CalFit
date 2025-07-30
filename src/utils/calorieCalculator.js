// src/utils/calorieCalculator.js

import { MET_VALUES } from '../exerciseMeta';
import { EXERCISE_ROM, G, EFFICIENCY } from '../exerciseConstants';

/**
 * Estimate calories for a single exercise, given:
 *  - exercise.exerciseType: 'cardio' | 'strength'
 *  - exercise.exerciseName: string
 *  - exercise.weight: number (lbs)
 *  - exercise.sets: number
 *  - exercise.reps: number
 *  - exercise.concentricTime, eccentricTime: seconds
 *  - exercise.manualCalories: number (for cardio)
 * @param {{...}} exercise
 * @param {{weight: string}} userData
 * @returns {number}
 */
export function estimateCalories(exercise, userData) {
  if (exercise.exerciseType === 'cardio') {
    return Number(exercise.manualCalories) || 0;
  }

  const bwLbs = parseFloat(userData.weight) || 0;
  const reps  = parseInt(exercise.reps, 10) || 0;
  const sets  = parseInt(exercise.sets, 10) || 1;
  const key   = exercise.exerciseName;

  const concSec  = parseFloat(exercise.concentricTime) || 2;
  const eccSec   = parseFloat(exercise.eccentricTime)  || 2;
  const activeMin = (reps * sets * (concSec + eccSec)) / 60;

  const met     = MET_VALUES[key] ?? MET_VALUES.default;
  const bodyKg  = bwLbs * 0.453592;
  const metCals = met * bodyKg * activeMin;

  const loadKg  = (parseFloat(exercise.weight) || 0) * 0.453592;
  const rom     = EXERCISE_ROM[key] ?? 0.5;
  const workJ   = loadKg * G * rom * reps * sets;
  const mechCals= workJ / (4184 * EFFICIENCY);

  return metCals + mechCals;
}
