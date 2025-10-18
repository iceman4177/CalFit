// src/utils/streak.js

/**
 * Local-day streak tracker stored under localStorage.userData
 * Keys used:
 *  - userData.lastLogDate   (string, local-day)
 *  - userData.currentStreak (number)
 *  - userData.ambassadorPrompted (boolean-like "1")
 *
 * Emits:
 *  - 'slimcal:streak:update' on any change
 */

const LOCALE = 'en-US';
const EVENT_NAME = 'slimcal:streak:update';

function getUserData() {
  try {
    return JSON.parse(localStorage.getItem('userData') || '{}');
  } catch {
    return {};
  }
}
function setUserData(ud) {
  localStorage.setItem('userData', JSON.stringify(ud));
}

function localDay(d = new Date()) {
  // Keep consistent with your existing storage format
  return d.toLocaleDateString(LOCALE);
}

function isYesterdayString(lastStr) {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return lastStr === localDay(y);
}

/**
 * updateStreak()
 * - Checks userData.lastLogDate vs today (local day)
 * - Increments on consecutive day, keeps same if already logged today, resets to 1 if gap >= 2 days
 * - Persists back to userData
 * - Dispatches 'slimcal:streak:update'
 * - Returns the updated streak count
 */
export function updateStreak() {
  const todayStr = localDay();
  const ud = getUserData();
  const last = ud.lastLogDate;
  let newStreak = 1;

  if (last) {
    if (last === todayStr) {
      // Already logged today → no change
      newStreak = ud.currentStreak || 1;
    } else if (isYesterdayString(last)) {
      // Consecutive day
      newStreak = (ud.currentStreak || 0) + 1;
    } else {
      // Missed ≥ 1 full day → reset to 1
      newStreak = 1;
    }
  }

  ud.lastLogDate = todayStr;
  ud.currentStreak = newStreak;
  setUserData(ud);

  // Notify any listeners (e.g., Ambassador controller, badges)
  try {
    window.dispatchEvent(new Event(EVENT_NAME));
  } catch {
    /* no-op in non-browser contexts */
  }

  return newStreak;
}

/**
 * getStreak()
 * - Reads currentStreak from userData
 * - Returns 0 if not set
 */
export function getStreak() {
  const ud = getUserData();
  return Number(ud.currentStreak || 0);
}

/**
 * getLastLogDate()
 * - Returns lastLogDate string (local day) or null
 */
export function getLastLogDate() {
  const ud = getUserData();
  return ud.lastLogDate || null;
}

/**
 * shouldShowAmbassadorOnce(threshold = 30)
 * - True if streak >= threshold and ambassadorPrompted flag is not set
 */
export function shouldShowAmbassadorOnce(threshold = 30) {
  const ud = getUserData();
  const streak = Number(ud.currentStreak || 0);
  const prompted = ud.ambassadorPrompted === '1';
  return streak >= threshold && !prompted;
}

/**
 * markAmbassadorShown()
 * - Sets ambassadorPrompted flag
 */
export function markAmbassadorShown() {
  const ud = getUserData();
  ud.ambassadorPrompted = '1';
  setUserData(ud);
  try {
    window.dispatchEvent(new Event(EVENT_NAME));
  } catch {}
}
