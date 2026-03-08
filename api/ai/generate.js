// /api/ai/generate.js
//
// Slimcal AI gateway with server-side free-pass + Pro/Trial bypass.
// Behavior:
// - Pro/Trial users: unlimited AI usage (bypass free-pass).
// - Non-Pro users (signed-in or anonymous): up to 3 uses per FEATURE per DAY,
//   keyed by X-Client-Id (falls back to IP if missing). Attempts are synced to
//   Supabase when possible; fallback to in-memory counter if table/policy missing.
//
// Features supported: 'workout', 'meal', 'coach', 'daily_eval_verdict', 'frame_check', 'body_scan', 'pose_session'.
//

import { supabaseAdmin } from "../_lib/supabaseAdmin.js";
import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export const config = { api: { bodyParser: false } };
export const maxDuration = 30;

// -------------------- BASIC UTILS --------------------
async function readJson(req) {
  try {
    const bufs = [];
    for await (const chunk of req) bufs.push(chunk);
    const raw = Buffer.concat(bufs).toString("utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function dayKeyUTC(date = new Date()) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

function headerClientId(req) {
  const cid = (req.headers["x-client-id"] || "").toString().trim();
  if (cid) return cid.slice(0, 128);
  const ip = (req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "0.0.0.0")
    .toString()
    .split(",")[0]
    .trim();
  return `ip:${ip}`;
}

function idKey(req, userId) {
  if (userId) return `uid:${userId}`;
  return headerClientId(req);
}

function base64UrlDecode(str) {
  try {
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "====".slice(b64.length % 4) : "";
    const txt = Buffer.from(b64 + pad, "base64").toString("utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function getUserIdFromHeaders(req) {
  // 1) Explicit headers
  const headerUid =
    (req.headers["x-user-id"] || req.headers["x-supabase-user-id"] || "").toString().trim();
  if (headerUid) return headerUid;

  // 2) Supabase JWT in Authorization: Bearer <token>
  const auth = (req.headers["authorization"] || "").toString().trim();
  if (auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7);
    const parts = token.split(".");
    if (parts.length >= 2) {
      const payload = base64UrlDecode(parts[1]);
      const sub = payload?.sub || payload?.user_id || payload?.uid;
      if (sub) return String(sub);
    }
  }
  return null;
}

function safeParseJsonFromText(text) {
  const t = String(text || "").trim();
  if (!t) return null;

  // Fast path
  try {
    return JSON.parse(t);
  } catch {}

  // Extract the first balanced JSON object from the text.
  const start = t.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (ch === "\\") {
        esc = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") depth--;

    if (depth === 0) {
      const candidate = t.slice(start, i + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        break;
      }
    }
  }

  // Last resort: trim to last brace and try.
  const last = t.lastIndexOf("}");
  if (last !== -1) {
    const candidate = t.slice(start, last + 1);
    try {
      return JSON.parse(candidate);
    } catch {}
  }

  return null;
}

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function fallbackBodyScan() {
  // Always neutral/positive. Treated as a baseline estimate.
  return {
    bodyFatPct: 18.7,
    leanMassLbs: 156,
    bmi: 23,
    buildArcScore: 81,
    percentile: 19,
    strengthTag: "Consistency",
    horizon: "90-Day upgrade horizon",
    levers: ["Add ~25g protein today", "Strength train 2–3×/week"],
    confidenceNote: "Solid baseline — re-scan in similar lighting for clean tracking.",
  };
}


function fallbackPoseSession(gender = "male") {
  const female = String(gender || "male").toLowerCase() === "female";
  return {
    build_arc: 81,
    percentile: 19,
    strength: female ? "Presence" : "Consistency",
    horizon_days: 90,
    toneMode: "balanced",
    tierLabel: female ? "POLISHED BASELINE" : "BASELINE LOCKED",
    aesthetic_score: female ? 8.2 : 8.1,
    momentumNote: female ? "Baseline beauty check locked in — future scans can track a prettier, more polished trend over time." : "Baseline jacked check locked in — future scans can track a stronger, more built trend over time.",
    baselineComparison: female ? "First physique memory saved — future scans can compare your silhouette and presentation against today." : "First physique memory saved — future scans can compare your muscularity and presence against today.",
    highlights: female
      ? ["Your frame reads balanced and athletic", "Posture carries a more confident look", "This scan gives a polished progress baseline"]
      : ["Your upper frame reads stronger on camera", "Shoulders and arms create solid presence", "This scan gives a clean progress baseline"],
    levers: ["Add +25g protein today", "Lift 3× this week", "Re-scan weekly in similar lighting"],
    confidenceNote: "Solid baseline — consistent lighting and distance will sharpen your progress tracking.",
    shortHeadline: female ? "This is a confident, polished look." : "You’ve got a stronger look here than you probably realize.",
    quickSummary: female ? "Your frame reads balanced and athletic here, and the posture gives the whole look more confidence." : "Your shoulders and upper frame are reading stronger here, which gives the whole pose more presence.",
    shareCardSummary: female ? "Confident, polished, and trending up." : "Stronger, sharper, and trending up.",
    detailedExpansion: female ? "More detail: your overall silhouette reads clean and composed here, with posture and presentation doing a lot of the work. This feels like the kind of progress that becomes obvious fast when you stay consistent." : "More detail: your upper-body presence is coming through better here, especially in the way the frame reads broader and more athletic. This feels like real momentum, not just a flattering angle.",
    report: female ? `This is a confident, polished look.

Your frame reads balanced and athletic here, and the posture gives the whole shot more presence.

This feels like the kind of progress that becomes easier to notice once you keep stacking consistent weeks.

Stay with the basics and re-scan in similar lighting to make the trend even clearer.` : `You’ve got a stronger look here than you probably realize.

Your shoulders and upper frame are reading broader in these captures, which gives the whole pose set more presence.

This feels like real momentum, not just a lucky angle.

Keep showing up, keep the lighting consistent, and the trend should get easier to see.`,
    muscleBreakdown: female ? [
      { group: "Shoulder line", note: "Your shoulder line reads clean and balanced here. It helps the whole frame look more athletic and composed.", visibility: "visible" },
      { group: "Arms", note: "Your arms are visible enough to show shape and poise in the frame. The overall look feels neat, healthy, and put together.", visibility: "visible" },
      { group: "Upper-body shape", note: "The upper frame reads smooth and supportive here. That gives the scan a polished, confident feel.", visibility: "visible" },
      { group: "Silhouette flow", note: "Your silhouette is partially visible here, so this is more of a light estimate than a hard conclusion. Even so, the frame reads balanced and flattering.", visibility: "partial" },
      { group: "Lower body", note: "Your lower body is not clearly in frame in these captures, so SlimCal AI cannot make a confident visual assessment yet.", visibility: "not_visible" }
    ] : [
      { group: "Shoulders", note: "Your shoulders read clearly in these captures and give the frame stronger presence. They help the whole look come off more athletic.", visibility: "visible" },
      { group: "Arms", note: "Your arms are visible enough here to create some real upper-body pop. That adds to the stronger look of the pose set overall.", visibility: "visible" },
      { group: "Chest", note: "Your chest is visible enough to support a fuller upper-frame read here. It helps the front view feel more built and confident.", visibility: "visible" },
      { group: "Taper", note: "Your midsection is only partially visible here, so this read is lighter than the upper-body read. The frame still suggests a cleaner athletic silhouette.", visibility: "partial" },
      { group: "Lower body", note: "Your lower body is not clearly in frame in these captures, so SlimCal AI cannot make a confident visual assessment yet.", visibility: "not_visible" }
    ],
    bestDeveloped: female ? ["Balanced frame", "Confident posture"] : ["Shoulder presence", "Arm presence"],
    biggestOpportunity: female ? ["Keep consistent lighting for clearer trend reads"] : ["Keep consistent lighting for clearer trend reads"],
    poseNotes: ["Consistent framing improves comparison quality", "A little more full-body visibility would strengthen future reads"],
    muscleSignals: {
      delts: 0.62,
      arms: 0.64,
      lats: 0.60,
      chest: 0.58,
      back: 0.61,
      waist_taper: 0.57,
      legs: 0.55,
    },
    poseQuality: {
      front_relaxed: 0.74,
      front_double_bi: 0.74,
      side_scan: 0.73,
      back_double_bi: 0.73,
      back_scan: 0.73,
    },
  };
}

function normalizeVisibilityLabel(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (["not_visible", "not visible", "not in frame", "out_of_frame", "out of frame", "not assessable", "cannot assess", "can't assess", "unable to assess"].includes(raw)) return "not_visible";
  if (["partial", "partially_visible", "partially visible", "limited", "limited_visibility", "limited visibility"].includes(raw)) return "partial";
  if (["visible", "clear", "clearly_visible", "clearly visible", "in_frame", "in frame"].includes(raw)) return "visible";
  return raw;
}

function groupVisibilityFallback(group) {
  const g = String(group || "").toLowerCase();
  if (/(leg|quad|ham|calf|glute|hip)/.test(g)) return "not_visible";
  if (/(waist|midsection|core|abs|oblique|taper)/.test(g)) return "partial";
  return "visible";
}

function visibilityNoteForGroup(group, visibility) {
  const g = String(group || "").trim() || "This area";
  const lower = g.toLowerCase();
  if (visibility === "not_visible") {
    if (/(leg|quad|ham|calf)/.test(lower)) return `${g} are not clearly in frame in these captures, so SlimCal AI cannot make a confident visual assessment yet.`;
    if (/(glute|hip)/.test(lower)) return `${g} are not clearly in frame in these captures, so SlimCal AI cannot make a confident visual assessment yet.`;
    return `${g} are not clearly visible enough in these captures for a confident visual assessment.`;
  }
  if (visibility === "partial") {
    return `${g} are only partially visible here, so any read is limited and should be treated as a light estimate rather than a firm conclusion.`;
  }
  return "";
}

function sanitizeRecentPoseScans(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, 3)
    .map((row) => {
      const ms = row?.muscleSignals && typeof row.muscleSignals === "object" ? row.muscleSignals : {};
      return {
        local_day: String(row?.local_day || row?.localDay || "").slice(0, 24),
        gender: String(row?.gender || "").toLowerCase() === "female" ? "female" : "male",
        scan_mode: String(row?.scan_mode || row?.scanMode || "").slice(0, 48),
        build_arc: clamp(row?.build_arc ?? row?.buildArcScore ?? 0, 0, 100),
        strongest_feature: String(row?.strongest_feature || row?.strongestFeature || "").slice(0, 120),
        momentum_note: String(row?.momentum_note || row?.momentumNote || "").slice(0, 160),
        muscleSignals: {
          delts: clamp(ms?.delts ?? 0, 0, 1),
          arms: clamp(ms?.arms ?? 0, 0, 1),
          lats: clamp(ms?.lats ?? 0, 0, 1),
          chest: clamp(ms?.chest ?? 0, 0, 1),
          back: clamp(ms?.back ?? 0, 0, 1),
          waist_taper: clamp(ms?.waist_taper ?? ms?.taper ?? 0, 0, 1),
          legs: clamp(ms?.legs ?? 0, 0, 1),
        },
      };
    })
    .filter((row) => row.local_day || Object.values(row.muscleSignals || {}).some((v) => Number(v) > 0));
}

function averagePoseSignals(scans) {
  const keys = ["delts", "arms", "lats", "chest", "back", "waist_taper", "legs"];
  const out = Object.fromEntries(keys.map((k) => [k, 0]));
  if (!Array.isArray(scans) || !scans.length) return out;
  for (const row of scans) {
    for (const k of keys) out[k] += Number(row?.muscleSignals?.[k] || 0);
  }
  for (const k of keys) out[k] = out[k] / scans.length;
  return out;
}

function poseSignalLabel(key, gender = "male") {
  const male = {
    delts: "shoulders",
    arms: "arms",
    lats: "lat flare",
    chest: "chest",
    back: "back width",
    waist_taper: "taper",
    legs: "lower body",
  };
  const female = {
    delts: "shoulder line",
    arms: "arm line",
    lats: "upper-body shape",
    chest: "posture line",
    back: "back line",
    waist_taper: "silhouette flow",
    legs: "lower-body line",
  };
  return (gender === "female" ? female : male)[key] || key;
}

function normalizeGoalType(goalType, gender = "male") {
  const g = String(goalType || "").toLowerCase().trim();
  if (["cut", "cutting", "lean", "get lean"].includes(g)) return "cutting";
  if (["bulk", "bulking", "build muscle", "muscle"].includes(g)) return "bulking";
  if (["maintenance", "recomp", "recomposition", "tone", "toning"].includes(g)) return g === "toning" ? "toning" : "maintenance";
  return gender === "female" ? "toning" : "maintenance";
}

function goalToneHint(goalType, gender = "male") {
  const goal = normalizeGoalType(goalType, gender);
  if (gender === "female") {
    if (goal === "cutting") return "She wants a leaner, more polished, beautifully put-together look.";
    if (goal === "bulking") return "She wants a stronger, more sculpted, athletic look while still feeling feminine and beautiful.";
    return "She wants a toned, elegant, athletic look that feels pretty, confident, and motivating.";
  }
  if (goal === "cutting") return "He wants a sharper, leaner, more defined look that still feels muscular and jacked.";
  if (goal === "bulking") return "He wants a bigger, fuller, thicker, more muscular look.";
  return "He wants a strong, aesthetic, jacked look with obvious upper-body presence.";
}


function normalizePoseToneMode(mode) {
  const raw = String(mode || "balanced").toLowerCase().trim();
  if (["hype", "balanced", "coach"].includes(raw)) return raw;
  return "balanced";
}

function poseToneInstruction(mode = "balanced", gender = "male") {
  const base = [
    "Make the user feel seen, confident, motivated, and excited to keep going.",
    "Use specific uplifting truth instead of generic hype.",
    "Start with one short positive hook.",
    "Name 2-4 visible strengths that are genuinely supported by the images.",
    "Translate those strengths into confidence, athletic presence, balance, polish, health, or momentum.",
    "Frame the result as progress and trajectory, not final worth.",
    "End with one motivating next lever.",
    "Never shame, objectify, oversexualize, or imply the user's value depends on appearance.",
    "Avoid fake superlatives like perfect, flawless, ideal, alpha, mog, superior genetics, or finally attractive.",
    "Use short punchy sentences more than long dense paragraphs.",
  ];

  if (gender === "female") {
    base.push(
      "For female scans, prefer language like confident, polished, athletic, balanced, pretty, graceful, sculpted, healthy-looking, and put together when supported by the images.",
      "Avoid fixation on thinness, tiny waist language, or objectifying attention-seeking phrasing."
    );
  } else {
    base.push(
      "For male scans, prefer language like stronger, sharper, athletic, broader, filled out, built, muscular, disciplined, and confident when supported by the images.",
      "Avoid dominance/status language or insecurity bait."
    );
  }

  if (mode === "hype") {
    base.push(
      "Mode is HYPE: creator-native, exciting, rewarding, and sticky, but still believable.",
      "Use more punch and emotional lift. Keep it sincere, not cringe."
    );
  } else if (mode === "coach") {
    base.push(
      "Mode is COACH: slightly more analytical, focused on progress signals, structure, and one clear next step.",
      "Still warm and encouraging, but less slangy and less hype-driven."
    );
  } else {
    base.push(
      "Mode is BALANCED: premium coach plus authentic gym-friend energy.",
      "This is the default voice and should feel broadly safe, motivating, and believable."
    );
  }

  return base.join(" ");
}

function summarizeRecentPoseContext(scans, gender = "male") {
  if (!Array.isArray(scans) || !scans.length) return "No recent physique baseline is available yet.";
  const avg = averagePoseSignals(scans);
  const ordered = Object.entries(avg).sort((a, b) => b[1] - a[1]);
  const top = ordered.slice(0, 2).map(([k]) => poseSignalLabel(k, gender));
  const last = scans[0] || {};
  const parts = [];
  if (last.local_day) parts.push(`Most recent saved scan day: ${last.local_day}.`);
  if (top.length) parts.push(`Recent baseline reads strongest through ${top.join(" and ")}.`);
  if (last.strongest_feature) parts.push(`Last saved strongest feature: ${last.strongest_feature}.`);
  return parts.join(" ");
}

function buildPhysiqueSnapshot(session, { gender = "male", scanMode = "", localDay = "" } = {}) {
  const ms = session?.muscleSignals || {};
  const visibleRegions = {
    shoulders: true,
    arms: true,
    chest: gender === "male",
    waist: true,
    back: true,
    glutes: /female/.test(scanMode),
    legs: /scan/.test(scanMode),
  };

  const traits = {
    upper_body_presence: clamp(((ms.delts || 0) + (ms.arms || 0) + (ms.lats || 0) + (ms.chest || 0)) / 4 * 10, 0, 10),
    shoulder_presence: clamp((ms.delts || 0) * 10, 0, 10),
    arm_fullness: clamp((ms.arms || 0) * 10, 0, 10),
    chest_presence: clamp((ms.chest || 0) * 10, 0, 10),
    v_taper: clamp((ms.waist_taper || 0) * 10, 0, 10),
    back_width: clamp((ms.back || ms.lats || 0) * 10, 0, 10),
    posture_confidence: clamp((((session?.poseQuality?.front_double_bi || 0) + (session?.poseQuality?.back_double_bi || 0) + (session?.poseQuality?.side_scan || 0)) / 3) * 10, 0, 10),
    athletic_polish: clamp((session?.aesthetic_score || 0), 0, 10),
    silhouette_balance: clamp((((ms.waist_taper || 0) + (ms.delts || 0) + (ms.back || 0)) / 3) * 10, 0, 10),
  };

  const confidence = {
    upper_body_presence: 0.84,
    shoulder_presence: 0.84,
    arm_fullness: 0.82,
    chest_presence: gender === "male" ? 0.8 : 0.72,
    v_taper: 0.76,
    back_width: 0.8,
    posture_confidence: 0.78,
    athletic_polish: 0.8,
    silhouette_balance: 0.75,
  };

  const sortedSignals = Object.entries(ms).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
  const topKey = sortedSignals[0]?.[0] || (gender === "female" ? "waist_taper" : "arms");
  const strongestFeature = poseSignalLabel(topKey, gender);

  return {
    gender,
    scan_mode: scanMode || (gender === "female" ? "female_pose_session" : "male_pose_session"),
    local_day: localDay || dayKeyUTC(),
    visible_regions: visibleRegions,
    traits,
    confidence,
    muscleSignals: {
      delts: clamp(ms.delts ?? 0, 0, 1),
      arms: clamp(ms.arms ?? 0, 0, 1),
      lats: clamp(ms.lats ?? 0, 0, 1),
      chest: clamp(ms.chest ?? 0, 0, 1),
      back: clamp(ms.back ?? 0, 0, 1),
      waist_taper: clamp(ms.waist_taper ?? 0, 0, 1),
      legs: clamp(ms.legs ?? 0, 0, 1),
    },
    summary_seed: {
      strongest_feature: strongestFeature,
      improvement_hint: "Consistent weekly scans make trend language smarter and more personal.",
      visibility_note: String(session?.confidenceNote || "").slice(0, 160),
    },
  };
}

function buildTrendNarrative({ session, recentScans = [], gender = "male", goalType = "", localDay = "" }) {
  const scans = sanitizeRecentPoseScans(recentScans);
  const current = session?.muscleSignals || {};
  const avg = averagePoseSignals(scans);
  const keys = ["delts", "arms", "lats", "chest", "back", "waist_taper", "legs"];
  const deltas = keys.map((k) => ({ key: k, delta: Number(current?.[k] || 0) - Number(avg?.[k] || 0) }));
  deltas.sort((a, b) => b.delta - a.delta);
  const top = deltas[0] || { key: gender === "female" ? "waist_taper" : "arms", delta: 0 };
  const label = poseSignalLabel(top.key, gender);
  const days = scans[0]?.local_day ? `${scans.length} recent check${scans.length > 1 ? "s" : ""}` : "your recent baseline";
  const goalHint = normalizeGoalType(goalType, gender);

  let momentumNote = "";
  let baselineComparison = "";
  let highlight = "";

  if (!scans.length) {
    if (gender === "female") {
      momentumNote = "This is your baseline beauty check, so the win today is locking in a clean starting point you can build on. The overall presentation already reads polished, pretty, and athletic.";
      baselineComparison = "First physique memory saved — future scans can now track how your silhouette and polish evolve over time.";
      highlight = "Baseline beauty check locked in";
    } else {
      momentumNote = "This is your baseline physique check, so the win today is locking in a strong starting point you can measure against. The overall presentation already reads muscular, athletic, and built.";
      baselineComparison = "First physique memory saved — future scans can now track how much more jacked and dialed-in you look over time.";
      highlight = "Baseline jacked check locked in";
    }
  } else if (top.delta > 0.045) {
    if (gender === "female") {
      momentumNote = `Compared with ${days}, your ${label} is reading cleaner today, and the overall silhouette feels more polished and beautifully put together. This scan lands with a prettier, more confident energy while still feeling athletic and real.`;
      baselineComparison = `Your ${label} is trending above your recent baseline, which is a strong sign that your current look is becoming more refined and photogenic.`;
      highlight = `${label.charAt(0).toUpperCase() + label.slice(1)} is trending prettier than your recent baseline`;
    } else {
      momentumNote = `Compared with ${days}, your ${label} is reading stronger today, and the overall physique comes across more muscular and built. This scan has a fuller, more jacked feel than your recent baseline without forcing it.`;
      baselineComparison = `Your ${label} is trending above your recent baseline, which is a strong sign that your look is getting sharper and more powerful over time.`;
      highlight = `${label.charAt(0).toUpperCase() + label.slice(1)} is trending more jacked than your recent baseline`;
    }
  } else {
    if (gender === "female") {
      momentumNote = `Compared with ${days}, this look is staying very consistent, which is exactly what makes your progress easier to trust. The overall read feels polished, pretty, and steadily more put together.`;
      baselineComparison = "Your recent scans are clustering in a good way, which means your silhouette and presentation are becoming more repeatable and reliable.";
      highlight = "Your polished look is staying consistent";
    } else {
      momentumNote = `Compared with ${days}, this look is staying very consistent, which is exactly what makes your progress easier to trust. The overall read still lands as muscular, strong, and convincingly built.`;
      baselineComparison = "Your recent scans are clustering in a good way, which means your physique presentation is becoming more repeatable and easier to track.";
      highlight = "Your muscular look is staying consistent";
    }
  }

  if (goalHint === "cutting") {
    baselineComparison += gender === "female"
      ? " For a leaner goal, that kind of cleaner presentation is exactly the right direction."
      : " For a leaner goal, that sharper presentation is exactly the right direction.";
  } else if (goalHint === "bulking") {
    baselineComparison += gender === "female"
      ? " For a sculpted-building goal, the extra presence is a great sign."
      : " For a muscle-building goal, the extra fullness is a great sign.";
  }

  return {
    momentumNote,
    baselineComparison,
    highlight,
    local_day: localDay || dayKeyUTC(),
  };
}


// -------------------- ENTITLEMENTS --------------------
const ENTITLED = new Set(["active", "past_due", "trialing"]);
function nowSec() { return Math.floor(Date.now() / 1000); }

function tsToSec(ts) {
  if (!ts) return 0;
  const n = typeof ts === "number" ? ts : Math.floor(new Date(ts).getTime() / 1000);
  return Number.isFinite(n) ? n : 0;
}

async function isEntitled(user_id) {
  if (!user_id || !supabaseAdmin) return false;

  // Prefer entitlement view if present
  try {
    const { data: ent, error } = await supabaseAdmin
      .from("v_user_entitlements")
      .select("status, trial_end, cancel_at_period_end, current_period_end")
      .eq("user_id", user_id)
      .maybeSingle();

    if (!error && ent) {
      const status = String(ent.status || "").toLowerCase();
      const trialEnd = tsToSec(ent.trial_end);
      const entitledByStatus = ENTITLED.has(status);
      const entitledByTrial = trialEnd > nowSec(); // honor trial through end even if canceled
      return entitledByStatus || entitledByTrial;
    }
  } catch { /* fall through */ }

  // Fallback: most recent app_subscriptions row
  try {
    const { data, error } = await supabaseAdmin
      .from("app_subscriptions")
      .select("status, trial_end, current_period_end, cancel_at_period_end, updated_at")
      .eq("user_id", user_id)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error || !data?.length) return false;
    const row = data[0];
    const status = String(row.status || "").toLowerCase();
    const trialEnd = tsToSec(row.trial_end);
    const entitledByStatus = ENTITLED.has(status);
    const entitledByTrial = trialEnd > nowSec();
    return entitledByStatus || entitledByTrial;
  } catch {
    return false;
  }
}

// Resolve user_id from headers OR body.user_id OR body.email -> app_users.id
async function resolveUserId(req, { user_id, email }) {
  const hdr = getUserIdFromHeaders(req);
  if (hdr) return hdr;

  if (user_id) return user_id;

  const e = (email || "").trim().toLowerCase();
  if (!e) return null;

  try {
    const { data, error } = await supabaseAdmin
      .from("app_users")
      .select("id")
      .eq("email", e)
      .maybeSingle();

    if (!error && data?.id) return data.id;
  } catch { /* ignore */ }
  return null;
}

// -------------------- FREE PASS --------------------
const FREE_LIMITS = {
  default: 3,
  frame_check: 1,
  body_scan: 1,
  pose_session: 3,
};

function getFreeLimitForFeature(feature) {
  return FREE_LIMITS[feature] ?? FREE_LIMITS.default;
}
const freeMem = new Map();

function memAllow(clientId, feature) {
  const key = `m:${clientId}:${feature}`;
  const today = dayKeyUTC();
  const limit = getFreeLimitForFeature(feature);
  const rec = freeMem.get(key);
  if (!rec || rec.day !== today) {
    freeMem.set(key, { used: 1, day: today });
    return { allowed: true, remaining: limit - 1 };
  }
  if (rec.used < limit) {
    rec.used += 1;
    return { allowed: true, remaining: limit - rec.used };
  }
  return { allowed: false, remaining: 0 };
}

async function dbAllow(clientId, feature, userId) {
  if (!supabaseAdmin) return memAllow(clientId, feature);
  try {
    const today = dayKeyUTC();
    const limit = getFreeLimitForFeature(feature);

    const { data, error } = await supabaseAdmin
      .from("ai_free_passes")
      .select("uses")
      .eq("client_id", clientId)
      .eq("feature", feature)
      .eq("day_key", today)
      .maybeSingle();

    if (error && error.code !== "PGRST116") return memAllow(clientId, feature);

    if (!data) {
      const ins = await supabaseAdmin
        .from("ai_free_passes")
        .insert([{ client_id: clientId, user_id: userId || null, feature, day_key: today, uses: 1 }])
        .select("uses")
        .single();

      if (ins.error) return memAllow(clientId, feature);
      return { allowed: true, remaining: limit - 1 };
    }

    const currentUses = data.uses || 0;
    if (currentUses >= limit) return { allowed: false, remaining: 0 };

    const upd = await supabaseAdmin
      .from("ai_free_passes")
      .update({ uses: currentUses + 1, user_id: userId || null })
      .eq("client_id", clientId)
      .eq("feature", feature)
      .eq("day_key", today)
      .select("uses")
      .single();

    if (upd.error) return memAllow(clientId, feature);
    const newUses = upd.data?.uses ?? currentUses + 1;
    return { allowed: true, remaining: Math.max(0, limit - newUses) };
  } catch {
    return memAllow(clientId, feature);
  }
}

async function allowFreeFeature({ req, feature, userId }) {
  const clientId = idKey(req, userId);
  return dbAllow(clientId, feature, userId);
}



// -------------------- VERDICT FALLBACK --------------------

function fallbackDailyVerdictFromPrompt(p) {
  const text = String(p || "");
  const grabNum = (label) => {
    const m = text.match(new RegExp(`${label}:\\s*([0-9]+(?:\\.[0-9]+)?)`, "i"));
    return m ? Number(m[1]) : null;
  };

  const consumed = grabNum("Consumed") ?? 0;
  const burned = grabNum("Burned") ?? 0;
  const net = grabNum("Net") ?? (consumed - burned);
  const protein = grabNum("Protein") ?? null;
  const carbs = grabNum("Carbs") ?? null;
  const fat = grabNum("Fat") ?? null;

  const goalMatch = text.match(/Goal:\s*([a-z_]+)/i);
  const goalType = (goalMatch?.[1] || "maintain").replace(/_/g, " ");

  // Checklist summary (best-effort parse)
  const doneMatch = text.match(/Checklist Done:\s*(\d+)\/(\d+)/i);
  const done = doneMatch ? Number(doneMatch[1]) : null;
  const total = doneMatch ? Number(doneMatch[2]) : null;

  const lines = [];
  lines.push(`Today’s Verdict (${goalType}):`);
  lines.push(`• Calories: ${Math.round(consumed)} in, ${Math.round(burned)} out → net ${Math.round(net)}.`);
  if (protein != null || carbs != null || fat != null) {
    const parts = [];
    if (protein != null) parts.push(`${Math.round(protein)}g protein`);
    if (carbs != null) parts.push(`${Math.round(carbs)}g carbs`);
    if (fat != null) parts.push(`${Math.round(fat)}g fat`);
    lines.push(`• Macros: ${parts.join(" · ")}.`);
  }
  if (done != null && total != null) {
    lines.push(`• Checklist: ${done}/${total} completed — keep stacking wins.`);
  }

  lines.push("");
  lines.push("Win move (do this next):");
  if (protein != null && protein < 120) {
    lines.push("1) Add a high-protein meal/snack (30–50g) in the next 2–3 hours.");
  } else {
    lines.push("1) Log your next meal immediately when you start eating (2 taps, keep streak alive).");
  }
  if (burned < 150) {
    lines.push("2) Do a quick 10–20 min walk or short lift session to push output up.");
  } else {
    lines.push("2) Hydrate + get a clean carb window around training if you lift again.");
  }

  lines.push("");
  lines.push("If the AI ever fails to load, this fallback will still keep you moving — refresh and try again.");
  return lines.join("\n").trim();
}

// -------------------- TIMEOUT --------------------
const OPENAI_TIMEOUT_MS = 20000;
function withTimeout(promise, ms, onTimeoutValue) {
  return new Promise((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (!settled) { settled = true; resolve(onTimeoutValue); }
    }, ms);
    promise.then((v) => {
      if (!settled) { settled = true; clearTimeout(t); resolve(v); }
    }).catch(() => {
      if (!settled) { settled = true; clearTimeout(t); resolve(onTimeoutValue); }
    });
  });
}

