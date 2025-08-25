// api/ai/meal-suggestion.js

let openaiClient = null;
const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
if (hasOpenAIKey) {
  try {
    const { OpenAI } = require('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  } catch (e) {
    console.warn('[meal-suggestion] openai module not found; falling back to stub.', e?.message);
    openaiClient = null;
  }
}

function computeMacroTargets({ weightKg = 75, dailyCalories = 2000 }) {
  const p = Math.round(1.8 * weightKg);
  const f = Math.round(0.8 * weightKg);
  const kcalsFromP = p * 4, kcalsFromF = f * 9;
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
  const candidates = pool
    .filter(m => m.calories >= min && m.calories <= max)
    .filter(m => !recentMeals.some(r => r && r.toLowerCase() === m.name.toLowerCase()));
  const list = candidates.length ? candidates : pool;
  return list[Math.floor(Math.random() * list.length)];
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
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

    let targets = macroTargets;
    if (!targets || typeof targets.p !== 'number') {
      const weightKg = user.weightKg || (user.weightLbs ? user.weightLbs * 0.453592 : 75);
      targets = computeMacroTargets({ weightKg, dailyCalories: dailyGoal });
    }

    // If OpenAI client is not available, serve a smart stub
    if (!openaiClient) {
      const s = pickStub(period, kcalWindow, Array.isArray(recentMeals) ? recentMeals : []);
      res.status(200).json({ ok: true, suggestion: s, rationale: { period, kcalWindow, remaining, targets, source: 'stub' } });
      return;
    }

    const prompt = `
Return ONLY JSON like:
{"name":"...", "calories":123, "macros":{"p":30,"c":40,"f":12}, "prepMinutes":10, "notes":"short reason"}
Constraints:
- Period: ${period} | Goal: ${goalType}
- Daily: ${dailyGoal} | Consumed: ${consumedCalories} | Remaining: ${remaining}
- Meals remaining (incl. this one): ${mealsRemaining}
- Calorie window: ${kcalWindow.min}–${kcalWindow.max}
- Macro targets (g): p=${targets.p}, c=${targets.c}, f=${targets.f}
- Avoid: ${(Array.isArray(recentMeals) ? recentMeals.join(', ') : '')}
Keep JSON strict (no extra prose).`.trim();

    const completion = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
    });

    const text = completion?.choices?.[0]?.message?.content;
    const safeText = typeof text === 'string' ? text.trim() : '';
    let json = null;

    // Robust JSON extraction
    try {
      json = JSON.parse(safeText);
    } catch {
      const m = safeText ? safeText.match(/\{[\s\S]*\}/) : null;
      if (m && m[0]) {
        try { json = JSON.parse(m[0]); } catch {}
      }
    }

    if (!json || typeof json.name !== 'string') {
      res.status(502).json({ ok: false, error: 'Bad AI response', raw: safeText });
      return;
    }

    // 🔒 Ensure calories is always a number
    let safeCalories = 0;
    if (json.calories != null) {
      const match = String(json.calories).match(/\d+/);
      if (match) safeCalories = parseInt(match[0], 10);
    }
    // Clamp into kcal window
    safeCalories = Math.round(Math.min(kcalWindow.max, Math.max(kcalWindow.min, safeCalories)));

    json.calories = safeCalories;

    // De-dupe
    if (Array.isArray(recentMeals) && recentMeals.some(r => r && r.toLowerCase() === json.name.toLowerCase())) {
      json.name = `${json.name} (variation)`;
      json.calories = Math.round(Math.min(kcalWindow.max, Math.max(kcalWindow.min, json.calories + 40)));
      if (!json.notes) json.notes = 'Varied slightly to avoid repetition.';
    }

    res.status(200).json({ ok: true, suggestion: json, rationale: { period, kcalWindow, remaining, targets, source: 'openai' } });
  } catch (err) {
    console.error('[api/ai/meal-suggestion] error:', err);
    res.status(500).json({ ok: false, error: err.message || 'Server error' });
  }
};
