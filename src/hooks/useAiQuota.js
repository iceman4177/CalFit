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
 * Centralized per-day free limits (client UX hint).
 * Server is still source of truth for real enforcement.
 */
const LIMITS = {
  meal: 3,     // AI Meal Suggestions
  workout: 3,  // AI Workouts
  food: 3,     // AI Food Assist / Food Lookup (beta)
  coach: 3,    // Daily Recap Coach "Generate/Refresh"
};

function getLimit(feature) {
  const k = String(feature || '').toLowerCase();
  return Number(LIMITS[k]) || 0;
}

/**
 * useAiQuota
 * Lightweight local quota tracker (per-day) for a given feature.
 *
 * @param {string} feature one of 'workout' | 'meal' | 'food' | 'coach'
 */
export default function useAiQuota(feature = 'coach') {
  const { dailyGoal, goalType, recentMeals /*, isPremium*/ } = useUserData();
  const [quota, setQuota] = useState(0);

  const todayKey = useMemo(() => {
    try {
      return new Date().toLocaleDateString('en-US');
    } catch {
      return String(Date.now()).slice(0, 10);
    }
  }, []);

  const key = String(feature || 'coach').toLowerCase();
  const limit = useMemo(() => getLimit(key), [key]);

  const storageKey = useMemo(() => `aiQuota:${key}`, [key]);

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
      localStorage.setItem(
        storageKey,
        JSON.stringify({ date: todayKey, count: next, clientId: getClientId() })
      );
      setQuota(next);
      return next;
    } catch {
      const next = (quota || 0) + 1;
      setQuota(next);
      return next;
    }
  };

  const resetToday = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ date: todayKey, count: 0, clientId: getClientId() }));
    } catch {}
    setQuota(0);
  };

  const remaining = Math.max(0, limit - (quota || 0));
  const canUse = remaining > 0;

  return {
    // user context values (back-compat for callers)
    dailyGoal,
    goalType,
    recentMeals,

    // quota info
    feature: key,
    quota,       // used today
    limit,       // per-day limit for this feature
    remaining,   // remaining free uses today
    canUse,      // whether user has a free use remaining
    increment,   // call after a successful free use
    resetToday,  // helper
    clientId: getClientId(),
  };
}
