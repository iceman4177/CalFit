// src/components/FeatureUseBadge.jsx
import React, { useMemo } from 'react';
import { Chip } from '@mui/material';

// -----------------------------
// Centralized daily free limits
// -----------------------------
const FREE_DAILY_LIMITS = {
  ai_meal: 3,
  ai_workout: 3,
  ai_food_lookup: 3,
  ai_coach: 3,
};

// Back-compat aliases (older keys that might still be used)
const KEY_ALIASES = {
  meal: 'ai_meal',
  workout: 'ai_workout',
  food: 'ai_food_lookup',
  coach: 'ai_coach',
};

// Stable per-device id (for anon + guests)
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

function todayKey() {
  try {
    return new Date().toLocaleDateString('en-US');
  } catch {
    return String(Date.now()).slice(0, 10);
  }
}

function safeJSONParse(val, fallback) {
  try {
    const p = JSON.parse(val);
    return p ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeFeatureKey(k) {
  const raw = String(k || '').trim();
  const key = raw.toLowerCase();
  return KEY_ALIASES[key] || key;
}

export function getFreeDailyLimit(featureKey) {
  const k = normalizeFeatureKey(featureKey);
  return Number(FREE_DAILY_LIMITS[k]) || 0;
}

/**
 * Storage key:
 * - Always per-feature
 * - Optionally per-userId (so logging in doesn't "lose" usage state unexpectedly)
 *   If you don't pass userId, we fall back to device id.
 */
function makeStorageKey(featureKey, userId) {
  const k = normalizeFeatureKey(featureKey);
  const scope = userId ? `u:${userId}` : `c:${getClientId()}`;
  return `dailyFeatureUse:${k}:${scope}`;
}

function readRecord(featureKey, userId) {
  const key = makeStorageKey(featureKey, userId);
  const rec = safeJSONParse(localStorage.getItem(key) || '', {});
  const tk = todayKey();
  if (rec?.date !== tk) return { key, date: tk, count: 0 };
  return { key, date: tk, count: Number(rec.count) || 0 };
}

function writeRecord(key, date, count) {
  localStorage.setItem(key, JSON.stringify({ date, count }));
}

export function getDailyFeatureUsed(featureKey, userId) {
  const { count } = readRecord(featureKey, userId);
  return count;
}

export function getDailyFeatureRemaining(featureKey, userId) {
  const limit = getFreeDailyLimit(featureKey);
  if (!limit) return 0;
  const used = getDailyFeatureUsed(featureKey, userId);
  return Math.max(0, limit - used);
}

// Back-compat export names
export const getDailyRemaining = getDailyFeatureRemaining;

export function canUseDailyFeature(featureKey, userId) {
  return getDailyFeatureRemaining(featureKey, userId) > 0;
}

export function registerDailyFeatureUse(featureKey, userId) {
  const limit = getFreeDailyLimit(featureKey);
  if (!limit) return 0;

  const rec = readRecord(featureKey, userId);
  const next = (Number(rec.count) || 0) + 1;
  writeRecord(rec.key, rec.date, next);
  return next;
}

export function resetDailyFeatureUse(featureKey, userId) {
  const rec = readRecord(featureKey, userId);
  writeRecord(rec.key, rec.date, 0);
  return 0;
}

/**
 * FeatureUseBadge
 * Shows "Free left: X/Y" unless the user is Pro/Trial (then returns null).
 *
 * Props:
 * - featureKey: string (e.g., "ai_meal")
 * - isPro: boolean (treat trial as pro for UI)
 * - userId: optional string (scopes counts to the logged-in user when provided)
 */
export default function FeatureUseBadge({
  featureKey,
  isPro = false,
  userId = null,
  sx,
}) {
  const limit = useMemo(() => getFreeDailyLimit(featureKey), [featureKey]);

  const remaining = useMemo(() => {
    return getDailyFeatureRemaining(featureKey, userId);
  }, [featureKey, userId]);

  // If this feature isn't meant to show (limit 0) or user is entitled, hide badge
  if (!limit || isPro) return null;

  return (
    <Chip
      size="small"
      label={`Free left: ${remaining}/${limit}`}
      sx={{
        fontWeight: 800,
        height: 22,
        borderRadius: 999,
        ...sx,
      }}
    />
  );
}
