// src/components/FeatureUseBadge.jsx
import React from 'react';
import { Chip, Tooltip } from '@mui/material';

/**
 * Centralized free daily limits (client-side UX).
 * Server remains the source of truth (402 responses) but this keeps UI consistent.
 *
 * ✅ Requested: 3 uses/day for every AI feature.
 */
const STORAGE_KEY = 'slimcal_usage_v1';

function todayKey() {
  try {
    return new Date().toLocaleDateString('en-US');
  } catch {
    return String(Date.now()).slice(0, 10);
  }
}

function safeParseJSON(val, fallback) {
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function readState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const st = safeParseJSON(raw, null) || {};
  const t = todayKey();

  if (st.date !== t) return { date: t, counts: {} };
  if (!st.counts || typeof st.counts !== 'object') st.counts = {};
  return st;
}

function writeState(st) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
  } catch {
    // ignore
  }
}

export const FREE_DAILY_LIMITS = {
  ai_meal: 3,         // AI meal suggestions
  ai_workout: 3,      // AI workout suggestions
  ai_food_lookup: 3,  // AI food lookup
  daily_recap: 3,     // Daily Recap Coach
};

export function getFreeDailyLimit(featureKey) {
  return Number(FREE_DAILY_LIMITS[featureKey]) || 0;
}

export function getDailyFeatureCount(featureKey) {
  const st = readState();
  return Number(st.counts?.[featureKey]) || 0;
}

export function getDailyFeatureRemaining(featureKey) {
  const limit = getFreeDailyLimit(featureKey);
  const used = getDailyFeatureCount(featureKey);
  return Math.max(0, limit - used);
}

export function canUseDailyFeature(featureKey) {
  return getDailyFeatureRemaining(featureKey) > 0;
}

export function registerDailyFeatureUse(featureKey) {
  const st = readState();
  const used = Number(st.counts?.[featureKey]) || 0;

  st.counts = st.counts || {};
  st.counts[featureKey] = used + 1;

  writeState(st);
  return st.counts[featureKey];
}

/**
 * FeatureUseBadge
 * Displays remaining uses for a feature.
 *
 * Usage:
 *   <FeatureUseBadge featureKey="ai_meal" isPro={isPro} />
 */
export default function FeatureUseBadge({
  featureKey,
  isPro = false,
  sx = {},
  size = 'small',
  label = 'Free',
}) {
  const limit = getFreeDailyLimit(featureKey);
  if (!limit) return null;

  if (isPro) {
    return (
      <Chip
        size={size}
        color="success"
        label="PRO ∞"
        sx={{ fontWeight: 800, borderRadius: 999, ...sx }}
      />
    );
  }

  const remaining = getDailyFeatureRemaining(featureKey);
  const chipLabel = `${label}: ${remaining}/${limit}`;

  return (
    <Tooltip title="Free daily uses. Upgrade for unlimited." arrow>
      <Chip
        size={size}
        variant="outlined"
        label={chipLabel}
        sx={{ fontWeight: 800, borderRadius: 999, ...sx }}
      />
    </Tooltip>
  );
}
