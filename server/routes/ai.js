// server/routes/ai.js
'use strict';

const express = require('express');
const router = express.Router();

let openai = null;
if (process.env.OPENAI_API_KEY) {
  const { OpenAI } = require('openai');
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/**
 * Utility: simple macro math when client doesn't send targets
 * Defaults (very sane starting points):
 *   protein: 1.8 g/kg bodyweight
 *   fat:     0.8 g/kg bodyweight
 *   carbs:   remainder of calories
 */
function computeMacroTargets({ weightKg = 75, dailyCalories = 2000 }) {
  const p = Math.round(1.8 * weightKg);            // grams
  const f = Math.round(0.8 * weightKg);            // grams
  const kcalsFromP = p * 4;
  const kcalsFromF = f * 9;
  const c = Math.max(0, Math.round((dailyCalories - kcalsFromP - kcalsFromF) / 4));
  return { p, c, f };
}

/**
 * Intelligent calorie window for this meal:
 *   aim around "remaining / mealsRemaining" with ±15% band, clamped to [200..900]
 */
function suggestCalorieWindow(remaining, mealsRemaining) {
  const base = Math.max(0, remaining);
  const per  = Math.max(1, mealsRemaining || 1);
  const target = base / per;
  const min = Math.round(Math.max(200, target * 0.85));
  const max = Math.round(Math.min(900, target * 1.15));
  return { min, max };
}

/**
 * Fallback library (used when OPENAI_API_KEY is not set)
 * Varied by period + rough calorie target
 */
const STUBS = {
  Breakfast: [
    { name: 'Greek Yogurt Parfait (berries + granola)', calories: 320, macros:{p:24,c:40,f:8} },
    { name: 'Veggie Omelet + Toast',                     calories: 380, macros:{p:28,c:30,f:16} },
    { name: 'Protein Oats (banana + peanut butter)',     calories: 420, macros:{p:26,c:52,f:12} },
  ],
  Lunch: [
    { name: 'Chicken Rice Bowl (veg + salsa)',           calories: 520, macros:{p:40,c:60,f:12} },
    { name: 'Turkey Sandwich + Side Salad',              calories: 480, macros:{p:32,c:48,f:14} },
    { name: 'Tuna Poke Bowl',                            calories: 560, macros:{p:38,c:62,f:14} },
  ],
  Snack: [
    { name: 'Cottage Cheese + Pineapple',                calories: 220, macros:{p:22,c:22,f:5} },
    { name: 'Protein Shake + Apple',                     calories: 260, macros:{p:28,c:30,f:3} },
    { name: 'Hummus + Veggie Sticks',                    calories: 240, macros:{p:10,c:24,f:12} },
  ],
  Dinner: [
    { name: 'Grilled Salmon, Quinoa, & Greens',          calories: 610, macros:{p:42,c:54,f:22} },
    { name: 'Lean Beef, Sweet Potato, & Broccoli',       calories: 640, macros:{p:45,c:58,f:20} },
    { name: 'Tofu Stir-fry, Brown Rice, Mixed Veg',      calories: 580, macros:{p:28,c:68,f:14} },
  ],
};

function pickStub(period, { min, max }, recentMeals = []) {
  const pool = STUBS[period] || [...STUBS.Breakfast, ...STUBS.Lunch, ...STUBS.Snack, ...STUBS.Dinner];
  // prefer items within the window and not in recentMeals
  const candidates = pool
    .filter(m => m.calories >= min && m.calories <= max)
    .filter(m => !recentMeals.some(r => r && r.toLowerCase() === m.name.toLowerCase()));
  const list = candidates.length ? candidates : pool;
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * POST /api/ai/meal-suggestion
 * Body: {
 *   period, goalType, dailyGoal, consumedCalories,
 *   recentMeals: string[],
 *   mealsRemaining: number,
 *   macroTargets: { p,c,f } (optional),
 *   user: { weightKg?, weightLbs? } (optional)
 * }
 */
router.post('/ai/meal-suggestion', async (req, res) => {
  try {
    const {
      period = 'Meal',
      goalType = 'maintain',
      dailyGoal = 2000,
      consumedCalories = 0,
      recentMeals = [],
      mealsRemaining = 2,
      macroTargets,
      user = {}
    } = req.body || {};

    const remaining = Math.max(0, Number(dailyGoal) - Number(consumedCalories));
    const kcalWindow = suggestCalorieWindow(remaining, mealsRemaining);

    // Compute/normalize macro targets
    let targets = macroTargets;
    if (!targets || typeof targets.p !== 'number') {
      const weightKg = user.weightKg || (user.weightLbs ? user.weightLbs * 0.453592 : 75);
      targets = computeMacroTargets({ weightKg, dailyCalories: dailyGoal });
    }

    // Try OpenAI if available, else fallback stub
    if (!openai) {
      const s = pickStub(period, kcalWindow, recentMeals);
      return res.json({ ok: true, suggestion: s, rationale: { period, kcalWindow, remaining, targets, source: 'stub' } });
    }

    // Ask the model for ONE meal, JSON only, within constraints
    const prompt = `
You are a fitness nutrition assistant. Suggest exactly ONE ${period} that fits:
- Goal: ${goalType}
- Daily calories: ${dailyGoal}
- Consumed so far: ${consumedCalories}
- Remaining today: ${remaining}
- Remaining meals today (including this one): ${mealsRemaining}
- Calorie window for this meal: ${kcalWindow.min}–${kcalWindow.max} kcal (try to land inside)
- Target daily macros (g): protein=${targets.p}, carbs=${targets.c}, fat=${targets.f}
- Avoid repeating these recent meals: ${(Array.isArray(recentMeals) ? recentMeals.join(', ') : '')}

Return ONLY strict JSON with this shape (no extra words):
{
  "name": "string",
  "calories": 0,
  "macros": { "p": 0, "c": 0, "f": 0 },
  "prepMinutes": 0,
  "notes": "1 short sentence explaining why this fits"
}
Rules:
- Aim macros proportionally to daily targets and what’s typical for the period.
- Keep calories inside the window when possible.
- Prefer diverse options vs. recentMeals.
- Use common foods available in a typical US grocery store.
    `.trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5
    });

    const text = completion.choices?.[0]?.message?.content?.trim() || '';
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      json = m ? JSON.parse(m[0]) : null;
    }

    if (!json || typeof json.name !== 'string' || typeof json.calories !== 'number') {
      return res.status(502).json({ ok: false, error: 'Bad AI response', raw: text });
    }

    // Basic de-duplication: if name matches a recent meal, lightly nudge calories & note
    if (Array.isArray(recentMeals) &&
        recentMeals.some(r => r && r.toLowerCase() === json.name.toLowerCase())) {
      json.name = `${json.name} (variation)`;
      json.calories = Math.round(Math.min(kcalWindow.max, Math.max(kcalWindow.min, json.calories + 40)));
      if (!json.notes) json.notes = 'Varied slightly to avoid repetition.';
    }

    // Clamp calories into the window if wildly off
    if (json.calories < kcalWindow.min || json.calories > kcalWindow.max) {
      json.calories = Math.round(Math.min(kcalWindow.max, Math.max(kcalWindow.min, json.calories)));
    }

    return res.json({ ok: true, suggestion: json, rationale: { period, kcalWindow, remaining, targets, source: 'openai' } });
  } catch (err) {
    console.error('[ai/meal-suggestion] error:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Server error' });
  }
});

module.exports = router;
