// src/hooks/useBootstrapSync.js
import { useEffect, useRef } from 'react';
import { migrateLocalToCloudOneTime } from '../lib/migrateLocalToCloud';
import { flushPending, attachSyncListeners } from '../lib/sync';

const SESSION_FLAG = 'bootstrapSync:ranThisSession';

export default function useBootstrapSync(user) {
  const ranRef = useRef(false);

  useEffect(() => {
    if (!user || ranRef.current) return;

    // Attach listeners once (safe to call multiple times)
    attachSyncListeners?.();

    // Prevent multiple runs in this tab/session
    if (sessionStorage.getItem(SESSION_FLAG) === '1') {
      ranRef.current = true;
      return;
    }

    (async () => {
      try {
        // One-time, idempotent bootstrap for this browser (per-user)
        await migrateLocalToCloudOneTime(user);
        // After bootstrap, try to flush any queued ops quietly
        await flushPending({ maxTries: 2 });
      } finally {
        sessionStorage.setItem(SESSION_FLAG, '1');
        ranRef.current = true;
      }
    })();
  }, [user]);
}
