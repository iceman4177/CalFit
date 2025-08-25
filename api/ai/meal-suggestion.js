// src/api/meal-suggestion.js

let openaiClient = null;
const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
if (hasOpenAIKey) {
  try {
    const { OpenAI } = require("openai");
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  } catch (e) {
    console.warn("[meal-suggestion] openai module not found; falling back to stub.", e?.message);
    openaiClient = null;
  }
}

function computeMacroTargets({ weightKg = 75, dailyCalories = 2000 }) {
  const p = Math.round(1.8 * weightKg);
  const f = Math.round(0.8 * weightKg);
  const kcalsFromP = p * 4,
    kcalsFromF = f * 9;
  const c = Math.max(0, Math.round((dailyCalories - kcalsFromP - kcalsFromF) / 4));
  return { p, c, f };
}
function suggestCalorieWindow(remaining, mealsRemaining) {
  const base = Math.max(0, Number(remaining) || 0);
  const per = Math.max(1, Number(mealsRemaining) || 1);
  const target = base / per;
  const min = Math.round(Math.max(200, target * 0.85));
  const max = Math.round(Math.min(900, target * 1.15));
  return { min, max };
}

// --- Simple stub meals for fallback ---
const STUBS = {
  Breakfast: [
    { name: "Greek Yogurt Parfait", calories: 320, macros: { p: 24, c: 40, f: 8 } },
    { name: "Veggie Omelet + Toast", calories: 380, macros: { p: 28, c: 30, f: 16 } },
    { name: "Protein Oats", calories: 420, macros: { p: 26, c: 52, f: 12 } },
  ],
  Lunch: [
    { name: "Chicken Rice Bowl", calories: 520, macros: { p: 40, c: 60, f: 12 } },
    { name: "Turkey Sandwich + Salad", calories: 480, macros: { p: 32, c: 48, f: 14 } },
    { name: "Tuna Poke Bowl", calories: 560, macros: { p: 38, c: 62, f: 14 } },
  ],
  Dinner: [
    { name: "Salmon + Quinoa", calories: 610, macros: { p: 42, c: 54, f: 22 } },
    { name: "Lean Beef + Sweet Potato", calories: 640, macros: { p: 45, c: 58, f: 20 } },
    { name: "Tofu Stir-fry", calories: 580, macros: { p: 28, c: 68, f: 14 } },
  ],
};

function pickStub(period) {
  const pool = STUBS[period] || [...STUBS.Breakfast, ...STUBS.Lunch, ...STUBS.Dinner];
  const shuffled = pool.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, 5);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const {
      period = "Meal",
      goalType = "maintain",
      dailyGoal = 2000,
      consumedCalories = 0,
      recentMeals = [],
      mealsRemaining = 2,
      macroTargets,
      user = {},
    } = req.body || {};

    const remaining = Math.max(0, Number(dailyGoal) - Number(consumedCalories));
    const kcalWindow = suggestCalorieWindow(remaining, mealsRemaining);

    let targets = macroTargets;
    if (!targets || typeof targets.p !== "number") {
      const weightKg = user.weightKg || (user.weightLbs ? user.weightLbs * 0.453592 : 75);
      targets = computeMacroTargets({ weightKg, dailyCalories: dailyGoal });
    }

    // --- Fallback: stub suggestions ---
    if (!openaiClient) {
      const s = pickStub(period);
      res.status(200).json({
        ok: true,
        suggestions: s,
        rationale: { period, kcalWindow, remaining, targets, source: "stub" },
      });
      return;
    }

    // --- OpenAI call for 5 suggestions ---
    const prompt = `
Return ONLY JSON like:
[
  {"name":"Grilled Chicken Salad","calories":420,"macros":{"p":40,"c":35,"f":12},"prepMinutes":15},
  {"name":"...","calories":...}
]
Constraints:
- Provide EXACTLY 5 meal suggestions
- Period: ${period} | Goal: ${goalType}
- Daily goal: ${dailyGoal} | Consumed: ${consumedCalories} | Remaining: ${remaining}
- Calorie window: ${kcalWindow.min}–${kcalWindow.max}
- Macro targets: p=${targets.p}, c=${targets.c}, f=${targets.f}
- Avoid: ${(Array.isArray(recentMeals) ? recentMeals.join(", ") : "")}
Always return a valid JSON array with 5 objects, no extra text.
`.trim();

    const completion = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
    });

    const text = completion?.choices?.[0]?.message?.content?.trim();
    let meals = null;

    try {
      meals = JSON.parse(text);
    } catch {
      const m = text ? text.match(/\[[\s\S]*\]/) : null;
      if (m && m[0]) {
        try {
          meals = JSON.parse(m[0]);
        } catch {}
      }
    }

    if (!Array.isArray(meals)) {
      res.status(502).json({ ok: false, error: "Bad AI response", raw: text });
      return;
    }

    // ✅ FIX: Sanitize calories + macros
    meals = meals.map((meal) => {
      // --- Calories ---
      let safeCalories = 0;
      if (typeof meal.calories === "number" && !isNaN(meal.calories)) {
        safeCalories = meal.calories;
      } else if (typeof meal.calories === "string") {
        const match = meal.calories.match(/\d+/);
        if (match) safeCalories = parseInt(match[0], 10);
      }

      // --- Macros ---
      let safeMacros = { p: 0, c: 0, f: 0 };
      if (meal.macros && typeof meal.macros === "object") {
        const { p, c, f } = meal.macros;

        const parseMacro = (val) => {
          if (typeof val === "number" && !isNaN(val)) return val;
          if (typeof val === "string") {
            const match = val.match(/\d+/);
            return match ? parseInt(match[0], 10) : 0;
          }
          return 0;
        };

        safeMacros = {
          p: parseMacro(p),
          c: parseMacro(c),
          f: parseMacro(f),
        };
      }

      return {
        ...meal,
        calories: safeCalories,
        macros: safeMacros,
      };
    });

    res.status(200).json({
      ok: true,
      suggestions: meals,
      rationale: { period, kcalWindow, remaining, targets, source: "openai" },
    });
  } catch (err) {
    console.error("[api/ai/meal-suggestion] error:", err);
    res.status(500).json({ ok: false, error: err.message || "Server error" });
  }
};
