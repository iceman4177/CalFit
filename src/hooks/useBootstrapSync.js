// src/hooks/useBootstrapSync.js
import { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthProvider.jsx';
import { migrateLocalToCloudOneTime } from '../lib/migrateLocalToCloud';
import { flushPending, attachSyncListeners } from '../lib/sync';
import { hydrateTodayTotalsFromCloud, hydrateRecentWorkoutsToLocal } from '../lib/hydrateCloudToLocal';
import { supabase } from '../lib/supabaseClient';

// Run migration + cloud hydration once per session/user so the banner/totals
// are stable across navigation, refresh, and device sync.
export default function useBootstrapSync() {
  const { user } = useAuth();

  const hasBootstrappedRef = useRef(false);
  const lastHydrateMsRef = useRef(0);

  useEffect(() => {
    if (!user?.id) return;

    let didCancel = false;

    async function run() {
      try {
        // 1) One-time local -> cloud bootstrap (idempotent)
        await migrateLocalToCloudOneTime(user.id);

        // 2) Flush any queued ops (meals/workouts/daily_metrics)
        await flushPending(user.id);

        // 3) Pull today's totals from cloud into local (anti-clobber logic lives inside)
        await hydrateTodayTotalsFromCloud(user, { alsoDispatch: true });

        // 4) Pull recent workout history so other devices see it locally (for History UI)
        try {
          await hydrateRecentWorkoutsToLocal({ supabase, userId: user.id, days: 30 });
        } catch (e) {
          console.warn('[useBootstrapSync] hydrateRecentWorkoutsToLocal failed', e);
        }

        hasBootstrappedRef.current = true;
        lastHydrateMsRef.current = Date.now();
      } catch (e) {
        console.warn('[useBootstrapSync] bootstrap failed', e);
      }
    }

    run();

    // Listeners: online/focus -> flush + hydrate (throttled)
    const detach = attachSyncListeners(user.id);

    async function onFocus() {
      if (didCancel) return;
      if (!user?.id) return;

      // throttle: avoid rehydrating multiple times in quick succession
      const now = Date.now();
      if (now - (lastHydrateMsRef.current || 0) < 2500) return;
      lastHydrateMsRef.current = now;

      try {
        await flushPending(user.id);
      } catch (e) {
        console.warn('[useBootstrapSync] flushPending failed', e);
      }

      try {
        await hydrateTodayTotalsFromCloud(user, { alsoDispatch: true });
      } catch (e) {
        console.warn('[useBootstrapSync] hydrateTodayTotalsFromCloud failed', e);
      }

      try {
        await hydrateRecentWorkoutsToLocal({ supabase, userId: user.id, days: 30 });
      } catch (e) {
        // not mission critical for banner
      }
    }

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    return () => {
      didCancel = true;
      try { detach?.(); } catch {}
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [user?.id]);

  return {
    bootstrapped: !!user?.id && hasBootstrappedRef.current
  };
}
