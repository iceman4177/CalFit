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
  const [h, m] = str.split(':').map(n => parseInt(n, 10));
  return { hour: h, minute: m };
}

export default function useMealReminders() {
  const timers = useRef([]);

  useEffect(() => {
    // 1) Bail if Notifications API isn't supported
    if (!('Notification' in window)) return;

    // 2) Request permission if not decided
    if (Notification.permission === 'default') {
      Notification.requestPermission();
      return;
    }

    // 3) Only schedule if granted
    if (Notification.permission !== 'granted') return;

    // Load preferences or fall back to defaults
    const stored = JSON.parse(localStorage.getItem('mealReminderPrefs') || '{}');
    const prefs = { ...DEFAULT_PREFS, ...stored };
    console.log('Scheduling meal reminders with prefs:', prefs);

    // Schedule one notification for each meal
    Object.entries(prefs).forEach(([meal, timeStr]) => {
      const { hour, minute } = parseTime(timeStr);
      const now = new Date();
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

      // initial schedule
      timers.current.push(setTimeout(handler, delay));
    });

    // Cleanup existing timers on unmount
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, []);
}
