// src/hooks/useBootstrapSync.js
import { useEffect, useRef } from 'react';
import { migrateLocalToCloudOneTime } from '../lib/migrateLocalToCloud';
import { flushPending, attachSyncListeners } from '../lib/sync';
import { hydrateTodayTotalsFromCloud } from '../lib/hydrateCloudToLocal';
import { supabase } from '../lib/supabaseClient';

const SESSION_FLAG_PREFIX = 'bootstrapSync:ranThisSession:';
const HYDRATE_INTERVAL_MS = 25_000; // fallback safety poll

export default function useBootstrapSync(user) {
  const listenersAttachedRef = useRef(false);
  const ranForUserRef = useRef(null);

  // prevent spam hydrates
  const lastHydrateAtRef = useRef(0);
  function shouldHydrateNow(ms = 2000) {
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

  // ✅ MAIN: hydrate on focus + visibility + interval (backup)
  useEffect(() => {
    const userId = user?.id || null;
    if (!userId) return;

    let alive = true;

    const hydrateNow = async (reason = 'unknown') => {
      if (!alive) return;
      if (!shouldHydrateNow()) return;

      try {
        await flushPending({ maxTries: 1 });
      } catch {}

      try {
        await hydrateTodayTotalsFromCloud(user, { alsoDispatch: true });
      } catch (e) {
        console.warn(`[useBootstrapSync] hydrate failed (${reason})`, e);
      }
    };

    const onFocus = () => hydrateNow('focus');
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      hydrateNow('visibility');
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    const t = setInterval(() => hydrateNow('interval'), HYDRATE_INTERVAL_MS);

    // hydrate once immediately
    hydrateNow('mount');

    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user?.id]);

  // ✅ NEW: REALTIME subscription so PC updates instantly when mobile logs
  useEffect(() => {
    const userId = user?.id || null;
    if (!userId) return;
    if (!supabase?.channel) return;

    let unsubscribed = false;

    const safeHydrate = async (reason) => {
      if (unsubscribed) return;
      if (!shouldHydrateNow(1200)) return;

      try {
        await hydrateTodayTotalsFromCloud(user, { alsoDispatch: true });
      } catch (e) {
        console.warn(`[useBootstrapSync] realtime hydrate failed (${reason})`, e);
      }
    };

    let channel = null;

    try {
      channel = supabase
        .channel(`slimcal-realtime-${userId}`)
        // Any daily_metrics change → hydrate
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'daily_metrics',
            filter: `user_id=eq.${userId}`,
          },
          () => safeHydrate('rt:daily_metrics')
        )
        // Any workouts change → hydrate
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'workouts',
            filter: `user_id=eq.${userId}`,
          },
          () => safeHydrate('rt:workouts')
        )
        // Any meals change → hydrate (keeps eaten synced too)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'meals',
            filter: `user_id=eq.${userId}`,
          },
          () => safeHydrate('rt:meals')
        )
        .subscribe((status) => {
          // optional logging
          // console.log('[useBootstrapSync] realtime status:', status);
        });
    } catch (e) {
      console.warn('[useBootstrapSync] realtime setup failed', e);
    }

    return () => {
      unsubscribed = true;
      try {
        if (channel) supabase.removeChannel(channel);
      } catch {}
    };
  }, [user?.id]);

  // ✅ One-time bootstrap per session/tab for this user
  useEffect(() => {
    const userId = user?.id || null;
    if (!userId) return;

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
        await flushPending({ maxTries: 2 });

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
