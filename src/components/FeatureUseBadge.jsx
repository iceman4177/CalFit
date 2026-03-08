// src/components/FeatureUseBadge.jsx
import React, { useEffect, useState } from "react";
import { Chip } from '@mui/material';

// -----------------------------------------------------------------------------
// Daily Free-tier usage tracking (client-side)
// -----------------------------------------------------------------------------

const STORAGE_KEY = "slimcal_usage_v1";

// Free tier limits (per day)
// Adjust here to tune upgrade psychology.
export const FREE_DAILY_LIMITS = {
  ai_meal: 3,
  ai_workout: 3,
  ai_food_lookup: 1,
  daily_recap: 3,
  // Daily Evaluation (AI verdict) — keep naming flexible for older imports.
  daily_eval: 3,
  daily_eval_ai_verdict: 3,
  daily_eval_verdict: 3,
  frame_check: 1,
  pose_session: 3,
};

function getTodayISO() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().slice(0, 10);
}

function safeParseJSON(val, fallback) {
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function readState() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }

  const st = safeParseJSON(raw, null);
  const today = getTodayISO();

  if (!st || typeof st !== "object" || !st.date || st.date !== today) {
    return { date: today, counts: {} };
  }

  if (!st.counts || typeof st.counts !== "object") {
    return { date: today, counts: {} };
  }

  return st;
}

function emitUsageChanged(featureKey = null) {
  try { window.dispatchEvent(new CustomEvent('slimcal:usage-changed', { detail: { featureKey } })); } catch {}
}

function writeState(st, featureKey = null) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
  } catch {}
  emitUsageChanged(featureKey);
}

export function getFreeDailyLimit(featureKey) {
  return FREE_DAILY_LIMITS?.[featureKey] ?? 0;
}

export function getDailyRemaining(featureKey) {
  const limit = getFreeDailyLimit(featureKey);
  if (!limit) return 0;

  const st = readState();
  const used = Math.max(0, Number(st.counts?.[featureKey] ?? 0));
  return Math.max(0, limit - used);
}

// ✅ FIX: this is what WorkoutPage.jsx + MealTracker.jsx import
export function canUseDailyFeature(featureKey) {
  return getDailyRemaining(featureKey) > 0;
}

export function registerDailyFeatureUse(featureKey) {
  const limit = getFreeDailyLimit(featureKey);
  if (!limit) return 0;

  const st = readState();
  const used = Math.max(0, Number(st.counts?.[featureKey] ?? 0));
  const nextUsed = used + 1;

  st.counts = st.counts || {};
  st.counts[featureKey] = nextUsed;

  writeState(st, featureKey);

  return nextUsed;
}

export function setDailyRemaining(featureKey, remaining) {
  const limit = getFreeDailyLimit(featureKey);
  if (!limit) return 0;

  const safeRemaining = Math.max(0, Math.min(limit, Number(remaining ?? limit)));
  const used = Math.max(0, limit - safeRemaining);
  const st = readState();
  st.counts = st.counts || {};
  st.counts[featureKey] = used;
  writeState(st, featureKey);
  return safeRemaining;
}

// -----------------------------------------------------------------------------
// UI Badge
// -----------------------------------------------------------------------------
export default function FeatureUseBadge({ featureKey, isPro, sx = {}, labelPrefix }) {
  const [remaining, setRemaining] = useState(() => getDailyRemaining(featureKey));
  const limit = getFreeDailyLimit(featureKey);

  useEffect(() => {
    const refresh = () => setRemaining(getDailyRemaining(featureKey));
    refresh();
    const onUsage = (e) => {
      const changed = e?.detail?.featureKey;
      if (!changed || changed === featureKey) refresh();
    };
    window.addEventListener('slimcal:usage-changed', onUsage);
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('slimcal:usage-changed', onUsage);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [featureKey]);

  if (isPro) {
    return (
      <Chip size="small" color="success" label="PRO ∞" sx={{ fontWeight: 800, borderRadius: 999, ...sx }} />
    );
  }

  const freePrefix = labelPrefix || "Free";
  const label = `${freePrefix}: ${remaining}/${limit}`;

  return (
    <Chip size="small" variant="outlined" label={label} sx={{ fontWeight: 800, borderRadius: 999, ...sx }} />
  );
}
