import { ensureScopedFromLegacy } from './scopedStorage.js';

const AUX_DEFAULTS = {
  diet_preference: 'omnivore',
  training_intent: 'general',
  training_split: 'upper_lower',
  last_focus: 'none',
  equipment_list: JSON.stringify(['Full gym']),
  fitness_goal: '',
  gender: '',
  protein_target_daily_g: '',
  protein_target_meal_g: '',
  calorie_bias: '',
  bmr_est: '',
  tdee_est: '',
  hasCompletedHealthData: 'false',
};

function scopedKey(baseKey, userId) {
  return userId ? `${baseKey}:${userId}` : baseKey;
}

function safeJsonParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function getProfileStorageKeys(userId) {
  return {
    userData: scopedKey('userData', userId),
    gender: scopedKey('gender', userId),
    dietPreference: scopedKey('diet_preference', userId),
    trainingIntent: scopedKey('training_intent', userId),
    trainingSplit: scopedKey('training_split', userId),
    lastFocus: scopedKey('last_focus', userId),
    equipmentList: scopedKey('equipment_list', userId),
    fitnessGoal: scopedKey('fitness_goal', userId),
    proteinTargetDaily: scopedKey('protein_target_daily_g', userId),
    proteinTargetMeal: scopedKey('protein_target_meal_g', userId),
    calorieBias: scopedKey('calorie_bias', userId),
    bmrEst: scopedKey('bmr_est', userId),
    tdeeEst: scopedKey('tdee_est', userId),
    hasCompleted: scopedKey('hasCompletedHealthData', userId),
  };
}

export function ensureScopedProfileFromLegacy(userId) {
  if (!userId) return;
  ensureScopedFromLegacy('userData', userId);
  ensureScopedFromLegacy('gender', userId);
  ensureScopedFromLegacy('diet_preference', userId);
  ensureScopedFromLegacy('training_intent', userId);
  ensureScopedFromLegacy('training_split', userId);
  ensureScopedFromLegacy('last_focus', userId);
  ensureScopedFromLegacy('equipment_list', userId);
  ensureScopedFromLegacy('fitness_goal', userId);
  ensureScopedFromLegacy('protein_target_daily_g', userId);
  ensureScopedFromLegacy('protein_target_meal_g', userId);
  ensureScopedFromLegacy('calorie_bias', userId);
  ensureScopedFromLegacy('bmr_est', userId);
  ensureScopedFromLegacy('tdee_est', userId);
  ensureScopedFromLegacy('hasCompletedHealthData', userId);
}

export function readProfileBundle(userId) {
  const keys = getProfileStorageKeys(userId);
  const userData = safeJsonParse(localStorage.getItem(keys.userData), null)
    || (userId ? null : safeJsonParse(localStorage.getItem('userData'), {}))
    || {};

  return {
    userData,
    dietPreference: localStorage.getItem(keys.dietPreference) || (userId ? '' : localStorage.getItem('diet_preference')) || '',
    trainingIntent: localStorage.getItem(keys.trainingIntent) || (userId ? '' : localStorage.getItem('training_intent')) || '',
    trainingSplit: localStorage.getItem(keys.trainingSplit) || (userId ? '' : localStorage.getItem('training_split')) || '',
    lastFocus: localStorage.getItem(keys.lastFocus) || (userId ? '' : localStorage.getItem('last_focus')) || '',
    equipmentListRaw: localStorage.getItem(keys.equipmentList) || (userId ? '' : localStorage.getItem('equipment_list')) || '',
    fitnessGoal: localStorage.getItem(keys.fitnessGoal) || (userId ? '' : localStorage.getItem('fitness_goal')) || '',
    gender: localStorage.getItem(keys.gender) || userData?.gender || (userId ? '' : localStorage.getItem('gender')) || '',
    hasCompleted: (localStorage.getItem(keys.hasCompleted) || (userId ? '' : localStorage.getItem('hasCompletedHealthData')) || 'false') === 'true',
  };
}