// -------------------- WORKOUTS --------------------
function normalizeIntent(intent) {
  if (!intent) return "general";
  const s = String(intent).toLowerCase();
  if (s === "yoga" || s === "pilates" || s === "yoga_pilates") return "yoga_pilates";
  return s;
}

const TITLE_BY_INTENT = {
  general: "Balanced Session",
  bodybuilder: "Hypertrophy Split",
  powerlifter: "Strength-Focused Session",
  endurance: "Conditioning + Strength Mix",
  yoga_pilates: "Mobility-Centered Strength Flow",
};

function normalizeFocus(focus) {
  const s = String(focus || "").toLowerCase().replace(/\s+/g, "_");
  const map = {
    upper_body: "upper",
    lower_body: "lower",
    full_body: "full",
    chest_and_back: "chest_back",
    shoulders_and_arms: "shoulders_arms",
    glutes_and_hamstrings: "glutes_hamstrings",
    quads_and_calves: "quads_calves",
    push_pull: "push",
    push_day: "push",
    pull_day: "pull",
    legs_day: "legs",
    conditioning: "cardio",
  };
  return map[s] || s || "upper";
}

function biasBlock(b, intent) {
  const copy = { ...b };
  const asRange = (lo, hi) => `${lo}-${hi}`;
  switch (intent) {
    case "bodybuilder":
      copy.sets = copy.sets ?? 4; copy.reps = copy.reps ?? asRange(8, 12); copy.tempo = copy.tempo || "2-1-2"; break;
    case "powerlifter":
      copy.sets = copy.sets ?? 5; copy.reps = copy.reps ?? asRange(3, 5); copy.tempo = copy.tempo || "1-1-2"; break;
    case "endurance":
      copy.sets = copy.sets ?? 3; copy.reps = copy.reps ?? asRange(12, 20); copy.tempo = copy.tempo || "2-1-2"; break;
    case "yoga_pilates":
      copy.sets = copy.sets ?? 3; copy.reps = copy.reps ?? asRange(10, 15); copy.tempo = copy.tempo || "2-1-2"; break;
    default:
      copy.sets = copy.sets ?? 3; copy.reps = copy.reps ?? asRange(8, 12); copy.tempo = copy.tempo || "2-1-2";
  }
  return copy;
}

