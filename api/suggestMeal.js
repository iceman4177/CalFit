import fetch from 'node-fetch';

const MAX_SERVER_RETRIES = 2;

export default async function handler(req, res) {
  if (!['GET','POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const {
    period = 'Dinner',
    dailyGoal = '0',
    consumed  = '0',
    goalType  = 'maintain',
    recentMeals = ''
  } = req.method === 'GET' ? req.query : req.body;

  // Build a tighter, capped prompt
  const prompt = `
You are a smart nutrition assistant.
It's ${period.toLowerCase()}.
User goal: ${goalType} weight.
Daily target: ${dailyGoal} kcal; consumed so far: ${consumed} kcal.
Recently eaten (last 3): [${recentMeals}]

Suggest exactly one ${period.toLowerCase()} meal in JSON only:
{
  "name": "…",                     // string
  "calories": <100–800>,           // integer
  "macros": { "p":int,"c":int,"f":int }, // grams
  "prepMinutes": <1–20>            // integer
}
`;

  for (let attempt = 1; attempt <= MAX_SERVER_RETRIES; attempt++) {
    try {
      // Dev fallback if no key
      if (!apiKey) {
        return res.status(200).json({
          name: 'Avocado Toast',
          calories: 350,
          macros: { p: 8, c: 40, f: 18 },
          prepMinutes: 7
        });
      }

      const ai = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type':'application/json',
          'Authorization':`Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [{ role:'user', content: prompt }],
          temperature: 0.8,
          max_tokens: 200
        })
      });

      if (!ai.ok) {
        const txt = await ai.text();
        console.error('OpenAI error', ai.status, txt);
        throw new Error('OpenAIBad');
      }

      const payload = await ai.json();
      const raw = payload.choices?.[0]?.message?.content?.trim();
      let meal = JSON.parse(raw);

      // Basic validation
      if (
        !meal.name ||
        typeof meal.calories !== 'number' ||
        meal.calories < 100 ||
        meal.calories > 800 ||
        typeof meal.prepMinutes !== 'number' ||
        meal.prepMinutes < 1 ||
        meal.prepMinutes > 20
      ) {
        console.warn('Validation reject:', meal);
        throw new Error('ValidationFailed');
      }

      return res.status(200).json(meal);

    } catch (err) {
      console.warn(`Attempt ${attempt} failed:`, err.message);
      if (attempt === MAX_SERVER_RETRIES) {
        return res.status(500).json({ error:'Could not generate a valid meal' });
      }
      // otherwise retry
    }
  }
}
