// src/hooks/useAiQuota.js
// Daily free-usage counter with automatic bypass for Pro/Trial users.

import { useContext, useMemo } from 'react';
import { EntitlementsContext } from '../context/EntitlementsContext.jsx';

const PREFIX = 'aiQuota:'; // e.g., aiQuota:coach:2025-10-30

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * @param {string} feature  'coach' | 'meal' | 'workout'
 * @param {number} freePerDay default 3
 */
export default function useAiQuota(feature = 'coach', freePerDay = 3) {
  const { isEntitled } = useContext(EntitlementsContext) || { isEntitled: false };
  const key = `${PREFIX}${feature}:${dayKey()}`;

  const value = useMemo(() => {
    if (isEntitled) return { used: 0, remaining: Infinity, isCapped: false };
    const used = parseInt(localStorage.getItem(key) || '0', 10);
    const remaining = Math.max(0, freePerDay - used);
    return { used, remaining, isCapped: remaining <= 0 };
  }, [key, freePerDay, isEntitled]);

  const inc = () => {
    if (isEntitled) return;
    const used = parseInt(localStorage.getItem(key) || '0', 10) + 1;
    localStorage.setItem(key, String(used));
  };

  const resetToday = () => localStorage.removeItem(key);

  return { ...value, inc, resetToday, isEntitled: !!isEntitled };
}
