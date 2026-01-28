// src/hooks/useDailyNotification.js

import { useEffect, useRef } from 'react';

// NOTE: Meal reminders/notifications disabled (testing + UX).
const MEAL_REMINDERS_DISABLED = true;

export default function useDailyNotification({
  hour = 19,
  minute = 0,
  title = 'Slimcal.ai Reminder',
  body = '⏰ Don’t forget to log today’s workout & meals!'
} = {}) {
  const timeoutId = useRef(null);

  useEffect(() => {
    
    if (MEAL_REMINDERS_DISABLED) return;
// 1) Bail if the Notifications API isn't supported
    if (!('Notification' in window)) return;

    // 2) Ask for permission if not already granted/denied
    if (Notification.permission === 'default') {
      Notification.requestPermission();
      return; // wait for next render to possibly schedule
    }

    // 3) Only schedule if permission was granted
    if (Notification.permission === 'granted') {
      const scheduleNext = () => {
        const now = new Date();
        const next = new Date();
        next.setHours(hour, minute, 0, 0);
        // if that time has already passed today, schedule for tomorrow
        if (next <= now) {
          next.setDate(next.getDate() + 1);
        }
        return next.getTime() - now.getTime();
      };

      const trigger = () => {
        new Notification(title, { body });
        // schedule the next one 24h later
        timeoutId.current = setTimeout(trigger, 24 * 60 * 60 * 1000);
      };

      // schedule the first one
      timeoutId.current = setTimeout(trigger, scheduleNext());
    }

    // cleanup on unmount or if hour/minute/title/body change
    return () => clearTimeout(timeoutId.current);
  }, [hour, minute, title, body]);
}