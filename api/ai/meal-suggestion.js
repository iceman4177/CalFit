// api/ai/meal-suggestion.js

let openaiClient = null;
const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
if (hasOpenAIKey) {
  try {
    const { OpenAI } = require("openai");
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  } catch (e) {
    console.warn(
      "[meal-suggestion] openai module not found; falling back to stub.",
      e?.message
    );
    openaiClient = null;
  }
}

function computeMacroTargets({ weightKg = 75, dailyCalories = 2000 }) {
  const p = Math.round(1.8 * weightKg);
  const f = Math.round(0.8 * weightKg);
  const kcalsFromP = p * 4,
    kcalsFromF = f * 9;
  const c = Math.max(
    0,
    Math.round((dailyCalories - kcalsFromP - kcalsFromF) / 4)
  );
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

// ---- STUBS ----
const STUBS = {
  Breakfast: [
    { name: "Greek Yogurt Parfait", calories: 320, macros: { p: 24, c: 40, f: 8 } },
    { name: "Veggie Omelet + Toast", calories: 380, macros: { p: 28, c: 30, f: 16 } },
    { name: "Protein Oats", calories: 420, macros: { p: 26, c: 52, f: 12 } },
    { name: "Avocado Toast + Eggs", calories: 350, macros: { p: 18, c: 30, f: 14 } },
    { name: "Berry Protein Smoothie", calories: 290, macros: { p: 25, c: 35, f: 6 } },
  ],
  Lunch: [
    { name: "Chicken Rice Bowl", calories: 520, macros: { p: 40, c: 60, f: 12 } },
    { name: "Turkey Sandwich + Salad", calories: 480, macros: { p: 32, c: 48, f: 14 } },
    { name: "Tuna Poke Bowl", calories: 560, macros: { p: 38, c: 62, f: 14 } },
    { name: "Shrimp Stir-Fry + Rice", calories: 510, macros: { p: 34, c: 65, f: 10 } },
    { name: "Grilled Chicken Wrap", calories: 450, macros: { p: 36, c: 42, f: 12 } },
  ],
  Snack: [
    { name: "Cottage Cheese + Pineapple", calories: 220, macros: { p: 22, c: 22, f: 5 } },
    { name: "Protein Shake + Apple", calories: 260, macros: { p: 28, c: 30, f: 3 } },
    { name: "Hummus + Veggie Sticks", calories: 240, macros: { p: 10, c: 24, f: 12 } },
    { name: "Rice Cakes + Peanut Butter", calories: 210, macros: { p: 9, c: 28, f: 7 } },
    { name: "Trail Mix (small portion)", calories: 300, macros: { p: 10, c: 32, f: 15 } },
  ],
  Dinner: [
    { name: "Grilled Salmon, Quinoa, & Greens", calories: 610, macros: { p: 42, c: 54, f: 22 } },
    { name: "Lean Beef, Sweet Potato, & Broccoli", calories: 640, macros: { p: 45, c: 58, f: 20 } },
    { name: "Tofu Stir-fry + Rice", calories: 580, macros: { p: 28, c: 68, f: 14 } },
    { name: "Chicken Alfredo (light)", calories: 700, macros: { p: 42, c: 62, f: 24 } },
    { name: "Shrimp Tacos + Slaw", calories: 590, macros: { p: 36, c: 52, f: 18 } },
  ],
};

function pickStubSet(period, kcalWindow, recentMeals = []) {
  const pool =
    STUBS[period] || [
      ...STUBS.Breakfast,
      ...STUBS.Lunch,
      ...STUBS.Snack,
      ...STUBS.Dinner,
    ];
  const candidates = pool.filter(
    (m) => m.calories >= kcalWindow.min && m.calories <= kcalWindow.max
  );
  const list = candidates.length ? candidates : pool;
  // Return up to 5 different random picks
  return Array.from({ length: 5 }, () => list[Math.floor(Math.random() * list.length)]);
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

    const remaining = Math.max(
      0,
      Number(dailyGoal) - Number(consumedCalories)
    );
    const kcalWindow = suggestCalorieWindow(remaining, mealsRemaining);

    let targets = macroTargets;
    if (!targets || typeof targets.p !== "number") {
      const weightKg =
        user.weightKg || (user.weightLbs ? user.weightLbs * 0.453592 : 75);
      targets = computeMacroTargets({ weightKg, dailyCalories: dailyGoal });
    }

    // ---- Stub Mode ----
    if (!openaiClient) {
      const stubMeals = pickStubSet(period, kcalWindow, recentMeals);
      res.status(200).json({
        ok: true,
        suggestions: stubMeals,
        rationale: { period, kcalWindow, remaining, targets, source: "stub" },
      });
      return;
    }

    // ---- AI Mode ----
    const prompt = `
Return ONLY JSON array of 5 meal objects like:
[
  {"name":"...", "calories":450, "macros":{"p":30,"c":40,"f":12}, "prepMinutes":10},
  {"name":"...", "calories":520, "macros":{"p":38,"c":55,"f":14}, "prepMinutes":12}
]
Constraints:
- Period: ${period} | Goal: ${goalType}
- Daily: ${dailyGoal} | Consumed: ${consumedCalories} | Remaining: ${remaining}
- Meals remaining (incl. this one): ${mealsRemaining}
- Calorie window: ${kcalWindow.min}–${kcalWindow.max}
- Macro targets (g): p=${targets.p}, c=${targets.c}, f=${targets.f}
- Avoid: ${Array.isArray(recentMeals) ? recentMeals.join(", ") : ""}
Keep JSON strict (no extra prose).`.trim();

    const completion = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
    });

    const text = completion?.choices?.[0]?.message?.content;
    let meals = [];

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

    // Ensure array & sanitize calories
    if (!Array.isArray(meals)) meals = [];
    meals = meals.map((m) => {
      let safeCalories = 0;
      if (m.calories != null) {
        const match = String(m.calories).match(/\d+/);
        if (match) safeCalories = parseInt(match[0], 10);
      }
      if (!Number.isFinite(safeCalories) || safeCalories <= 0) {
        safeCalories = Math.round((kcalWindow.min + kcalWindow.max) / 2);
      }
      safeCalories = Math.round(
        Math.min(kcalWindow.max, Math.max(kcalWindow.min, safeCalories))
      );
      return {
        name: m.name || "Unknown meal",
        calories: safeCalories,
        macros: m.macros || { p: 0, c: 0, f: 0 },
        prepMinutes: m.prepMinutes || null,
        notes: m.notes || null,
      };
    });

    res.status(200).json({
      ok: true,
      suggestions: meals,
      rationale: { period, kcalWindow, remaining, targets, source: "openai" },
    });
  } catch (err) {
    console.error("[api/ai/meal-suggestion] error:", err);
    res
      .status(500)
      .json({ ok: false, error: err.message || "Server error" });
  }
};
