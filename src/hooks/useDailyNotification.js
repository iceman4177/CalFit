import { useEffect, useRef } from 'react';

export default function useDailyNotification({ hour = 19, minute = 0 } = {}) {
  const timeoutId = useRef(null);

  useEffect(() => {
    // 1) Bail if the API isn't supported
    if (!("Notification" in window)) return;

    // 2) Ask for permission if not already granted/denied
    if (Notification.permission === "default") {
      Notification.requestPermission();
      return; // wait until next render to schedule
    }

    // 3) Only schedule if granted
    if (Notification.permission === "granted") {
      // compute next trigger time
      const now = new Date();
      const target = new Date();
      target.setHours(hour, minute, 0, 0);
      if (target <= now) {
        target.setDate(target.getDate() + 1);
      }
      const delay = target.getTime() - now.getTime();

      // schedule it
      timeoutId.current = setTimeout(function trigger() {
        new Notification("Slimcal.ai Reminder", {
          body: "⏰ Don’t forget to log today’s workout & meals!",
        });

        // schedule next day
        timeoutId.current = setTimeout(
          trigger,
          24 * 60 * 60 * 1000 /* 24h */
        );
      }, delay);
    }

    // cleanup on unmount / change
    return () => clearTimeout(timeoutId.current);
  }, [hour, minute]);
}
