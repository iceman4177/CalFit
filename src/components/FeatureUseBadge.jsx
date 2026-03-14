// src/components/FeatureUseBadge.jsx
import React, { useEffect, useState } from "react";
import { Chip } from '@mui/material';

// -----------------------------------------------------------------------------
// Daily Free-tier usage tracking (client-side)
// -----------------------------------------------------------------------------

const STORAGE_KEY = "slimcal_usage_v1";
const QUOTA_EVENT = "slimcal:quota-changed";

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

function getTodayISO(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

function writeState(st) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
  } catch {}
}

function emitQuotaChanged(featureKey = null) {
  try {
    window.dispatchEvent(new CustomEvent(QUOTA_EVENT, { detail: { featureKey, ts: Date.now() } }));
  } catch {}
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

  writeState(st);
  emitQuotaChanged(featureKey);

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
  writeState(st);
  emitQuotaChanged(featureKey);
  return safeRemaining;
}

// -----------------------------------------------------------------------------
// UI Badge
// -----------------------------------------------------------------------------
export default function FeatureUseBadge({ featureKey, isPro, sx = {}, labelPrefix }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const rerender = () => setTick((n) => n + 1);
    const onStorage = (e) => {
      if (!e || !e.key || e.key === STORAGE_KEY) rerender();
    };
    const onQuota = (e) => {
      const fk = e?.detail?.featureKey;
      if (!fk || fk === featureKey) rerender();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(QUOTA_EVENT, onQuota);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(QUOTA_EVENT, onQuota);
    };
  }, [featureKey]);

  if (isPro) {
    return (
      
        <Chip size="small" color="success" label="PRO ∞" sx={{ fontWeight: 800, borderRadius: 999, ...sx }} />
      
    );
  }

  const limit = getFreeDailyLimit(featureKey);
  const remaining = getDailyRemaining(featureKey);

  const freePrefix = labelPrefix || "Free";
  const label = `${freePrefix}: ${remaining}/${limit}`;

  return (
    
      <Chip size="small" variant="outlined" label={label} sx={{ fontWeight: 800, borderRadius: 999, ...sx }} />
    
  );
}
