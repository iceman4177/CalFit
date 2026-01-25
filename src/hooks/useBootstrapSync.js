// src/hooks/useBootstrapSync.js
import { useEffect, useRef } from 'react';
import { migrateLocalToCloudOneTime } from '../lib/migrateLocalToCloud';
import { flushPending, attachSyncListeners } from '../lib/sync';
import { hydrateTodayTotalsFromCloud } from '../lib/hydrateCloudToLocal';

const SESSION_FLAG_PREFIX = 'bootstrapSync:ranThisSession:';
const HYDRATE_INTERVAL_MS = 25_000; // ✅ keeps PC synced with mobile updates

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
    // Attach listeners once (safe to call multiple times, but avoid stacking)
    if (!listenersAttachedRef.current) {
      try {
        attachSyncListeners?.();
      } catch {}
      listenersAttachedRef.current = true;
    }
  }, []);

  /**
   * ✅ ALWAYS keep device in sync while logged in:
   * - hydrate on focus
   * - hydrate on visibility
   * - hydrate every X seconds (cross-device truth)
   */
  useEffect(() => {
    const userId = user?.id || null;
    if (!userId) return;

    let alive = true;

    const hydrateNow = async (reason = 'unknown') => {
      if (!alive) return;
      if (!shouldHydrateNow()) return;

      try {
        // best-effort flush then pull truth
        await flushPending({ maxTries: 1 });
      } catch {}

      try {
        await hydrateTodayTotalsFromCloud(user, { alsoDispatch: true });
      } catch (e) {
        console.warn(`[useBootstrapSync] hydrate failed (${reason})`, e);
      }
    };

    const onFocus = async () => hydrateNow('focus');

    const onVisibility = async () => {
      if (document.visibilityState !== 'visible') return;
      await hydrateNow('visibility');
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    // ✅ light polling to pick up mobile updates without refresh
    const t = setInterval(() => {
      hydrateNow('interval');
    }, HYDRATE_INTERVAL_MS);

    // ✅ also hydrate once immediately when this effect attaches
    hydrateNow('mount');

    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user?.id]);

  /**
   * ✅ One-time bootstrap per session:
   * - migrate local → cloud
   * - flush queue
   * - hydrate cloud → local caches
   */
  useEffect(() => {
    const userId = user?.id || null;
    if (!userId) return;

    // Prevent multiple runs for the same user during this session/tab
    const sessionKey = `${SESSION_FLAG_PREFIX}${userId}`;
    if (sessionStorage.getItem(sessionKey) === '1') {
      ranForUserRef.current = userId;
      return;
    }

    if (ranForUserRef.current === userId) return;
    ranForUserRef.current = userId;

    (async () => {
      try {
        await migrateLocalToCloudOneTime(user);

        // After bootstrap, try to flush any queued ops quietly
        await flushPending({ maxTries: 2 });

        // ✅ PULL cloud truth into local caches (fixes cross-device totals)
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
    })();
  }, [user?.id]);
}
