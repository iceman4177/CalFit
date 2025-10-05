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

function biasBlock(b, intent) {
  const copy = { ...b };
  const asRange = (lo, hi) => `${lo}-${hi}`;
  switch (intent) {
    case "bodybuilder":
      copy.sets = copy.sets ?? 4;
      copy.reps = copy.reps ?? asRange(8, 12);
      copy.tempo = copy.tempo || "2-1-2";
      break;
    case "powerlifter":
      copy.sets = copy.sets ?? 5;
      copy.reps = copy.reps ?? asRange(3, 5);
      copy.tempo = copy.tempo || "1-1-2";
      break;
    case "endurance":
      copy.sets = copy.sets ?? 3;
      copy.reps = copy.reps ?? asRange(12, 20);
      copy.tempo = copy.tempo || "2-1-2";
      break;
    case "yoga_pilates":
      copy.sets = copy.sets ?? 3;
      copy.reps = copy.reps ?? asRange(10, 15);
      copy.tempo = copy.tempo || "2-1-2";
      break;
    default:
      copy.sets = copy.sets ?? 3;
      copy.reps = copy.reps ?? asRange(8, 12);
      copy.tempo = copy.tempo || "2-1-2";
  }
  return copy;
}

function intentBank(focus, intent) {
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
  };

  const cardioSprinkles = [
    { exercise: "Bike Intervals (Moderate)" },
    { exercise: "Rowing Machine (steady)" },
    { exercise: "Jump Rope" },
  ];

  const f = base[focus] ? focus : "upper";
  if (intent === "yoga_pilates") return yogaMobility[f];
  if (intent === "endurance") return [...base[f], cardioSprinkles[0]];
  if (intent === "powerlifter") {
    if (f === "upper") return [
      { exercise: "Barbell Bench Press" },
      { exercise: "Weighted Pull-Up" },
      { exercise: "Barbell Row" },
      { exercise: "Overhead Press" },
      { exercise: "Face Pull" },
    ];
    if (f === "lower") return [
      { exercise: "Low-Bar Back Squat" },
      { exercise: "Conventional Deadlift" },
      { exercise: "Paused Squat" },
      { exercise: "Hamstring Curl" },
    ];
    return [
      { exercise: "Front Squat" },
      { exercise: "Bench Press" },
      { exercise: "Deadlift (technique sets)" },
      { exercise: "Plank" },
    ];
  }
  if (intent === "bodybuilder" && f === "upper") {
    return [
      { exercise: "Incline Dumbbell Press" },
      { exercise: "Chest Fly (Cable)" },
      { exercise: "Lat Pulldown" },
      { exercise: "Seated Row" },
      { exercise: "Lateral Raise" },
      { exercise: "Cable Curl" },
      { exercise: "Rope Triceps Extension" },
    ];
  }
  return base[f];
}

