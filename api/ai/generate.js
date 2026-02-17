// /api/ai/generate.js
//
// Slimcal AI gateway with server-side free-pass + Pro/Trial bypass.
// Behavior:
// - Pro/Trial users: unlimited AI usage (bypass free-pass).
// - Non-Pro users (signed-in or anonymous): up to 3 uses per FEATURE per DAY,
//   keyed by X-Client-Id (falls back to IP if missing). Attempts are synced to
//   Supabase when possible; fallback to in-memory counter if table/policy missing.
//
// Features supported: 'workout', 'meal', 'coach', 'daily_eval_verdict'.
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
const FREE_LIMIT = 3;
const freeMem = new Map();

function memAllow(clientId, feature) {
  const key = `m:${clientId}:${feature}`;
  const today = dayKeyUTC();
  const rec = freeMem.get(key);
  if (!rec || rec.day !== today) {
    freeMem.set(key, { used: 1, day: today });
    return { allowed: true, remaining: FREE_LIMIT - 1 };
  }
  if (rec.used < FREE_LIMIT) {
    rec.used += 1;
    return { allowed: true, remaining: FREE_LIMIT - rec.used };
  }
  return { allowed: false, remaining: 0 };
}

async function dbAllow(clientId, feature, userId) {
  if (!supabaseAdmin) return memAllow(clientId, feature);
  try {
    const today = dayKeyUTC();

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
      return { allowed: true, remaining: FREE_LIMIT - 1 };
    }

    const currentUses = data.uses || 0;
    if (currentUses >= FREE_LIMIT) return { allowed: false, remaining: 0 };

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
    return { allowed: true, remaining: Math.max(0, FREE_LIMIT - newUses) };
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
  if (!pro) {
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