export function writeProfileBundle(userId, enriched = {}) {
  const keys = getProfileStorageKeys(userId);

  localStorage.setItem(keys.userData, JSON.stringify(enriched));
  localStorage.setItem(keys.hasCompleted, 'true');
  localStorage.setItem(keys.dietPreference, enriched.dietPreference || AUX_DEFAULTS.diet_preference);
  localStorage.setItem(keys.trainingIntent, enriched.trainingIntent || AUX_DEFAULTS.training_intent);
  localStorage.setItem(keys.trainingSplit, enriched.trainingSplit || AUX_DEFAULTS.training_split);
  localStorage.setItem(keys.lastFocus, enriched.lastFocus || AUX_DEFAULTS.last_focus);
  localStorage.setItem(keys.equipmentList, JSON.stringify(Array.isArray(enriched.equipment) && enriched.equipment.length ? enriched.equipment : ['Full gym']));
  localStorage.setItem(keys.fitnessGoal, enriched.goalType || '');
  localStorage.setItem(keys.gender, enriched.gender || '');
  localStorage.setItem(keys.proteinTargetDaily, String(enriched?.proteinTargets?.daily_g ?? ''));
  localStorage.setItem(keys.proteinTargetMeal, String(enriched?.proteinTargets?.per_meal_g ?? ''));
  localStorage.setItem(keys.calorieBias, String(enriched?.calorieBias ?? ''));
  if (enriched?.bmr_est != null) localStorage.setItem(keys.bmrEst, String(enriched.bmr_est));
  if (enriched?.tdee_est != null) localStorage.setItem(keys.tdeeEst, String(enriched.tdee_est));
}

export function mirrorProfileToLegacy(userId, enriched = null) {
  const keys = getProfileStorageKeys(userId);
  if (!userId) return;

  if (enriched && Object.keys(enriched).length) {
    localStorage.setItem('userData', JSON.stringify(enriched));
    localStorage.setItem('hasCompletedHealthData', 'true');
    localStorage.setItem('diet_preference', enriched.dietPreference || AUX_DEFAULTS.diet_preference);
    localStorage.setItem('training_intent', enriched.trainingIntent || AUX_DEFAULTS.training_intent);
    localStorage.setItem('training_split', enriched.trainingSplit || AUX_DEFAULTS.training_split);
    localStorage.setItem('last_focus', enriched.lastFocus || AUX_DEFAULTS.last_focus);
    localStorage.setItem('equipment_list', JSON.stringify(Array.isArray(enriched.equipment) && enriched.equipment.length ? enriched.equipment : ['Full gym']));
    localStorage.setItem('fitness_goal', enriched.goalType || '');
    localStorage.setItem('gender', enriched.gender || '');
    localStorage.setItem('protein_target_daily_g', String(enriched?.proteinTargets?.daily_g ?? ''));
    localStorage.setItem('protein_target_meal_g', String(enriched?.proteinTargets?.per_meal_g ?? ''));
    localStorage.setItem('calorie_bias', String(enriched?.calorieBias ?? ''));
    if (enriched?.bmr_est != null) localStorage.setItem('bmr_est', String(enriched.bmr_est));
    if (enriched?.tdee_est != null) localStorage.setItem('tdee_est', String(enriched.tdee_est));
    return;
  }

  localStorage.removeItem('userData');
  localStorage.removeItem('hasCompletedHealthData');
  localStorage.removeItem('diet_preference');
  localStorage.removeItem('training_intent');
  localStorage.removeItem('training_split');
  localStorage.removeItem('last_focus');
  localStorage.removeItem('equipment_list');
  localStorage.removeItem('fitness_goal');
  localStorage.removeItem('gender');
  localStorage.removeItem('protein_target_daily_g');
  localStorage.removeItem('protein_target_meal_g');
  localStorage.removeItem('calorie_bias');
  localStorage.removeItem('bmr_est');
  localStorage.removeItem('tdee_est');

  // If there was no scoped data, do not leave another user's globals behind.
  const scopedUserData = safeJsonParse(localStorage.getItem(keys.userData), null);
  if (scopedUserData && Object.keys(scopedUserData).length) {
    mirrorProfileToLegacy(userId, scopedUserData);
  }
}
