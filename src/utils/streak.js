// src/utils/streak.js

/**
 * updateStreak()
 * - Checks localStorage.userData.lastLogDate vs today
 * - Increments or resets the currentStreak
 * - Persists lastLogDate & currentStreak back to userData
 * - Returns the updated streak count
 */
export function updateStreak() {
    const today = new Date().toLocaleDateString('en-US');
    const ud = JSON.parse(localStorage.getItem('userData') || '{}');
    const last = ud.lastLogDate;
    let newStreak = 1;
  
    if (last) {
      const lastDate = new Date(last);
      const todayDate = new Date(today);
      const diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));
  
      if (diffDays === 1) {
        newStreak = (ud.currentStreak || 0) + 1;
      } else if (diffDays === 0) {
        // already logged today
        newStreak = ud.currentStreak || 1;
      }
    }
  
    ud.lastLogDate = today;
    ud.currentStreak = newStreak;
    localStorage.setItem('userData', JSON.stringify(ud));
    return newStreak;
  }
  
  /**
   * getStreak()
   * - Reads currentStreak from localStorage.userData
   * - Returns 0 if not set
   */
  export function getStreak() {
    const ud = JSON.parse(localStorage.getItem('userData') || '{}');
    return ud.currentStreak || 0;
  }
  