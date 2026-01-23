// src/hooks/useBootstrapSync.js
import { useEffect, useRef } from 'react';
import { migrateLocalToCloudOneTime } from '../lib/migrateLocalToCloud';
import { flushPending, attachSyncListeners } from '../lib/sync';

const SESSION_FLAG_PREFIX = 'bootstrapSync:ranThisSession:';

export default function useBootstrapSync(user) {
  const listenersAttachedRef = useRef(false);
  const ranForUserRef = useRef(null);

  useEffect(() => {
    // Attach listeners once (safe to call multiple times, but let's avoid stacking)
    if (!listenersAttachedRef.current) {
      try {
        attachSyncListeners?.();
      } catch {}
      listenersAttachedRef.current = true;
    }
  }, []);

  useEffect(() => {
    const userId = user?.id || null;
    if (!userId) return;

    // Prevent multiple runs for the same user during this session/tab
    const sessionKey = `${SESSION_FLAG_PREFIX}${userId}`;
    if (sessionStorage.getItem(sessionKey) === '1') {
      ranForUserRef.current = userId;
      return;
    }

    // Also prevent immediate reruns in the same React lifecycle
    if (ranForUserRef.current === userId) return;

    ranForUserRef.current = userId;

    (async () => {
      try {
        await migrateLocalToCloudOneTime(user);
        // After bootstrap, try to flush any queued ops quietly
        await flushPending({ maxTries: 2 });
      } finally {
        try {
          sessionStorage.setItem(sessionKey, '1');
        } catch {}
      }
    })();
  }, [user?.id]);
}