function intentBank(focus, intent) {
  const focusKey = normalizeFocus(focus);
  const base = {
    upper: [
      { exercise: "Incline Dumbbell Press" },
      { exercise: "Weighted Pull-Up" },
      { exercise: "Seated Cable Row" },
      { exercise: "Lateral Raise" },
      { exercise: "Cable Triceps Pressdown" },
      { exercise: "Incline Dumbbell Curl" },
    ],
    lower: [
      { exercise: "Back Squat" },
      { exercise: "Romanian Deadlift" },
      { exercise: "Leg Press" },
      { exercise: "Walking Lunge" },
      { exercise: "Calf Raise (Standing)" },
    ],
    full: [
      { exercise: "Barbell Clean & Press" },
      { exercise: "Pull-Up" },
      { exercise: "Front Squat" },
      { exercise: "Push-Up" },
      { exercise: "Kettlebell Swing" },
    ],
    chest_back: [
      { exercise: "Barbell Bench Press" },
      { exercise: "Chest-Supported Row" },
      { exercise: "Incline Dumbbell Press" },
      { exercise: "Lat Pulldown" },
      { exercise: "Cable Fly" },
    ],
    shoulders_arms: [
      { exercise: "Overhead Press" },
      { exercise: "Lateral Raise" },
      { exercise: "Face Pull" },
      { exercise: "Cable Curl" },
      { exercise: "Rope Triceps Extension" },
    ],
    legs: [
      { exercise: "Back Squat" },
      { exercise: "Romanian Deadlift" },
      { exercise: "Leg Press" },
      { exercise: "Walking Lunge" },
      { exercise: "Calf Raise (Seated)" },
    ],
    glutes_hamstrings: [
      { exercise: "Hip Thrust" },
      { exercise: "Romanian Deadlift" },
      { exercise: "Bulgarian Split Squat" },
      { exercise: "Hamstring Curl" },
      { exercise: "45° Back Extension" },
    ],
    quads_calves: [
      { exercise: "Front Squat" },
      { exercise: "Leg Press (Feet Low)" },
      { exercise: "Leg Extension" },
      { exercise: "Walking Lunge" },
      { exercise: "Standing Calf Raise" },
    ],
    push: [
      { exercise: "Barbell Bench Press" },
      { exercise: "Overhead Press" },
      { exercise: "Incline Dumbbell Press" },
      { exercise: "Lateral Raise" },
      { exercise: "Cable Triceps Pressdown" },
    ],
    pull: [
      { exercise: "Weighted Pull-Up" },
      { exercise: "Barbell Row" },
      { exercise: "Seated Cable Row" },
      { exercise: "Face Pull" },
      { exercise: "Incline Dumbbell Curl" },
    ],
    cardio: [
      { exercise: "Bike Intervals (Moderate)" },
      { exercise: "Rowing Machine (steady)" },
      { exercise: "Jump Rope" },
      { exercise: "Incline Treadmill Walk" },
    ],
  };

  const yogaMobility = {
    upper: [
      { exercise: "Scapular Push-Up" },
      { exercise: "Downward Dog to Plank Flow" },
      { exercise: "Band External Rotation" },
      { exercise: "Cobra to Child’s Pose" },
    ],
    lower: [
      { exercise: "Cossack Squat (Bodyweight)" },
      { exercise: "Glute Bridge" },
      { exercise: "World’s Greatest Stretch" },
      { exercise: "Ankle Dorsiflexion Drills" },
    ],
    full: [
      { exercise: "Sun Salutation Flow" },
      { exercise: "Bodyweight Split Squat" },
      { exercise: "Hollow Body Hold" },
      { exercise: "Cat-Cow + Thoracic Rotation" },
    ],
    chest_back: [
      { exercise: "Push-Up to Down-Dog Flow" },
      { exercise: "Band Row" },
      { exercise: "Prone Y-T-W" },
      { exercise: "Child’s Pose Lat Stretch" },
    ],
    shoulders_arms: [
      { exercise: "Pike Shoulder Taps" },
      { exercise: "Band External Rotation" },
      { exercise: "Thread-the-Needle Stretch" },
      { exercise: "Triceps Stretch" },
    ],
    legs: [
      { exercise: "Bodyweight Squat + Pause" },
      { exercise: "Glute Bridge" },
      { exercise: "Lunge with Rotation" },
      { exercise: "Couch Stretch" },
    ],
    glutes_hamstrings: [
      { exercise: "Single-Leg Glute Bridge" },
      { exercise: "Good Morning (PVC/Band)" },
      { exercise: "90/90 Hip Flow" },
      { exercise: "Hamstring Stretch on Box" },
    ],
    quads_calves: [
      { exercise: "Split Squat (Bodyweight)" },
      { exercise: "Wall Calf Raise" },
      { exercise: "Quad Stretch" },
      { exercise: "Ankle Mobility Drills" },
    ],
    push: [
      { exercise: "Incline Push-Up" },
      { exercise: "Wall Slide" },
      { exercise: "Serratus Punch" },
      { exercise: "Doorway Pec Stretch" },
    ],
    pull: [
      { exercise: "Band Pull-Apart" },
      { exercise: "Inverted Row (Bodyweight)" },
      { exercise: "Scapular Retraction Drill" },
      { exercise: "Lat Stretch on Bench" },
    ],
    cardio: [
      { exercise: "Jump Rope Intervals (Light)" },
      { exercise: "Brisk Walk" },
      { exercise: "Bike Easy Spin" },
      { exercise: "Mobility Flow" },
    ],
  };

  const cardioSprinkle = { exercise: "Bike Intervals (Moderate)" };

  let bank;
  const normIntent = normalizeIntent(intent);

  if (normIntent === "yoga_pilates") {
    bank = yogaMobility[focusKey] || yogaMobility.full;
  } else {
    bank = base[focusKey] || base.upper;
    if (normIntent === "endurance" && focusKey !== "cardio") {
      bank = [...bank, cardioSprinkle];
    }
    if (normIntent === "powerlifter") {
      if (["upper","push","pull","chest_back","shoulders_arms"].includes(focusKey)) {
        bank = [
          { exercise: "Barbell Bench Press" },
          { exercise: "Weighted Pull-Up" },
          { exercise: "Barbell Row" },
          { exercise: "Overhead Press" },
          { exercise: "Face Pull" },
        ];
      } else if (["lower","legs","glutes_hamstrings","quads_calves"].includes(focusKey)) {
        bank = [
          { exercise: "Low-Bar Back Squat" },
          { exercise: "Conventional Deadlift" },
          { exercise: "Paused Squat" },
          { exercise: "Hamstring Curl" },
        ];
      } else {
        bank = [
          { exercise: "Front Squat" },
          { exercise: "Bench Press" },
          { exercise: "Deadlift (technique sets)" },
          { exercise: "Plank" },
        ];
      }
    }
    if (normIntent === "bodybuilder" && ["upper","push","chest_back","shoulders_arms"].includes(focusKey)) {
      bank = [
        { exercise: "Incline Dumbbell Press" },
        { exercise: "Chest Fly (Cable)" },
        { exercise: "Lat Pulldown" },
        { exercise: "Seated Row" },
        { exercise: "Lateral Raise" },
        { exercise: "Cable Curl" },
        { exercise: "Rope Triceps Extension" },
      ];
    }
  }

  return bank;
}

