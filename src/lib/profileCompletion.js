import { readProfileBundle } from './profileStorage';

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function getMinimumProfileStatusFromData(userData = {}) {
  const totalHeightInches = toNum(userData?.height?.feet) * 12 + toNum(userData?.height?.inches);
  const checks = {
    age: toNum(userData?.age) >= 13,
    gender: !!String(userData?.gender || '').trim(),
    weight: toNum(userData?.weight) > 0,
    height: totalHeightInches > 0,
    activityLevel: !!String(userData?.activityLevel || '').trim(),
    dailyGoal: toNum(userData?.dailyGoal) > 0,
    goalType: !!String(userData?.goalType || '').trim(),
  };

  const completedCount = Object.values(checks).filter(Boolean).length;

  return {
    isComplete: completedCount === Object.keys(checks).length,
    completedCount,
    totalCount: Object.keys(checks).length,
    checks,
  };
}

export function getMinimumProfileStatus(userId = null) {
  const bundle = readProfileBundle(userId);
  return getMinimumProfileStatusFromData(bundle?.userData || {});
}
