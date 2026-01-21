// src/components/FeatureUseBadge.jsx
import React from 'react';
import { Chip, Tooltip } from '@mui/material';

// -----------------------------------------------------------------------------
// Daily Free-tier usage tracking (client-side)
// -----------------------------------------------------------------------------

const STORAGE_KEY = 'slimcal_usage_v1';

// ✅ Free tier limits (per day) — ALL FEATURES = 3/day
export const FREE_DAILY_LIMITS = {
  ai_meal: 3,
  ai_workout: 3,
  ai_food_lookup: 3,
  daily_recap: 3,

  // Common aliases used across older files (safe to keep)
  coach: 3,
  meal: 3,
  workout: 3,
  food: 3,
};

function getTodayISO() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
    .toISOString()
    .slice(0, 10);
}

function safeParseJSON(val, fallback) {
  try {
    const p = JSON.parse(val);
    return p ?? fallback;
  } catch {
    return fallback;
  }
}

function readState() {
  const today = getTodayISO();
  const raw = localStorage.getItem(STORAGE_KEY);
  const st = safeParseJSON(raw, null);

  if (!st || st.date !== today || typeof st !== 'object') {
    return { date: today, counts: {} };
  }
  if (!st.counts || typeof st.counts !== 'object') {
    return { date: today, counts: {} };
  }
  return st;
}

function writeState(st) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
  } catch {
    // ignore
  }
}

// -------------------- Named exports used across the app -----------------------

export function getFreeDailyLimit(featureKey) {
  return Number(FREE_DAILY_LIMITS[featureKey]) || 0;
}

export function getDailyUsed(featureKey) {
  const st = readState();
  return Math.max(0, Number(st.counts?.[featureKey]) || 0);
}

export function getDailyRemaining(featureKey) {
  const limit = getFreeDailyLimit(featureKey);
  const used = getDailyUsed(featureKey);
  return Math.max(0, limit - used);
}

// ✅ Back-compat alias (some files import this older name)
export function getDailyFeatureRemaining(featureKey) {
  return getDailyRemaining(featureKey);
}

// ✅ Back-compat alias (some older code uses "getRemaining")
export function getRemaining(featureKey) {
  return getDailyRemaining(featureKey);
}

export function canUseDailyFeature(featureKey) {
  return getDailyRemaining(featureKey) > 0;
}

// ✅ Back-compat alias (some older code uses "canUseFeature")
export function canUseFeature(featureKey) {
  return canUseDailyFeature(featureKey);
}

export function registerDailyFeatureUse(featureKey) {
  const st = readState();
  const used = Math.max(0, Number(st.counts?.[featureKey]) || 0);
  st.counts = st.counts || {};
  st.counts[featureKey] = used + 1;
  writeState(st);
  return getDailyRemaining(featureKey);
}

// ✅ Back-compat alias (some older code uses "registerFeatureUse")
export function registerFeatureUse(featureKey) {
  return registerDailyFeatureUse(featureKey);
}

export function resetDailyUsageCache() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// -----------------------------------------------------------------------------
// UI Badge
// -----------------------------------------------------------------------------

export default function FeatureUseBadge({
  featureKey,
  isPro = false,
  sx = {},
  proLabel = 'PRO',
  freePrefix = 'Free left',
  showWhenPro = true,
}) {
  const remaining = getDailyRemaining(featureKey);
  const limit = getFreeDailyLimit(featureKey);

  if (isPro && !showWhenPro) return null;

  if (isPro) {
    return (
      <Chip
        size="small"
        color="success"
        label={proLabel}
        sx={{ fontWeight: 800, borderRadius: 999, ...sx }}
      />
    );
  }

  // If limit is 0, hide badge (feature not configured)
  if (!limit) return null;

  const label = `${freePrefix}: ${remaining}/${limit}`;

  return (
    <Tooltip title="Free daily uses. Upgrade for unlimited." arrow>
      <Chip
        size="small"
        variant="outlined"
        label={label}
        sx={{ fontWeight: 800, borderRadius: 999, ...sx }}
      />
    </Tooltip>
  );
}
