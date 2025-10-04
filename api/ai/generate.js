// /api/ai/generate.js
import { supabaseAdmin } from "../_lib/supabaseAdmin.js";
import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export const config = { api: { bodyParser: false } };

// ---- utils ----
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

async function isProActive(user_id) {
  if (!user_id) return false;
  const { data, error } = await supabaseAdmin
    .from("app_subscriptions")
    .select("status,current_period_end")
    .eq("user_id", user_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return false;
  const now = Math.floor(Date.now() / 1000);
  const active = ["active", "trialing", "past_due"].includes(data.status);
  return active && (!data.current_period_end || data.current_period_end > now);
}

// very light per-IP daily quota for free users
const freeMap = new Map(); // key -> { used, day }
function freeKey(req) {
  const ip = (req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "0.0.0.0")
    .toString()
    .split(",")[0]
    .trim();
  return `fq_${ip}`;
}
function allowFree(req, cap = 3) {
  const key = freeKey(req);
  const today = new Date().toISOString().slice(0, 10);
  const rec = freeMap.get(key);
  if (!rec || rec.day !== today) {
    freeMap.set(key, { used: 1, day: today });
    return true;
  }
  if (rec.used < cap) {
    rec.used += 1;
    return true;
  }
  return false;
}

// ---- generation helpers ----
function fallbackPack({ focus = "upper", goal = "maintenance", intent = "general" }, count = 5) {
  const bank = {
    upper: [
      { exercise: "Incline Dumbbell Press", sets: 4, reps: "8-12", tempo: "2-1-2" },
      { exercise: "Weighted Pull-Up", sets: 4, reps: "6-8", tempo: "2-1-2" },
      { exercise: "Seated Cable Row", sets: 3, reps: "10-12", tempo: "2-1-2" },
      { exercise: "Lateral Raise", sets: 3, reps: "12-15", tempo: "2-1-2" },
    ],
    lower: [
      { exercise: "Back Squat", sets: 4, reps: "5-8", tempo: "2-1-2" },
      { exercise: "Romanian Deadlift", sets: 4, reps: "8-10", tempo: "2-1-2" },
      { exercise: "Leg Press", sets: 3, reps: "10-12", tempo: "2-1-2" },
      { exercise: "Walking Lunge", sets: 3, reps: "10/leg", tempo: "2-1-2" },
    ],
    full: [
      { exercise: "Barbell Clean & Press", sets: 5, reps: "3-5", tempo: "1-1-2" },
      { exercise: "Pull-Up", sets: 4, reps: "6-10", tempo: "2-1-2" },
      { exercise: "Front Squat", sets: 4, reps: "5-8", tempo: "2-1-2" },
      { exercise: "Push-Up", sets: 3, reps: "AMRAP", tempo: "2-1-2" },
    ],
  }[focus] || undefined;

  const titleFor = {
    general: "Balanced Hypertrophy Session",
    bodybuilder: "Bodybuilder Hypertrophy Split",
    powerlifter: "Strength-Focused Session",
    yoga: "Mobility-Centered Strength Flow",
    pilates: "Control & Core Strength",
    endurance: "Strength + Conditioning Mix",
  };
  const title = titleFor[intent] || titleFor.general;
  const base = bank || [
    { exercise: "Dumbbell Bench Press", sets: 4, reps: "8-12", tempo: "2-1-2" },
    { exercise: "Lat Pulldown", sets: 4, reps: "8-12", tempo: "2-1-2" },
    { exercise: "Seated Row", sets: 3, reps: "10-12", tempo: "2-1-2" },
    { exercise: "Incline Curl", sets: 3, reps: "10-12", tempo: "2-1-2" },
  ];

  const out = [];
  for (let i = 0; i < Math.max(1, Math.min(count, 8)); i++) {
    const rotated = base.slice(i % base.length).concat(base.slice(0, i % base.length));
    out.push({ title: `${title} (${focus})`, blocks: rotated });
  }
  return out;
}

async function openAIWorkoutPack(payload, count = 5) {
  if (!openai) return fallbackPack(payload, count);

  const { focus = "upper", goal = "maintenance", intent = "general", equipment = [] } = payload;

  const sys = `You are a certified strength coach. Output only valid JSON:
{"suggestions":[{"title":"...","blocks":[{"exercise":"...","sets":3,"reps":"8-12","tempo":"2-1-2"}]}]}
Keep common gym/home movements given allowed equipment. 4–6 exercises per suggestion.`;

  const usr = `Create ${count} workout options tailored to:
- focus: ${focus}
- goal: ${goal}
- training_intent: ${intent}
- equipment: ${equipment.join(", ") || "bodyweight"}
Rules:
- 4–6 exercises per option
- real-world sets/reps (reps may be a string range)
- include optional "tempo" like "2-1-2"`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: usr }
    ],
    temperature: 0.6
  });

  const txt = res?.choices?.[0]?.message?.content || "";
  let json = null;
  try { json = JSON.parse(txt); } catch { /* fall back */ }
  const suggestions = Array.isArray(json?.suggestions) ? json.suggestions : fallbackPack({ focus, goal, intent }, count);
  return suggestions;
}

// ---- handler ----
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = await readJson(req);
  const {
    feature = "workout",
    user_id = null,
    goal = "maintenance",
    focus = "upper",
    equipment = ["dumbbell", "barbell", "machine", "bodyweight"],
    constraints = {},
    count = 5
  } = body || {};

  // Gate: Pro or small free quota
  const pro = await isProActive(user_id);
  if (!pro && !allowFree(req, 3)) {
    res.status(402).json({ error: "Upgrade required" });
    return;
  }

  if (feature === "workout") {
    try {
      const intent = constraints?.training_intent || constraints?.intent || "general";
      const suggestions = await openAIWorkoutPack(
        { focus, goal, intent, equipment },
        Math.max(1, Math.min(parseInt(count, 10) || 5, 8))
      );
      res.status(200).json({ suggestions });
      return;
    } catch (e) {
      console.error("[ai/generate] error:", e);
      res.status(500).json({ error: "Failed to generate workout suggestions" });
      return;
    }
  }

  res.status(400).json({ error: "Unsupported feature" });
}