function fallbackWorkoutPack({ focus = "upper", goal = "maintenance", intent = "general" }, count = 5) {
  const normIntent = normalizeIntent(intent);
  const base = intentBank(focus, normIntent);
  const title = `${TITLE_BY_INTENT[normIntent] || TITLE_BY_INTENT.general} (${normalizeFocus(focus) || "upper"})`;

  const out = [];
  for (let i = 0; i < Math.max(1, Math.min(count, 8)); i++) {
    const rotated = base.slice(i % base.length).concat(base.slice(0, i % base.length));
    const blocks = rotated.map(b => biasBlock(b, normIntent));
    out.push({ title, blocks });
  }
  return out;
}

async function openAIWorkoutPack(payload, count = 5) {
  if (!openai) return fallbackWorkoutPack(payload, count);

  const {
    focus = "upper",
    goal = "maintenance",
    intent = "general",
    equipment = []
  } = payload;

  const normIntent = normalizeIntent(intent);
  const normFocus  = normalizeFocus(focus);

  const biasText = {
    bodybuilder: `Prioritize hypertrophy: 8–12 reps, moderate rest, include isolation accessories.`,
    powerlifter: `Prioritize strength: 3–5 reps on compounds, longer rest, technique focus.`,
    endurance: `Prioritize conditioning: higher reps (12–20), optional cardio finisher.`,
    yoga_pilates: `Prioritize mobility/core + lighter strength; avoid heavy barbell emphasis.`,
    general: `Balanced mix of compounds and accessories with moderate volume.`
  }[normIntent];

  const sys = `You are a certified strength coach. Output ONLY valid JSON:
{"suggestions":[{"title":"...","blocks":[{"exercise":"...","sets":3,"reps":"8-12","tempo":"2-1-2"}]}]}
No prose, no markdown. Exercises must be common and safe. 4–6 exercises per suggestion.`;

  const usr = `Create ${count} workout options tailored to:
- split_focus: ${normFocus}
- goal: ${goal}
- training_intent: ${normIntent}
- equipment: ${equipment.join(", ") || "bodyweight"}
Bias:
- ${biasText}
Rules:
- 4–6 exercises per option
- reps can be a range string (e.g., "8-12")
- include optional "tempo" like "2-1-2"
- use only movements feasible with the allowed equipment
- If split_focus is "cardio", favor conditioning intervals or steady-state options; otherwise emphasize resistance training for that split`;

  const call = openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: usr }
    ],
    temperature: 0.6
  });

  const res = await withTimeout(call, OPENAI_TIMEOUT_MS, null);
  if (!res) return fallbackWorkoutPack(payload, count);

  const txt = res?.choices?.[0]?.message?.content || "";
  let json = null;
  try { json = JSON.parse(txt); } catch {}
  const suggestions = Array.isArray(json?.suggestions)
    ? json.suggestions
    : fallbackWorkoutPack({ ...payload, focus: normFocus }, count);

  const patched = suggestions.map(sug => ({
    title: sug.title || `${TITLE_BY_INTENT[normIntent] || "Workout"} (${normFocus})`,
    blocks: (Array.isArray(sug.blocks) ? sug.blocks : []).map(b => biasBlock(b, normIntent))
  }));
  return patched;
}

