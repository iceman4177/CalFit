// src/components/FeatureUseBadge.jsx
import React, { useEffect, useState } from "react";
import { Chip } from '@mui/material';
import { useAuth } from "../context/AuthProvider";

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

function writeState(st) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
  } catch {}
}

function getOrCreateClientId() {
  try {
    let id = localStorage.getItem("slimcal_client_id");
    if (id) return id;
    id = (globalThis.crypto?.randomUUID?.() || `slimcal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    localStorage.setItem("slimcal_client_id", id);
    return id;
  } catch {}
  return `slimcal-${Date.now()}`;
}

export function notifyQuotaChanged(featureKey) {
  try {
    window.dispatchEvent(new CustomEvent("slimcal:quota-changed", { detail: { featureKey } }));
  } catch {}
}

export async function fetchServerDailyRemaining(featureKey, userId) {
  if (!userId || !featureKey) return null;
  try {
    const res = await fetch("/api/ai/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": userId,
        "X-Client-Id": getOrCreateClientId(),
      },
      body: JSON.stringify({
        feature: "quota_status",
        targetFeature: featureKey,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    const remaining = Number(json?.remaining);
    return Number.isFinite(remaining) ? remaining : null;
  } catch {
    return null;
  }
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
  notifyQuotaChanged(featureKey);

  return nextUsed;
}

// -----------------------------------------------------------------------------
// UI Badge
// -----------------------------------------------------------------------------
export default function FeatureUseBadge({ featureKey, isPro, sx = {}, labelPrefix }) {
  const { user } = useAuth();
  const [serverRemaining, setServerRemaining] = useState(null);

  useEffect(() => {
    let alive = true;

    async function refresh() {
      if (isPro || !user?.id) {
        if (alive) setServerRemaining(null);
        return;
      }
      const next = await fetchServerDailyRemaining(featureKey, user.id);
      if (alive) setServerRemaining(next);
    }

    refresh();

    const onRefresh = (e) => {
      const changed = e?.detail?.featureKey;
      if (!changed || changed === featureKey) refresh();
    };

    window.addEventListener("focus", refresh);
    window.addEventListener("slimcal:quota-changed", onRefresh);
    return () => {
      alive = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("slimcal:quota-changed", onRefresh);
    };
  }, [featureKey, isPro, user?.id]);

  if (isPro) {
    return <Chip size="small" color="success" label="PRO ∞" sx={{ fontWeight: 800, borderRadius: 999, ...sx }} />;
  }

  const limit = getFreeDailyLimit(featureKey);
  const remaining = user?.id && serverRemaining !== null ? serverRemaining : getDailyRemaining(featureKey);

  const freePrefix = labelPrefix || "Free";
  const label = `${freePrefix}: ${remaining}/${limit}`;

  return <Chip size="small" variant="outlined" label={label} sx={{ fontWeight: 800, borderRadius: 999, ...sx }} />;
}