function fallbackWorkoutPack({ focus = "upper", goal = "maintenance", intent = "general" }, count = 5) {
  const normIntent = normalizeIntent(intent);
  const base = intentBank(focus, normIntent);
  const title = `${TITLE_BY_INTENT[normIntent] || TITLE_BY_INTENT.general} (${focus})`;

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
- focus: ${focus}
- goal: ${goal}
- training_intent: ${normIntent}
- equipment: ${equipment.join(", ") || "bodyweight"}
Bias:
- ${biasText}
Rules:
- 4–6 exercises per option
- reps can be a range string (e.g., "8-12")
- include optional "tempo" like "2-1-2"
- use only movements feasible with the allowed equipment`;

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
  const suggestions = Array.isArray(json?.suggestions)
    ? json.suggestions
    : fallbackWorkoutPack(payload, count);

  const patched = suggestions.map(sug => ({
    title: sug.title || `${TITLE_BY_INTENT[normIntent] || "Workout"} (${focus})`,
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
      total_calories: totals.calories + (calorieBias || 0), // apply goal bias lightly
      total_protein_g: totals.protein_g
    });
  }

  // quick bias for intent: ensure protein trending toward target if bodybuilder/powerlifter
  if (["bodybuilder","powerlifter","recomp"].includes(intent) && proteinTargetG) {
    return plans.map(p => ({
      ...p,
      // annotate a tiny nudge note (client can ignore)
      note: p.total_protein_g < proteinTargetG / 3
        ? "Consider adding a shake or extra lean protein to hit targets."
        : undefined
    }));
  }
  return plans;
}

async function openAIMealPack(payload, count = 3) {
  if (!openai) return fallbackMealPack(payload, count);

  const {
    diet = "omnivore",
    intent = "general",
    calorieBias = 0,
    proteinTargetG = 120
  } = payload;

  const d = normalizeDiet(diet);
  const normIntent = normalizeIntent(intent);

  const biasText = {
    bodybuilder: `High protein (aim near ${proteinTargetG} g/day), moderate carbs, moderate-low fats.`,
    powerlifter: `High protein, sufficient carbs for training performance, moderate fats.`,
    endurance: `Adequate carbs, moderate protein, lighter fats.`,
    yoga_pilates: `Light meals, focus on whole foods, modest protein.`,
    general: `Balanced macro distribution.`
  }[normIntent];

  const sys = `You are a sports nutrition coach. Output ONLY valid JSON:
{"meals":[{"title":"...","items":[{"food":"...","qty":"...", "protein_g":25, "calories":350}],"total_protein_g":90,"total_calories":2100}]}
No prose or markdown. Foods must respect the diet preference. Provide 3 distinct meal ideas (can be full meals or macro-friendly bowls).`;

  const usr = `Create ${count} meal ideas for:
- diet_preference: ${d}
- training_intent: ${normIntent}
- target_protein_g: ~${proteinTargetG}
- calorie_bias_per_meal: ${calorieBias} (positive = bulking, negative = cutting)
Bias:
- ${biasText}
Rules:
- Each meal: 2–4 items with qty, protein_g, calories
- Total per meal: include "total_protein_g" and "total_calories"
- Respect diet strictly (e.g., vegan = no animal products)`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: usr }
    ],
    temperature: 0.5
  });

  const txt = res?.choices?.[0]?.message?.content || "";
  let json = null;
  try { json = JSON.parse(txt); } catch {}
  const meals = Array.isArray(json?.meals)
    ? json.meals
    : fallbackMealPack(payload, count);
  // light adjustment for bias
  return meals.map(m => ({
    ...m,
    total_calories: (m.total_calories ?? 0) + (payload.calorieBias || 0)
  }));
}

// ---- handler ----
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = await readJson(req);
  const {
    feature = "workout",     // "workout" | "meal"
    user_id = null,
    // shared-ish context
    constraints = {},        // { training_intent, diet_preference, protein_target_daily_g, calorie_bias }
    count = 5,
    // workout fields
    goal = "maintenance",
    focus = "upper",
    equipment = ["dumbbell", "barbell", "machine", "bodyweight"],
    // meal fields (optional, but we can infer from constraints/local)
    diet = constraints?.diet_preference || "omnivore",
    proteinTargetG = constraints?.protein_target_daily_g || 120,
    calorieBias = constraints?.calorie_bias || 0
  } = body || {};

  // Gate: Pro or small free quota
  const pro = await isProActive(user_id);
  if (!pro && !allowFree(req, 3)) {
    res.status(402).json({ error: "Upgrade required" });
    return;
  }

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
      res.status(500).json({ error: "Failed to generate workout suggestions" });
      return;
    }
  }

  if (feature === "meal") {
    try {
      const intent = normalizeIntent(constraints?.training_intent || "general");
      const meals = await openAIMealPack(
        { diet, intent, proteinTargetG, calorieBias },
        Math.max(1, Math.min(parseInt(count, 10) || 3, 6))
      );
      res.status(200).json({ meals });
      return;
    } catch (e) {
      console.error("[ai/generate] meal error:", e);
      res.status(500).json({ error: "Failed to generate meal ideas" });
      return;
    }
  }

  res.status(400).json({ error: "Unsupported feature" });
}