// -------------------- MEALS --------------------
function normalizeDiet(d) {
  const s = String(d || "omnivore").toLowerCase();
  if (s === "veggie") return "vegetarian";
  return s;
}

function fallbackMealPack({ diet = "omnivore", intent = "general", proteinTargetG = 120, calorieBias = 0 }, count = 3) {
  const d = normalizeDiet(diet);
  const mealsByDiet = {
    vegan: [
      { title: "Tofu Scramble Bowl", items: [
        { food: "Tofu", qty: "200g", protein_g: 24, calories: 160 },
        { food: "Quinoa", qty: "1 cup cooked", protein_g: 8, calories: 220 },
        { food: "Spinach", qty: "1 cup", protein_g: 2, calories: 20 },
      ]},
      { title: "Lentil Pasta Marinara", items: [
        { food: "Lentil Pasta", qty: "2 oz dry", protein_g: 14, calories: 190 },
        { food: "Marinara", qty: "1/2 cup", protein_g: 2, calories: 70 },
      ]},
      { title: "Tempeh Stir-Fry", items: [
        { food: "Tempeh", qty: "150g", protein_g: 27, calories: 270 },
        { food: "Mixed Veg", qty: "2 cups", protein_g: 6, calories: 120 },
        { food: "Brown Rice", qty: "1 cup cooked", protein_g: 5, calories: 215 },
      ]},
    ],
    vegetarian: [
      { title: "Greek Yogurt Parfait", items: [
        { food: "Greek Yogurt", qty: "200g", protein_g: 20, calories: 140 },
        { food: "Berries", qty: "1 cup", protein_g: 1, calories: 80 },
        { food: "Granola", qty: "1/4 cup", protein_g: 3, calories: 110 },
      ]},
      { title: "Egg & Avocado Toast", items: [
        { food: "Eggs", qty: "2", protein_g: 12, calories: 140 },
        { food: "Whole-grain Bread", qty: "2 slices", protein_g: 8, calories: 200 },
        { food: "Avocado", qty: "1/2", protein_g: 2, calories: 120 },
      ]},
      { title: "Cottage Cheese Bowl", items: [
        { food: "Cottage Cheese", qty: "1 cup", protein_g: 24, calories: 220 },
        { food: "Cherry Tomatoes", qty: "1 cup", protein_g: 2, calories: 30 },
      ]},
    ],
    pescatarian: [
      { title: "Tuna Bowl", items: [
        { food: "Tuna (canned)", qty: "1 can", protein_g: 26, calories: 120 },
        { food: "Rice", qty: "1 cup cooked", protein_g: 5, calories: 215 },
        { food: "Cucumber", qty: "1 cup", protein_g: 1, calories: 16 },
      ]},
      { title: "Salmon & Veg Plate", items: [
        { food: "Salmon", qty: "5 oz", protein_g: 28, calories: 300 },
        { food: "Broccoli", qty: "1.5 cups", protein_g: 4, calories: 45 },
        { food: "Olive Oil", qty: "1 tbsp", protein_g: 0, calories: 120 },
      ]},
      { title: "Shrimp Tacos", items: [
        { food: "Shrimp", qty: "6 oz", protein_g: 36, calories: 180 },
        { food: "Corn Tortillas", qty: "3", protein_g: 6, calories: 180 },
        { food: "Slaw", qty: "1 cup", protein_g: 2, calories: 80 },
      ]},
    ],
    keto: [
      { title: "Eggs & Cheese Omelet", items: [
        { food: "Eggs", qty: "3", protein_g: 18, calories: 210 },
        { food: "Cheese", qty: "1 oz", protein_g: 7, calories: 110 },
      ]},
      { title: "Chicken Caesar (no croutons)", items: [
        { food: "Chicken Breast", qty: "6 oz", protein_g: 50, calories: 280 },
        { food: "Romaine + Dressing", qty: "large", protein_g: 4, calories: 220 },
      ]},
      { title: "Salmon & Asparagus", items: [
        { food: "Salmon", qty: "6 oz", protein_g: 34, calories: 360 },
        { food: "Asparagus", qty: "2 cups", protein_g: 5, calories: 60 },
        { food: "Butter", qty: "1 tbsp", protein_g: 0, calories: 100 },
      ]},
    ],
    mediterranean: [
      { title: "Chicken Pita Bowl", items: [
        { food: "Chicken", qty: "6 oz", protein_g: 50, calories: 280 },
        { food: "Pita + Hummus", qty: "1 + 2 tbsp", protein_g: 8, calories: 270 },
        { food: "Veg Salad", qty: "large", protein_g: 3, calories: 70 },
      ]},
      { title: "Tuna Pasta Salad", items: [
        { food: "Tuna", qty: "1 can", protein_g: 26, calories: 120 },
        { food: "Pasta", qty: "2 oz dry", protein_g: 7, calories: 210 },
        { food: "Olive oil + Veg", qty: "—", protein_g: 0, calories: 140 },
      ]},
      { title: "Chickpea Bowl", items: [
        { food: "Chickpeas", qty: "1.5 cups", protein_g: 24, calories: 360 },
        { food: "Feta", qty: "1 oz", protein_g: 4, calories: 80 },
        { food: "Cucumber/Tomato", qty: "2 cups", protein_g: 3, calories: 50 },
      ]},
    ],
    omnivore: [
      { title: "Chicken Rice Bowl", items: [
        { food: "Chicken Breast", qty: "6 oz", protein_g: 50, calories: 280 },
        { food: "Rice", qty: "1 cup cooked", protein_g: 5, calories: 215 },
        { food: "Veg", qty: "1.5 cups", protein_g: 3, calories: 50 },
      ]},
      { title: "Beef & Potatoes", items: [
        { food: "Lean Beef (90/10)", qty: "6 oz", protein_g: 42, calories: 330 },
        { food: "Potatoes", qty: "8 oz", protein_g: 6, calories: 170 },
      ]},
      { title: "Turkey Wrap", items: [
        { food: "Turkey Deli", qty: "6 oz", protein_g: 36, calories: 210 },
        { food: "Whole-grain Wrap", qty: "1", protein_g: 6, calories: 190 },
        { food: "Veg", qty: "1 cup", protein_g: 2, calories: 30 },
      ]},
    ]
  };

  const pool = mealsByDiet[d] || mealsByDiet.omnivore;
  const plans = [];
  for (let i = 0; i < Math.max(1, Math.min(count, 6)); i++) {
    const pick = pool[i % pool.length];
    const totals = pick.items.reduce((acc, it) => ({
      calories: acc.calories + (it.calories || 0),
      protein_g: acc.protein_g + (it.protein_g || 0)
    }), { calories: 0, protein_g: 0 });

    plans.push({
      title: pick.title,
      items: pick.items,
      total_calories: totals.calories + (calorieBias || 0),
      total_protein_g: totals.protein_g
    });
  }
  if (["bodybuilder","powerlifter","recomp"].includes(intent) && proteinTargetG) {
    return plans.map(p => ({
      ...p,
      note: p.total_protein_g < proteinTargetG / 3
        ? "Consider adding a shake or extra lean protein to hit targets."
        : undefined
    }));
  }
  return plans;
}

function flattenMealsToSuggestions(meals) {
  return (Array.isArray(meals) ? meals : []).map((m) => {
    const calories =
      Number(m.total_calories) || Number(m.calories) ||
      Number(m.kcal) || Number(m.energy_kcal) ||
      Number(m?.nutrition?.calories) || 0;

    const protein_g =
      Number(m.total_protein_g) || Number(m.protein_g) ||
      Number(m?.nutrition?.protein_g) || 0;

    const carbs_g =
      Number(m.total_carbs_g) || Number(m.carbs_g) ||
      Number(m?.nutrition?.carbs_g) || 0;

    const fat_g =
      Number(m.total_fat_g) || Number(m.fat_g) ||
      Number(m?.nutrition?.fat_g) || 0;

    return {
      title: m.title || m.name || "Suggested meal",
      calories: Math.max(0, calories || 0),
      protein_g: Math.max(0, protein_g || 0),
      carbs_g: Math.max(0, carbs_g || 0),
      fat_g: Math.max(0, fat_g || 0),
      prepMinutes: m.prepMinutes ?? m.prep_min ?? null
    };
  });
}

