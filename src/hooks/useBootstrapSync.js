// src/hooks/useBootstrapSync.js
import { useEffect, useRef } from 'react';
import { migrateLocalToCloudOneTime } from '../lib/migrateLocalToCloud';
import { flushPending, attachSyncListeners } from '../lib/sync';
import { hydrateTodayTotalsFromCloud, hydrateTodayWorkoutsFromCloud } from '../lib/hydrateCloudToLocal';

const SESSION_FLAG_PREFIX = 'bootstrapSync:ranThisSession:';

export default function useBootstrapSync(user) {
  const listenersAttachedRef = useRef(false);
  const ranForUserRef = useRef(null);

  // prevent spam hydrates
  const lastHydrateAtRef = useRef(0);

  function shouldHydrateNow(ms = 3500) {
    const now = Date.now();
    if (now - lastHydrateAtRef.current < ms) return false;
    lastHydrateAtRef.current = now;
    return true;
  }

  useEffect(() => {
    if (!listenersAttachedRef.current) {
      try {
        attachSyncListeners?.();
      } catch {}
      listenersAttachedRef.current = true;
    }
  }, []);

  // ✅ Hydrate on focus/visibility
  useEffect(() => {
    const userId = user?.id || null;
    if (!userId) return;

    const onFocus = async () => {
      if (!shouldHydrateNow()) return;
      try {
        await flushPending({ maxTries: 1 });
      } catch {}
      try {
        await hydrateTodayWorkoutsFromCloud(user, { alsoDispatch: true });
      } catch {}
      try {
        await hydrateTodayTotalsFromCloud(user, { alsoDispatch: true });
      } catch (e) {
        console.warn('[useBootstrapSync] hydrate (focus) failed', e);
      }
    };

    const onVisibility = async () => {
      if (document.visibilityState !== 'visible') return;
      await onFocus();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user?.id]);

  // ✅ IMPORTANT: Poll while logged in so PC updates when you log workouts on mobile
  useEffect(() => {
    const userId = user?.id || null;
    if (!userId) return;

    const t = setInterval(async () => {
      if (!shouldHydrateNow(12000)) return; // throttle
      try {
        await flushPending({ maxTries: 1 });
      } catch {}
      try {
        await hydrateTodayWorkoutsFromCloud(user, { alsoDispatch: true });
      } catch {}
      try {
        await hydrateTodayTotalsFromCloud(user, { alsoDispatch: true });
      } catch {}
    }, 15000);

    return () => clearInterval(t);
  }, [user?.id]);

  // ✅ One-time bootstrap on login
  useEffect(() => {
    if (!user?.id) return;

    // session gating (avoid repeated heavy bootstraps)
    const sessionKey = `${SESSION_FLAG_PREFIX}${user.id}`;
    try {
      const already = sessionStorage.getItem(sessionKey);
      if (already === '1') {
        // Still do a lightweight hydrate on mount
        (async () => {
          try {
            await hydrateTodayWorkoutsFromCloud(user, { alsoDispatch: true });
          } catch {}
          try {
            await hydrateTodayTotalsFromCloud(user, { alsoDispatch: true });
          } catch {}
        })();
        return;
      }
    } catch {}

    // Only run once per user per session
    if (ranForUserRef.current === user.id) return;
    ranForUserRef.current = user.id;

    (async () => {
      try {
        // ✅ Instant banner hydration (before migrate/flush)
        try {
          await hydrateTodayWorkoutsFromCloud(user, { alsoDispatch: true });
        } catch {}
        try {
          await hydrateTodayTotalsFromCloud(user, { alsoDispatch: true });
        } catch {}

        try {
          await migrateLocalToCloudOneTime(user);
          await flushPending({ maxTries: 2 });

          try {
            await hydrateTodayWorkoutsFromCloud(user, { alsoDispatch: true });
          } catch {}

          try {
            await hydrateTodayTotalsFromCloud(user, { alsoDispatch: true });
          } catch (e) {
            console.warn('[useBootstrapSync] hydrateTodayTotalsFromCloud failed', e);
          }
        } finally {
          try {
            sessionStorage.setItem(sessionKey, '1');
          } catch {}
        }
      } catch {}
    })();
  }, [user?.id]);
}
