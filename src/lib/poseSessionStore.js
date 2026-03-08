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

  const lastDay = days[0];
  const gap = daysBetweenLocal(lastDay, todayISO);

  let streak = 1;
  for (let i = 0; i < days.length - 1; i++) {
    const a = days[i];
    const b = days[i + 1];
    const diff = daysBetweenLocal(b, a); // note reversed for descending order
    if (diff === 1) {
      streak += 1;
    } else {
      break;
    }
  }

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

  const overall = rows.reduce((acc, r) => acc + r.delta, 0) / Math.max(1, rows.length);
  const overallPct = pctFromDelta(overall);

  return {
    wins,
    overallPct,
    hasPrev: !!prevSession,
  };
}

function normalizeSignals(signals) {
  const src = signals && typeof signals === "object" ? signals : {};
  return {
    delts: clamp(src.delts ?? 0, 0, 1),
    arms: clamp(src.arms ?? 0, 0, 1),
    lats: clamp(src.lats ?? 0, 0, 1),
    chest: clamp(src.chest ?? 0, 0, 1),
    back: clamp(src.back ?? 0, 0, 1),
    waist_taper: clamp(src.waist_taper ?? src.taper ?? 0, 0, 1),
    legs: clamp(src.legs ?? 0, 0, 1),
  };
}

export function buildRecentPoseContext(history, limit = 3) {
  if (!Array.isArray(history) || !history.length) return [];

  return history
    .slice(0, Math.max(1, limit))
    .map((row) => {
      const snapshot = row?.physiqueSnapshot || {};
      const muscleSignals = normalizeSignals(row?.muscleSignals || snapshot?.muscleSignals || {});
      const strongestFeature =
        String(
          snapshot?.summary_seed?.strongest_feature ||
            row?.strongestFeature ||
            row?.momentumNote ||
            ""
        ).trim().slice(0, 120);

      const visibleRegions = snapshot?.visible_regions && typeof snapshot.visible_regions === "object"
        ? snapshot.visible_regions
        : null;

      return {
        local_day: row?.local_day || row?.localDay || null,
        gender: String(row?.gender || snapshot?.gender || "").trim() || null,
        scan_mode: String(row?.scanMode || row?.scan_mode || snapshot?.scan_mode || "").trim() || null,
        build_arc: clamp(row?.build_arc ?? row?.buildArcScore ?? snapshot?.build_arc ?? 0, 0, 100),
        muscleSignals,
        strongest_feature: strongestFeature,
        momentum_note: String(row?.momentumNote || row?.baselineComparison || "").trim().slice(0, 160),
        visible_regions: visibleRegions,
      };
    })
    .filter((row) => row.local_day || Object.values(row.muscleSignals || {}).some((v) => Number(v) > 0));
}