async function openAIMealPack(payload, count = 3) {
  if (!openai) return flattenMealsToSuggestions(fallbackMealPack(payload, count));

  const { diet = "omnivore", intent = "general", calorieBias = 0, proteinTargetG = 120 } = payload;
  const d = normalizeDiet(diet);
  const normIntent = normalizeIntent(intent);

  const biasText = {
    bodybuilder: `High protein (aim near ${proteinTargetG} g/day), moderate carbs, moderate-low fats.`,
    powerlifter: `High protein, sufficient carbs for training performance, moderate fats.`,
    endurance: `Adequate carbs, moderate protein, lighter fats.`,
    yoga_pilates: `Light meals, focus on whole foods, modest protein.`,
    general: `Balanced macro distribution.`
  }[normIntent];

  const sys = `You are a sports nutrition coach. Output ONLY valid JSON matching this schema:
{"suggestions":[{"title":"...","calories":650,"protein_g":40,"carbs_g":60,"fat_g":20}]}
- No prose or markdown.
- "calories", "protein_g", "carbs_g", "fat_g" must be numbers.
- Respect the diet preference strictly. Create ${count} unique meals.`;

  const usr = `Create ${count} meal ideas for:
- diet_preference: ${d}
- training_intent: ${normIntent}
- target_protein_g: ~${proteinTargetG}
- calorie_bias_per_meal: ${calorieBias}
Bias:
- ${biasText}
Rules:
- Output only the top-level flattened values per meal (no nested items).
- Each suggestion must include: title, calories, protein_g, carbs_g, fat_g (numbers).
- Do not include any fields other than those required.`;

  const call = openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: usr }
    ],
    temperature: 0.5
  });

  const res = await withTimeout(call, OPENAI_TIMEOUT_MS, null);
  if (!res) return flattenMealsToSuggestions(fallbackMealPack(payload, count));

  const txt = res?.choices?.[0]?.message?.content || "";
  let json = null;
  try { json = JSON.parse(txt); } catch {}
  let suggestions = Array.isArray(json?.suggestions) ? json.suggestions : null;

  if (!suggestions) {
    const meals = Array.isArray(json?.meals) ? json.meals : fallbackMealPack(payload, count);
    suggestions = flattenMealsToSuggestions(meals);
  }

  suggestions = suggestions.map(s => ({
    ...s,
    calories: Math.max(0, Number(s.calories || 0) + (Number(calorieBias) || 0))
  }));

  return suggestions;
}

// -------------------- COACH --------------------
function fallbackCoachSuggestions({ intent = "general" }, count = 3) {
  const norm = normalizeIntent(intent);
  const msgsByIntent = {
    bodybuilder: [
      "Progressive overload beats variety. Add 2.5–5 lb when you hit the top of your rep range.",
      "Protein first: anchor each meal with 25–45 g.",
      "Tiny surplus + consistency = visible size in 8–12 weeks."
    ],
    powerlifter: [
      "Prioritize quality singles @ RPE 7–8 to practice technique under load.",
      "Pull twice for every heavy squat week to keep your back strong.",
      "Sleep is your legal PED—7.5+ hours."
    ],
    endurance: [
      "Fuel long sessions with 30–60g carbs/hour. Your lifts will thank you.",
      "Keep easy days easy to make hard days actually hard.",
      "Protein target still matters: ~0.7–1.0 g/lb."
    ],
    yoga_pilates: [
      "Breathe through transitions—exhale on exertion, inhale on stretch.",
      "Pair mobility with light strength to cement range of motion.",
      "Consistency and gentle progressions beat intensity spikes."
    ],
    general: [
      "Small habits compound: walk 8–10k steps and lift 3x/week.",
      "Track protein and total calories; let the rest be flexible.",
      "Perfect is the enemy of done—just start the session."
    ]
  };
  const pool = msgsByIntent[norm] || msgsByIntent.general;
  return Array.from({ length: Math.max(1, Math.min(count, 5)) }, (_, i) => ({
    message: pool[i % pool.length]
  }));
}

// -------------------- MAIN HANDLER --------------------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = await readJson(req);
  const feature = String(body?.feature || body?.type || body?.mode || "workout").toLowerCase();


