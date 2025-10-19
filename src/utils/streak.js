/**
 * Local-day streak tracker stored under localStorage.userData
 * Keys used:
 *  - userData.lastLogDate       (string, local-day "YYYY-MM-DD")
 *  - userData.currentStreak     (number)
 *  - userData.bestStreak        (number)   // optional quality-of-life metric
 *  - userData.ambassadorPrompted (boolean-like "1")
 *
 * Emits:
 *  - 'slimcal:streak:update' (Event) on any change
 *  - 'slimcal:ambassador:ready' (CustomEvent) once when threshold reached and not yet prompted
 *
 * Public API:
 *  - updateStreak(): number
 *  - getStreak(): number
 *  - getLastLogDate(): string|null
 *  - shouldShowAmbassadorOnce(threshold=30): boolean
 *  - markAmbassadorShown(): void
 */

// ----------------------------- internals ------------------------------------

const EVENT_STREAK = 'slimcal:streak:update';
const EVENT_AMBASSADOR = 'slimcal:ambassador:ready';

function getUserData() {
  try {
    return JSON.parse(localStorage.getItem('userData') || '{}');
  } catch {
    return {};
  }
}
function setUserData(ud) {
  localStorage.setItem('userData', JSON.stringify(ud));
  try {
    window.dispatchEvent(new Event(EVENT_STREAK));
  } catch {
    /* no-op */
  }
}

// Build a local "YYYY-MM-DD" key (stable; matches the rest of the app)
function localDayKey(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()); // local midnight safe
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Parse either ISO ("YYYY-MM-DD") or legacy "M/D/YYYY" into a Date at local midnight
function parseLocalDayString(s) {
  if (!s || typeof s !== 'string') return null;
  if (s.includes('-')) {
    // ISO path
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  }
  if (s.includes('/')) {
    // Legacy "M/D/YYYY"
    const [m, d, y] = s.split('/').map(Number);
    return new Date(y || 0, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  }
  return null;
}

function daysBetweenLocal(aStr, bStr) {
  const a = parseLocalDayString(aStr);
  const b = parseLocalDayString(bStr);
  if (!a || !b) return null;
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 86400000); // 24*60*60*1000
}

// Ensure we store ISO keys going forward; migrate if needed.
function normalizeLastLogDate(ud) {
  const s = ud.lastLogDate;
  if (!s) return ud;
  if (s.includes('-')) return ud; // already ISO

  const dt = parseLocalDayString(s);
  if (!dt) return ud;

  const iso = localDayKey(dt);
  if (iso !== s) {
    ud.lastLogDate = iso;
    setUserData(ud);
  }
  return ud;
}

// Optionally emit ambassador "ready" once (harmless if ignored)
function maybeEmitAmbassadorReady(current) {
  try {
    if (current >= 30) {
      const ud = getUserData();
      if (ud.ambassadorPrompted !== '1') {
        const evt = new CustomEvent(EVENT_AMBASSADOR, { detail: { current } });
        window.dispatchEvent(evt);
      }
    }
  } catch {
    /* no-op */
  }
}

// ----------------------------- public API ------------------------------------

/**
 * updateStreak()
 * - Compares userData.lastLogDate (ISO) vs today (ISO local)
 * - Increments on consecutive day, keeps same if already logged today, resets to 1 if gap >= 2 days
 * - Persists back to userData (also maintains bestStreak)
 * - Dispatches 'slimcal:streak:update'
 * - Returns the updated streak count
 */
export function updateStreak() {
  const todayStr = localDayKey(); // ISO local key
  let ud = getUserData();
  ud = normalizeLastLogDate(ud); // migrate legacy format if present

  const last = ud.lastLogDate;
  let newStreak = 1;

  if (last) {
    if (last === todayStr) {
      // Already logged today → no change
      newStreak = Number(ud.currentStreak || 1);
    } else {
      const gap = daysBetweenLocal(last, todayStr);
      if (gap === 1) {
        newStreak = Number(ud.currentStreak || 0) + 1; // consecutive
      } else if (gap > 1) {
        newStreak = 1; // missed ≥ 1 full day
      } else {
        // gap can be 0 (should have matched above) or negative (clock moved back); keep safe
        newStreak = Math.max(1, Number(ud.currentStreak || 1));
      }
    }
  }

  ud.lastLogDate = todayStr;
  ud.currentStreak = newStreak;
  ud.bestStreak = Math.max(Number(ud.bestStreak || 0), newStreak);
  setUserData(ud);

  // Optionally let the app open AmbassadorModal automatically if desired
  maybeEmitAmbassadorReady(newStreak);

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
 * - Returns lastLogDate string (ISO local "YYYY-MM-DD") or null
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
 * - Sets ambassadorPrompted flag and emits streak update for any listeners
 */
export function markAmbassadorShown() {
  const ud = getUserData();
  ud.ambassadorPrompted = '1';
  setUserData(ud);
}
