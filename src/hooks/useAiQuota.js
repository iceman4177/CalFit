// src/hooks/useAiQuota.js

import { useState, useEffect, useMemo } from 'react';
import { useUserData } from '../UserDataContext.jsx';

// Stable device/client id for per-device limits (anon users)
function getClientId() {
  try {
    let cid = localStorage.getItem('clientId');
    if (!cid) {
      cid = (crypto?.randomUUID?.() || `cid_${Date.now()}`).slice(0, 36);
      localStorage.setItem('clientId', cid);
    }
    return cid;
  } catch {
    return 'anon';
  }
}

/**
 * useAiQuota
 * Lightweight local quota tracker (3/day) for a given feature.
 * NOTE: Pro/Trial bypass is enforced server-side by /api/ai/generate.
 *
 * @param {string} feature one of 'workout' | 'meal' | 'coach' (default: 'coach')
 */
export default function useAiQuota(feature = 'coach') {
  const { dailyGoal, goalType, recentMeals /*, isPremium*/ } = useUserData();
  // We do NOT rely on isPremium here to avoid a hard dependency; server is source of truth.

  const [quota, setQuota] = useState(0);

  const todayKey = useMemo(() => {
    try { return new Date().toLocaleDateString('en-US'); }
    catch { return String(Date.now()).slice(0, 10); }
  }, []);

  const storageKey = useMemo(() => `aiQuota:${feature}`, [feature]);

  useEffect(() => {
    try {
      const rec = JSON.parse(localStorage.getItem(storageKey) || '{}');
      const count = rec.date === todayKey ? (rec.count || 0) : 0;
      setQuota(count);
    } catch {
      setQuota(0);
    }
  }, [storageKey, todayKey]);

  const increment = () => {
    try {
      const rec = JSON.parse(localStorage.getItem(storageKey) || '{}');
      const next = rec.date === todayKey ? (rec.count || 0) + 1 : 1;
      localStorage.setItem(storageKey, JSON.stringify({ date: todayKey, count: next, clientId: getClientId() }));
      setQuota(next);
      return next;
    } catch {
      // best effort
      const next = (quota || 0) + 1;
      setQuota(next);
      return next;
    }
  };

  const resetToday = () => {
    localStorage.setItem(storageKey, JSON.stringify({ date: todayKey, count: 0, clientId: getClientId() }));
    setQuota(0);
  };

  return {
    // data your components have been using
    dailyGoal,
    goalType,
    recentMeals,

    // quota info
    quota,           // number used today (local-only)
    limit: 3,        // UI hint; real enforcement is on the server
    increment,       // call this after a successful free use (non-Pro path)
    resetToday,      // optional helper
    clientId: getClientId(),
  };
}