const freeBypass =
  feature === "pose" ||
  feature === "body_scan" ||
  feature === "frame_check" ||
  feature === "physique" ||
  feature === "physique_scan";


  // Resolve user id robustly (headers OR body.user_id OR body.email)
  const email = (body?.email || "").trim().toLowerCase();
  const resolvedUserId = await resolveUserId(req, { user_id: body?.user_id || null, email });

  const {
    constraints = {},
    count = 5,

    // workout
    goal = "maintenance",
    focus = "upper",
    equipment = ["dumbbell", "barbell", "machine", "bodyweight"],

    // meals
    diet = constraints?.diet_preference || "omnivore",
    proteinTargetG = constraints?.protein_target_daily_g || constraints?.protein_per_meal_g || 120,
    calorieBias = constraints?.calorie_bias || 0
  } = body || {};

  // 1) Pro/Trial users bypass limits (honors trial until trial_end even if canceled)
  const pro = await isEntitled(resolvedUserId);

  // 2) If not Pro/Trial → per-feature free-pass
  if (!pro && !freeBypass) {
    const pass = await allowFreeFeature({ req, feature, userId: resolvedUserId });
    if (!pass.allowed) {
      res.status(402).json({ error: "Upgrade required", reason: "limit_reached" });
      return;
    }
  }

  // 3) Route by feature
  if (feature === "workout") {
    try {
      const intent = normalizeIntent(constraints?.training_intent || constraints?.intent || "general");
      const suggestions = await openAIWorkoutPack(
        { focus, goal, intent, equipment },
        Math.max(1, Math.min(parseInt(count, 10) || 5, 8))
      );
      res.status(200).json({ suggestions });
      return;
    } catch (e) {
      console.error("[ai/generate] workout error:", e);
      const fallback = fallbackWorkoutPack(
        { focus, goal, intent: normalizeIntent(constraints?.training_intent || "general") },
        Math.max(1, Math.min(parseInt(count, 10) || 5, 8))
      );
      res.status(200).json({ suggestions: fallback });
      return;
    }
  }

  if (feature === "meal") {
    try {
      const intent = normalizeIntent(constraints?.training_intent || "general");
      const suggestions = await openAIMealPack(
        { diet, intent, proteinTargetG, calorieBias },
        Math.max(1, Math.min(parseInt(count, 10) || 3, 6))
      );
      res.status(200).json({ suggestions });
      return;
    } catch (e) {
      console.error("[ai/generate] meal error:", e);
      const fallback = flattenMealsToSuggestions(
        fallbackMealPack(
          { diet, intent: normalizeIntent(constraints?.training_intent || "general"), proteinTargetG, calorieBias },
          Math.max(1, Math.min(parseInt(count, 10) || 3, 6))
        )
      );
      res.status(200).json({ suggestions: fallback });
      return;
    }
  }

  if (feature === "coach") {
    try {
      const intent = normalizeIntent(constraints?.training_intent || "general");
      const suggestions = fallbackCoachSuggestions({ intent }, Math.max(1, Math.min(parseInt(count, 10) || 3, 5)));
      res.status(200).json({ suggestions });
      return;
    } catch (e) {
      console.error("[ai/generate] coach error:", e);
      const suggestions = fallbackCoachSuggestions({ intent: "general" }, 3);
      res.status(200).json({ suggestions });
      return;
    }
  }

  if (feature === "body_scan" || feature === "body_scan_beta") {
    try {
      const imageDataUrl = String(
        body?.image_data_url || body?.imageDataUrl || body?.image || body?.photo || ""
      );

      if (!imageDataUrl || !imageDataUrl.startsWith("data:image")) {
        res.status(400).json({ error: "Missing image_data_url" });
        return;
      }

      // OpenAI unavailable: return deterministic fallback so UI never breaks.
      if (!openai) {
        res.status(200).json({ scan: fallbackBodyScan(), warning: "ai_unavailable_fallback" });
        return;
      }

      const sys =
        "You are SlimCal Body Scan (Beta) — cinematic but grounded. " +
        "Return VALID JSON ONLY (no markdown, no extra text). " +
        "This is a rough, non-medical estimate from a single photo. " +
        "Tone must be neutral or positive only — never negative or insulting. " +
        "JSON keys: bodyFatPct (number), leanMassLbs (number), bmi (number), buildArcScore (int 0-100), " +
        "percentile (int 1-99), strengthTag (string), horizon (string), levers (array of 2-4 short strings), confidenceNote (string).";

      const userText =
        "Analyze this full-body photo and estimate the requested fields. " +
        "Be conservative with numbers. If uncertain, use a 'solid baseline' confidence note. " +
        "Levers should be actionable and supportive (protein, training consistency, steps, sleep).";

      const call = openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: sys },
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
        temperature: 0.4,
        max_tokens: 650,
      });

      const ai = await withTimeout(call, OPENAI_TIMEOUT_MS, null);
      if (!ai) {
        res.status(200).json({ scan: fallbackBodyScan(), warning: "ai_timeout_fallback" });
        return;
      }

      const text = ai?.choices?.[0]?.message?.content || "";
      const parsed = safeParseJsonFromText(text) || {};

      const fb = fallbackBodyScan();
      const scan = {
        bodyFatPct: clamp(parsed.bodyFatPct ?? fb.bodyFatPct, 4, 45),
        leanMassLbs: clamp(parsed.leanMassLbs ?? fb.leanMassLbs, 60, 260),
        bmi: clamp(parsed.bmi ?? fb.bmi, 14, 45),
        buildArcScore: Math.round(clamp(parsed.buildArcScore ?? fb.buildArcScore, 0, 100)),
        percentile: Math.round(clamp(parsed.percentile ?? fb.percentile, 1, 99)),
        strengthTag: String(parsed.strengthTag || fb.strengthTag).slice(0, 48),
        horizon: String(parsed.horizon || fb.horizon).slice(0, 80),
        levers: Array.isArray(parsed.levers)
          ? parsed.levers.map((s) => String(s).slice(0, 90)).slice(0, 4)
          : fb.levers,
        confidenceNote: String(parsed.confidenceNote || fb.confidenceNote).slice(0, 140),
      };

      if (!scan.levers?.length) scan.levers = fb.levers;
      if (scan.levers.length < 2) scan.levers = [...scan.levers, ...fb.levers].slice(0, 2);

      res.status(200).json({ scan, ...(body?.debug ? { raw: text } : {}) });
      return;
    } catch (e) {
      console.error("[ai/generate] body_scan error:", e);
      res.status(200).json({ scan: fallbackBodyScan(), warning: "ai_error_fallback" });
      return;
    }
  }



  if (feature === "pose_session" || feature === "pose_session_beta") {
    const requestedGender = String(body?.gender || body?.sex || "male").toLowerCase().trim();
    const gender = requestedGender === "female" ? "female" : "male";
    try {
      const style = String(body?.style || "").toLowerCase();
      const scanMode = String(body?.scanMode || "").toLowerCase();
      const toneMode = normalizePoseToneMode(body?.toneMode || body?.mode || "balanced");
      const goalType = normalizeGoalType(body?.goalType, gender);
      const localDay = String(body?.localDay || body?.local_day || dayKeyUTC()).slice(0, 24);
      const recentScans = sanitizeRecentPoseScans(body?.recentScans);
      const poses = Array.isArray(body?.poses) ? body.poses : [];
      if (!poses.length) {
        res.status(400).json({ error: "Missing poses" });
        return;
      }

      // Validate images (expect data URLs)
      const cleanPoses = poses
        .map((p) => ({
          poseKey: String(p?.poseKey || p?.key || "").trim(),
          title: String(p?.title || "").trim(),
          imageDataUrl: String(p?.image_data_url || p?.imageDataUrl || p?.image || "").trim(),
        }))
        .filter((p) => p.poseKey && p.imageDataUrl && p.imageDataUrl.startsWith("data:image"))
        .slice(0, 5);

      if (cleanPoses.length < 2) {
        res.status(400).json({ error: "At least 2 valid pose images required" });
        return;
      }

      if (!openai) {
        res.status(200).json({ session: fallbackPoseSession(gender), warning: "ai_unavailable_fallback" });
        return;
      }

      const poseTitles = cleanPoses.map((p) => p.title || p.poseKey).filter(Boolean).join(", ");
      const subjectLabel = gender === "female" ? "female physique scan" : "male physique scan";
      const recentContextSummary = summarizeRecentPoseContext(recentScans, gender);
      const goalTone = goalToneHint(goalType, gender);
      const sys =
        "You are SlimCal Pose Session Scanner. " +
        "Return VALID JSON ONLY (no markdown, no extra text). " +
        "You are NOT a medical device. You are estimating visual physique cues from uploaded pose scans. " +
        poseToneInstruction(toneMode, gender) + " " +
        "Do NOT reference any influencer or celebrity. Do NOT assume prior context about the user. " +
        "Write as a fresh, careful analyst focusing on what is visible, flattering, and genuinely supported by the images. " +
        "Output JSON keys (required): " +
        "build_arc (int 0-100), percentile (int 1-99), tierLabel (string), strength (string), horizon_days (int), " +
        "aesthetic_score (number 0-10), toneMode (string), shortHeadline (string 1 sentence), quickSummary (string 2-3 sentences), shareCardSummary (string under 120 chars), detailedExpansion (string 2-4 sentences), " +
        "muscleSignals (object with keys delts, arms, lats, chest, back, waist_taper, legs each number 0..1), " +
        "poseQuality (object mapping poseKey to number 0..1), " +
        "highlights (array 4-7 short strings), levers (array 3-5 short strings), confidenceNote (string), " +
        "report (string: 5-7 short paragraphs separated by \n\n), " +
        "muscleBreakdown (array 6-10 items; each {group: string, note: string, visibility?: string} where note is 2-5 supportive sentences), " +
        "bestDeveloped (array 2-4 strings), biggestOpportunity (array 2-4 strings), poseNotes (array 2-4 strings).";

      const userText =
        `Analyze this ${subjectLabel} using these captures: ${poseTitles || "pose scans"}. ` +
        `Goal context: ${goalTone} ` +
        `Recent physique memory: ${recentContextSummary} ` +
        `Tone mode: ${toneMode}. ` +
        "Estimate supportive physique signals per muscle group (0..1) and pose quality (0..1). " +
        "Very important: only analyze what is actually visible in frame. If a body part is cropped out, covered, too dark, blurred, or only partially visible, explicitly say that it is not clearly in frame or only partially visible. " +
        "Do not invent leg, glute, hip, or lower-body development commentary unless those areas are clearly visible in at least one image. For out-of-frame lower body areas, say you cannot confidently assess them yet. " +
        "Keep every response neutral or positive only, but still specific and intelligent. Avoid words like weak, poor, bad, lacking, flawed, average, mediocre, negative, or disappointing. " +
        "The emotional order should feel like: seen, confident, improving, excited. " +
        "Use specific uplifting truth instead of empty hype. " +
        "The shortHeadline should be a punchy rewarding one-liner. " +
        "The quickSummary should be the default on-screen summary and should feel creator-native, sincere, and motivating. " +
        "The shareCardSummary must be short, clean, positive, and social-share friendly. " +
        "The detailedExpansion should feel like a 'more detail' section with extra nuance and emotional payoff. " +
        "The report should read like a premium full breakdown with short paragraphs, not one long wall of text. " +
        "Highlights should be positive-only and specific. Levers should be actionable: protein, training frequency, steps, sleep, re-scan consistency.";

      const content = [
        { type: "text", text: userText },
        ...cleanPoses.map((p) => ({
          type: "image_url",
          image_url: { url: p.imageDataUrl },
        })),
      ];

      const call = openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: sys },
          { role: "user", content },
        ],
        temperature: 0.4,
        max_tokens: 2200,
        response_format: { type: "json_object" },
      });

      const ai = await withTimeout(call, OPENAI_TIMEOUT_MS, null);
      if (!ai) {
        res.status(200).json({ session: fallbackPoseSession(gender), warning: "ai_timeout_fallback" });
        return;
      }

      const text = ai?.choices?.[0]?.message?.content || "";
      const parsed = safeParseJsonFromText(text) || {};
      const fb = fallbackPoseSession(gender);

      const ms = parsed.muscleSignals || parsed.muscles || fb.muscleSignals;
      const pq = parsed.poseQuality || parsed.pose_quality || fb.poseQuality;

      const session = {
        build_arc: Math.round(clamp(parsed.build_arc ?? parsed.buildArcScore ?? fb.build_arc, 0, 100)),
        percentile: Math.round(clamp(parsed.percentile ?? fb.percentile, 1, 99)),
        strength: String(parsed.strength || parsed.strengthTag || fb.strength).slice(0, 48),
        horizon_days: Math.round(clamp(parsed.horizon_days ?? parsed.horizonDays ?? fb.horizon_days, 7, 365)),
        tierLabel: String(parsed.tierLabel || parsed.tier || "").slice(0, 48) || undefined,
        aesthetic_score: clamp(parsed.aesthetic_score ?? parsed.aestheticScore, 0, 10),
        toneMode,
        shortHeadline: String(parsed.shortHeadline || parsed.headline || "").slice(0, 180) || undefined,
        quickSummary: String(parsed.quickSummary || parsed.summaryShort || "").slice(0, 500) || undefined,
        shareCardSummary: String(parsed.shareCardSummary || parsed.shareSummary || "").slice(0, 160) || undefined,
        detailedExpansion: String(parsed.detailedExpansion || parsed.moreDetail || parsed.more_detail || "").slice(0, 1200) || undefined,
        report: String(parsed.report || parsed.detailedReport || parsed.summary || "").slice(0, 6000) || undefined,
        // If JSON parsing failed but the model returned text, keep a safe excerpt so the UI still renders a report.
        __rawText: String(text || "").slice(0, 6000) || undefined,
        bestDeveloped: Array.isArray(parsed.bestDeveloped) ? parsed.bestDeveloped.map((s)=>String(s).slice(0,80)).filter(Boolean).slice(0,4) : undefined,
        biggestOpportunity: Array.isArray(parsed.biggestOpportunity) ? parsed.biggestOpportunity.map((s)=>String(s).slice(0,80)).filter(Boolean).slice(0,4) : undefined,
        poseNotes: Array.isArray(parsed.poseNotes) ? parsed.poseNotes.map((s)=>String(s).slice(0,120)).filter(Boolean).slice(0,4) : undefined,
        muscleBreakdown: Array.isArray(parsed.muscleBreakdown || parsed.muscle_breakdown)
          ? (parsed.muscleBreakdown || parsed.muscle_breakdown)
              .map((r) => {
                const group = String(r.group || r.name || r.key || "").slice(0, 48);
                const visibility = normalizeVisibilityLabel(r.visibility || r.inFrame || r.visible || r.assessable || "");
                let note = String(r.note || r.text || "").slice(0, 900);
                const fallbackVisibility = visibility || groupVisibilityFallback(group);
                const needsVisibilityOverride = !note || /\b(leg|quad|hamstring|hamstrings|calf|calves|glute|glutes|hip|hips)\b/i.test(group) && !/(not clearly in frame|not in frame|not clearly visible|not visible enough|partially visible|limited visibility|cannot make a confident visual assessment|cannot confidently assess|can't confidently assess|unable to assess)/i.test(note);
                if (needsVisibilityOverride) {
                  const override = visibilityNoteForGroup(group, fallbackVisibility);
                  if (override) note = override;
                }
                return { group, note, visibility: fallbackVisibility };
              })
              .filter((r) => r.group && r.note)
              .slice(0, 12)
          : undefined,
        muscleSignals: {
          delts: clamp(ms?.delts ?? fb.muscleSignals.delts, 0, 1),
          arms: clamp(ms?.arms ?? fb.muscleSignals.arms, 0, 1),
          lats: clamp(ms?.lats ?? fb.muscleSignals.lats, 0, 1),
          chest: clamp(ms?.chest ?? fb.muscleSignals.chest, 0, 1),
          back: clamp(ms?.back ?? fb.muscleSignals.back, 0, 1),
          waist_taper: clamp(ms?.waist_taper ?? ms?.taper ?? fb.muscleSignals.waist_taper, 0, 1),
          legs: clamp(ms?.legs ?? fb.muscleSignals.legs, 0, 1),
        },
        poseQuality: {
          front_relaxed: clamp(pq?.front_relaxed ?? pq?.frontRelaxed ?? fb.poseQuality.front_relaxed, 0, 1),
          front_double_bi: clamp(pq?.front_double_bi ?? pq?.frontDoubleBi ?? fb.poseQuality.front_double_bi, 0, 1),
          side_scan: clamp(pq?.side_scan ?? pq?.sideScan ?? fb.poseQuality.side_scan, 0, 1),
          back_double_bi: clamp(pq?.back_double_bi ?? pq?.backDoubleBi ?? fb.poseQuality.back_double_bi, 0, 1),
          back_scan: clamp(pq?.back_scan ?? pq?.backScan ?? fb.poseQuality.back_scan, 0, 1),
        },
        highlights: Array.isArray(parsed.highlights)
          ? parsed.highlights.map((s) => String(s).slice(0, 90)).slice(0, 5)
          : fb.highlights,
        levers: Array.isArray(parsed.levers)
          ? parsed.levers.map((s) => String(s).slice(0, 90)).slice(0, 4)
          : fb.levers,
        confidenceNote: String(parsed.confidenceNote || fb.confidenceNote).slice(0, 160),
        gender,
        scanMode,
        poses: cleanPoses.map((p) => ({ poseKey: p.poseKey, title: p.title })),
      };

      if (!session.report && session.__rawText) {
        // Remove any leading non-json preamble lines.
        const raw = String(session.__rawText);
        // If the model returned something like "Here is the JSON:" keep only the meaningful part.
        const cleaned = raw.replace(/^.*?\n\n/, "").trim();
        session.report = cleaned.length > 40 ? cleaned : raw;
      }
      delete session.__rawText;

      const trend = buildTrendNarrative({ session, recentScans, gender, goalType, localDay });
      const physiqueSnapshot = buildPhysiqueSnapshot(session, { gender, scanMode, localDay });
      physiqueSnapshot.summary_seed.improvement_hint = trend.baselineComparison;
      session.gender = gender;
      session.goalType = goalType;
      session.scanMode = scanMode || (gender === "female" ? "female_pose_session" : "male_pose_session");
      session.momentumNote = trend.momentumNote;
      session.baselineComparison = trend.baselineComparison;
      session.physiqueSnapshot = physiqueSnapshot;

      if (!session.shortHeadline) {
        session.shortHeadline = gender === "female"
          ? "This is a confident, polished look."
          : "You’ve got a stronger look here than you probably realize.";
      }
      if (!session.quickSummary) {
        const strongest = physiqueSnapshot?.summary_seed?.strongest_feature || session.bestDeveloped?.[0] || (gender === "female" ? "overall frame" : "upper frame");
        session.quickSummary = gender === "female"
          ? `Your ${strongest} reads especially clean here, and the overall frame comes off more balanced and athletic. This feels like progress that is starting to show in a really flattering way.`
          : `Your ${strongest} is reading stronger here, and the overall frame comes off more athletic and confident. This feels like real momentum, not just a lucky angle.`;
      }
      if (!session.shareCardSummary) {
        session.shareCardSummary = gender === "female" ? "Confident, polished, and trending up." : "Stronger, sharper, and trending up.";
      }
      if (!session.detailedExpansion) {
        session.detailedExpansion = gender === "female"
          ? "More detail: the frame reads more composed and polished here, with posture and silhouette doing a lot of the work. It gives off the kind of progress that feels healthy, athletic, and increasingly obvious when you stay consistent."
          : "More detail: the frame reads stronger and more built here, especially where the upper body creates more presence on camera. It gives off the kind of progress that looks earned and gets easier to notice when consistency stays high.";
      }

      if (trend.momentumNote) {
        const baseReport = String(session.report || "").trim();
        session.report = baseReport
          ? `${trend.momentumNote}

${baseReport}`
          : trend.momentumNote;
      }

      const nextHighlights = Array.isArray(session.highlights) ? session.highlights.slice() : [];
      if (trend.highlight && !nextHighlights.some((h) => String(h || "").toLowerCase() === trend.highlight.toLowerCase())) {
        nextHighlights.unshift(trend.highlight);
      }
      session.highlights = nextHighlights.slice(0, 5);

      if (!session.bestDeveloped?.length && physiqueSnapshot?.summary_seed?.strongest_feature) {
        session.bestDeveloped = [physiqueSnapshot.summary_seed.strongest_feature];
      }

      if (Array.isArray(session.muscleBreakdown) && session.muscleBreakdown.length) {
        const lowerOutOfFrame = session.muscleBreakdown.some((row) => /\b(leg|quad|hamstring|hamstrings|calf|calves|glute|glutes|hip|hips)\b/i.test(String(row.group || "")) && /not clearly in frame|not in frame|not clearly visible|not visible enough|partially visible|limited visibility|cannot make a confident visual assessment|cannot confidently assess|can't confidently assess|unable to assess/i.test(String(row.note || "")));
        if (lowerOutOfFrame && typeof session.report === "string" && session.report.trim()) {
          const note = "Lower body visibility note: your legs and hips are not clearly in frame in these captures, so any lower-body assessment should be treated as incomplete until you re-scan with more of your body visible.";
          if (!session.report.includes(note)) {
            session.report = `${session.report.trim()}

${note}`;
          }
        }
      }

      if (!session.highlights?.length) session.highlights = fb.highlights;
      if (!session.levers?.length) session.levers = fb.levers;

      res.status(200).json({ session, ...(body?.debug ? { raw: text } : {}) });
      return;
    } catch (e) {
      console.error("[ai/generate] pose_session error:", e);
      res.status(200).json({ session: fallbackPoseSession(gender), warning: "ai_error_fallback" });
      return;
    }
  }

  if (feature === "frame_check") {
    try {
      // OpenAI unavailable: return a grounded deterministic JSON report (never hard-fail).
      if (!openai) {
        const p = String(body?.prompt || body?.text || body?.message || "");
        const grab = (label) => {
          const m = p.match(new RegExp(`${label}:\\s*([^\\n]+)`, "i"));
          return m ? String(m[1]).trim() : "";
        };

        const tier = grab("Tier") || "BUILD MODE";
        const overall = parseInt(grab("Overall") || "0", 10) || 0;
        const strength = grab("Top strength") || "Consistency";
        const weakness = grab("Weak spot") || "Logging";
        const projected90 = parseInt(grab("Projected 90d") || "0", 10) || 0;

        const consumed = parseInt(grab("Calories consumed") || "0", 10) || 0;
        const burned = parseInt(grab("Calories burned") || "0", 10) || 0;
        const protein = parseInt((grab("Protein") || "0").replace(/[^0-9]/g, ""), 10) || 0;
        const checklist = grab("Checklist completion") || "";

        const payload = {
          headline: `${tier} • ${overall}/100`,
          summary: `Consumed ${consumed} • Burned ${burned} • Protein ${protein}g\nChecklist: ${checklist}\nStrength: ${strength} • Weak spot: ${weakness}`,
          breakdown: [
            "Physique signals: protein + training + calorie control are the big three.",
            "Discipline overlay: checklist completion + logging consistency drive your score up fastest.",
            "Keep it simple: hit protein, move your body, and close the next 2 steps."
          ],
          next_moves: [
            "Log your next meal (even rough).",
            "Add a 20–35 min training stimulus (lift or incline walk).",
            "Hit a clean protein dose (25–45g) in the next meal.",
          ],
          share_card: `FRAME CHECK\n${tier} • ${overall}/100\nStrength: ${strength}\nWeak: ${weakness}\n90d: ~${projected90}/100\npowered by SlimCal`,
          projection_90d: `If you keep today's discipline trend, you're trending toward ~${projected90}/100 in ~90 days.`,
        };

        res.status(200).json({ text: JSON.stringify(payload) });
        return;
      }

      const usr = String(body?.prompt || body?.text || body?.message || "");
      const sys =
        "You are SlimCal Frame Check — a cinematic but grounded daily scan. " +
        "Return VALID JSON ONLY, no markdown. Keys: headline, summary, breakdown (array), next_moves (array), share_card, projection_90d. " +
        "Use the user's numbers and be specific. Be supportive, never cruel. 80% serious, 20% meme spice.";

      const call = openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: usr }
        ],
        temperature: 0.55,
        max_tokens: 900
      });

      const ai = await withTimeout(call, OPENAI_TIMEOUT_MS, null);
      if (!ai) {
        // Timeout: return deterministic fallback with HTTP 200 so UI never breaks.
        const payload = { headline: "Frame Check", summary: "Timed out — using fallback.", breakdown: [], next_moves: [], share_card: "FRAME CHECK\npowered by SlimCal", projection_90d: "" };
        res.status(200).json({ text: JSON.stringify(payload) });
        return;
      }

      const text = ai?.choices?.[0]?.message?.content || "";
      res.status(200).json({ text });
      return;
    } catch (e) {
      console.error("[ai/generate] frame_check error:", e);
      const payload = { headline: "Frame Check", summary: "Error — using fallback.", breakdown: [], next_moves: [], share_card: "FRAME CHECK\npowered by SlimCal", projection_90d: "" };
      res.status(200).json({ text: JSON.stringify(payload) });
      return;
    }
  }

  if (feature === "daily_eval_verdict" || feature === "daily_eval") {
    try {
      // If OpenAI is unavailable, return a deterministic, snappy fallback.
      if (!openai) {
        const p = String(body?.prompt || body?.text || body?.message || "");
        const grabNum = (label) => {
          const m = p.match(new RegExp(`${label}:\\s*([0-9]+)`, "i"));
          return m ? parseInt(m[1], 10) : null;
        };

        const consumed = grabNum("Consumed") ?? 0;
        const burned = grabNum("Burned") ?? 0;
        const net = grabNum("Net") ?? (consumed - burned);
        const protein = grabNum("Protein") ?? 0;

        const goalMatch = p.match(/Goal:\s*([a-z_]+)/i);
        const goalType = (goalMatch?.[1] || "maintain").toUpperCase();

        const limiterMatch = p.match(/Limiter:\s*([a-z_]+)/i);
        const limiter = limiterMatch?.[1] || "execution";

        const planLines = [];
        const m1 = p.match(/Tomorrow Plan:\s*\n1\)\s*(.+)\n2\)\s*(.+)/i);
        if (m1?.[1]) planLines.push(`• ${m1[1].trim()}`);
        if (m1?.[2]) planLines.push(`• ${m1[2].trim()}`);

        const text =
`${goalType} check: ${consumed} in, ${burned} out → net ${net}. Protein at ${protein}g — that's your lever today.
Main leak: ${limiter.replace(/_/g, " ")}. Fix that and your score jumps fast.
${planLines.slice(0, 2).join("\n")}`.trim();

        res.status(200).json({ text });
        return;
      }

      // OpenAI path: we accept a raw 'prompt' and return plain text.
      const call = openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are SlimCal Coach, an expert coach + nutritionist. Be detailed but skimmable: use short headings and bullets, cite the user\u2019s numbers, and end with one clear \"Win move\"." },
          { role: "user", content: String(body?.prompt || body?.text || body?.message || "").slice(0, 12000) },
        ],
        temperature: 0.55,
        max_tokens: 700,
      });

      const completion = await withTimeout(call, OPENAI_TIMEOUT_MS, null);
      const text = completion?.choices?.[0]?.message?.content?.trim();

      if (!text) {
        res.status(200).json({ text: fallbackDailyVerdictFromPrompt(String(body?.prompt || body?.text || body?.message || "")), warning: "ai_timeout_fallback" });
        return;
      }

      res.status(200).json({ text });
      return;
    } catch (e) {
      console.error("[ai/generate] daily_eval_verdict error:", e);
      res.status(200).json({ text: fallbackDailyVerdictFromPrompt(String(body?.prompt || body?.text || body?.message || "")), warning: "ai_error_fallback" });
      return;
    }
  }
  res.status(400).json({ error: "Unsupported feature" });
}