// src/hooks/useMealReminders.js

import { useEffect, useRef } from 'react';

// Default reminder times (24h)
const DEFAULT_PREFS = {
  breakfast: '08:00',
  lunch:     '12:00',
  dinner:    '18:00'
};

// Helper: parse "HH:MM" into { hour, minute }
function parseTime(str) {
  // ensure it's a string
  const s = String(str);
  const [h, m] = s.split(':').map(n => parseInt(n, 10));
  return { hour: h, minute: m };
}

export default function useMealReminders() {
  const timers = useRef([]);

  useEffect(() => {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }

    // Load raw prefs (could be object or array)
    const raw = JSON.parse(localStorage.getItem('mealReminderPrefs') || 'null');
    let objPrefs;

    if (Array.isArray(raw)) {
      // new array format → convert to { name: time } object
      objPrefs = raw.reduce((acc, { name, time }) => {
        if (name && time) acc[name] = time;
        return acc;
      }, {});
    } else if (raw && typeof raw === 'object') {
      // legacy object
      objPrefs = raw;
    } else {
      objPrefs = {};
    }

    // Merge with defaults
    const prefs = { ...DEFAULT_PREFS, ...objPrefs };
    console.log('Scheduling meal reminders with prefs:', prefs);

    // Schedule one notification for each meal
    Object.entries(prefs).forEach(([meal, timeStr]) => {
      const { hour, minute } = parseTime(timeStr);
      const now  = new Date();
      const next = new Date();
      next.setHours(hour, minute, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      const delay = next.getTime() - now.getTime();

      const handler = () => {
        new Notification(`Time for ${meal}!`, {
          body: `Don’t forget to log your ${meal} in Slimcal.ai.`,
        });
        // schedule again tomorrow
        timers.current.push(setTimeout(handler, 24 * 60 * 60 * 1000));
      };

      timers.current.push(setTimeout(handler, delay));
    });

    // Cleanup on unmount or prefs change
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, []);
}
