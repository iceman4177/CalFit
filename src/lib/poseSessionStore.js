// src/lib/poseSessionStore.js
// Local-first Pose Session history + delta helpers.
// Safe: never writes large images to localStorage (stores derived metrics only).

function safeParse(json, fallback) {
  try {
    const v = JSON.parse(json);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

export function localDayISO(d = new Date()) {
  const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function keyFor(userId) {
  const uid = userId || "guest";
  return `poseSessionHistory:${uid}`;
}

export function readPoseSessionHistory(userId) {
  if (typeof window === "undefined") return [];
  const k = keyFor(userId);
  const arr = safeParse(window.localStorage.getItem(k) || "[]", []);
  return Array.isArray(arr) ? arr : [];
}

export function appendPoseSession(userId, session, maxKeep = 30) {
  if (typeof window === "undefined") return;
  const k = keyFor(userId);
  const prev = readPoseSessionHistory(userId);

  // Deduplicate by local day (keep latest per day) + id.
  const sDay = session?.localDay || session?.local_day;
  const next = [session, ...prev.filter((s) => {
    const d = s?.localDay || s?.local_day;
    return s?.id !== session?.id && d !== sDay;
  })];

  window.localStorage.setItem(k, JSON.stringify(next.slice(0, maxKeep)));
}

function parseLocalDay(s) {
  if (!s || typeof s !== "string") return null;
  if (!s.includes("-")) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function daysBetweenLocal(aISO, bISO) {
  const a = parseLocalDay(aISO);
  const b = parseLocalDay(bISO);
  if (!a || !b) return null;
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 86400000);
}

export function computeSessionStreak(history, todayISO = localDayISO()) {
  // history assumed newest-first.
  if (!Array.isArray(history) || history.length === 0) {
    return { streak: 0, lastDay: null };
  }

  // Build a unique set of local days in descending order.
  const days = [];
  const seen = new Set();
  for (const s of history) {
    const d = s?.localDay || s?.local_day || s?.localday;
    if (d && !seen.has(d)) {
      seen.add(d);
      days.push(d);
    }
  }

  if (days.length === 0) return { streak: 0, lastDay: null };

  // If last session was today: streak counts from today backward.
  // If last session was yesterday: streak counts from yesterday backward.
  const lastDay = days[0];
  const gap = daysBetweenLocal(lastDay, todayISO);
  // If gap >= 2, streak is 1 (starting at lastDay), not 0.
  // If gap is null, default to 1.

  let streak = 1;
  for (let i = 0; i < days.length - 1; i++) {
    const a = days[i];
    const b = days[i + 1];
    const diff = daysBetweenLocal(b, a); // note reversed for descending order
    // a is newer than b, so diff should be 1 for consecutive.
    if (diff === 1) {
      streak += 1;
    } else {
      break;
    }
  }

  // If the most recent day is too old (gap >= 2), we still show "streak: 1".
  // If gap is 0 or 1, streak is as computed.
  if (gap == null) return { streak, lastDay };
  if (gap >= 2) return { streak: 1, lastDay };
  return { streak, lastDay };
}

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}

function pctFromDelta(delta01) {
  // Convert 0..1-ish delta to a friendly +% number.
  // Keep small but noticeable.
  const d = clamp(delta01, 0, 0.25);
  const pct = Math.round(d * 100);
  return Math.max(0, pct);
}

export function computeDeltasPositiveOnly(prevSession, curSession) {
  const prev = prevSession?.muscleSignals || prevSession?.signals || {};
  const cur = curSession?.muscleSignals || curSession?.signals || {};

  const keys = [
    "delts",
    "arms",
    "lats",
    "chest",
    "back",
    "waist_taper",
    "legs",
  ];

  const rows = keys.map((k) => {
    const d = Math.max(0, (cur[k] ?? 0) - (prev[k] ?? 0));
    return { key: k, delta: d };
  });

  rows.sort((a, b) => b.delta - a.delta);

  const top = rows.slice(0, 4);
  const label = {
    delts: "Delts",
    arms: "Arms",
    lats: "Lats",
    chest: "Chest",
    back: "Back",
    waist_taper: "Waist",
    legs: "Legs",
  };

  const wins = top.map((r) => {
    const pct = pctFromDelta(r.delta);
    const text = pct > 0 ? `+${pct}%` : "+0%";
    return { k: label[r.key] || r.key, v: text };
  });

  // A single “overall” delta for share/summary.
  const overall = rows.reduce((acc, r) => acc + r.delta, 0) / Math.max(1, rows.length);
  const overallPct = pctFromDelta(overall);

  return {
    wins,
    overallPct,
    hasPrev: !!prevSession,
  };
}
