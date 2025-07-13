// src/hooks/useMealReminders.js
import { useEffect, useRef } from 'react';

// Default reminder times (24h)
const DEFAULT_PREFS = {
  breakfast: '08:00',
  lunch:     '12:00',
  dinner:    '18:00'
};

// Parse "HH:MM" → { hour, minute }
function parseTime(str) {
  const [h, m] = String(str).split(':').map(n => parseInt(n, 10));
  return { hour: h, minute: m };
}

export default function useMealReminders() {
  const timers = useRef([]);

  useEffect(() => {
    if (!('Notification' in window)) return;

    const scheduleReminders = () => {
      // clear any existing timers
      timers.current.forEach(clearTimeout);
      timers.current = [];

      // load raw prefs (array or object)
      const raw = JSON.parse(localStorage.getItem('mealReminderPrefs') || 'null');
      let objPrefs = {};

      if (Array.isArray(raw)) {
        raw.forEach(({ name, time }) => {
          if (name && time) objPrefs[name] = time;
        });
      } else if (raw && typeof raw === 'object') {
        objPrefs = raw;
      }

      const prefs = { ...DEFAULT_PREFS, ...objPrefs };

      Object.entries(prefs).forEach(([meal, timeStr]) => {
        const { hour, minute } = parseTime(timeStr);
        const now  = new Date();
        const next = new Date();
        next.setHours(hour, minute, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);
        const delay = next.getTime() - now.getTime();

        const handler = () => {
          new Notification(`Time for ${meal}!`, {
            body: `Don’t forget to log your ${meal} in Slimcal.ai.`
          });
          // schedule again in 24h
          timers.current.push(setTimeout(handler, 24 * 60 * 60 * 1000));
        };

        timers.current.push(setTimeout(handler, delay));
      });
    };

    if (Notification.permission === 'granted') {
      scheduleReminders();
    } else if (Notification.permission === 'default') {
      // wait for user to grant
      const onChange = () => {
        if (Notification.permission === 'granted') {
          window.removeEventListener('permissionchange', onChange);
          scheduleReminders();
        }
      };
      window.addEventListener('permissionchange', onChange);
      return () => window.removeEventListener('permissionchange', onChange);
    }
  }, []);

  // cleanup timers on unmount
  useEffect(() => {
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, []);
}
