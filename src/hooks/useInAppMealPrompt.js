// src/hooks/useInAppMealPrompt.js
import { useEffect, useState } from 'react';

// NOTE: Meal reminders/notifications disabled (testing + UX).
const MEAL_REMINDERS_DISABLED = true;

// Default times if user hasn’t set preferences
const DEFAULT_PREFS = {
  breakfast: '08:00',
  lunch:     '12:00',
  dinner:    '18:00'
};

export default function useInAppMealPrompt() {
  const [missedMeals, setMissedMeals] = useState([]);

  useEffect(() => {
    
    if (MEAL_REMINDERS_DISABLED) return;
const now       = new Date();
    const todayKey  = now.toLocaleDateString('en-US');
    const history   = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    const todayRec  = history.find(m => m.date === todayKey);
    const loggedSet = new Set((todayRec?.meals || []).map(m => m.type));

    // load prefs
    const raw = JSON.parse(localStorage.getItem('mealReminderPrefs') || 'null');
    let prefs = { ...DEFAULT_PREFS };
    if (Array.isArray(raw)) {
      raw.forEach(({ name, time }) => { if (name && time) prefs[name] = time; });
    } else if (raw && typeof raw === 'object') {
      prefs = { ...prefs, ...raw };
    }

    const toRemind = [];
    Object.entries(prefs).forEach(([meal, timeStr]) => {
      const [h, m] = timeStr.split(':').map(n => parseInt(n, 10));
      const mealTime = new Date(now);
      mealTime.setHours(h, m, 0, 0);

      if (mealTime <= now && !loggedSet.has(meal)) {
        toRemind.push(meal);
      }
    });

    setMissedMeals(toRemind);
  }, []);

  return missedMeals;
}