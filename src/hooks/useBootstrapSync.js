// src/hooks/useBootstrapSync.js
import { useEffect, useRef } from 'react';
import { migrateLocalToCloudOneTime } from '../lib/migrateLocalToCloud';
import { flushPending, attachSyncListeners } from '../lib/sync';
import { hydrateTodayTotalsFromCloud } from '../lib/hydrateCloudToLocal';

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
    // Attach listeners once (safe to call multiple times, but avoid stacking)
    if (!listenersAttachedRef.current) {
      try {
        attachSyncListeners?.();
      } catch {}
      listenersAttachedRef.current = true;
    }
  }, []);

  // ✅ Hydrate on focus/visibility so cross-device updates show up
  useEffect(() => {
    const userId = user?.id || null;
    if (!userId) return;

    const onFocus = async () => {
      if (!shouldHydrateNow()) return;
      try {
        // best-effort flush then pull truth
        await flushPending({ maxTries: 1 });
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
  }, [user?.id]); // only reattach when user changes

  useEffect(() => {
    const userId = user?.id || null;
    if (!userId) return;

    // Prevent multiple runs for the same user during this session/tab
    const sessionKey = `${SESSION_FLAG_PREFIX}${userId}`;
    if (sessionStorage.getItem(sessionKey) === '1') {
      ranForUserRef.current = userId;

      // Still do a quick hydrate once on mount if needed (new page load)
      (async () => {
        if (!shouldHydrateNow()) return;
        try {
          await hydrateTodayTotalsFromCloud(user, { alsoDispatch: true });
        } catch {}
      })();

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
