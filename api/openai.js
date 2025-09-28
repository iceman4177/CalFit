// api/openai.js
import OpenAI from "openai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  console.log("🔑 OPENAI_API_KEY present?", Boolean(apiKey));
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "Server misconfiguration: missing OPENAI_API_KEY." });
  }

  const openai = new OpenAI({ apiKey });

  try {
    const { messages, context } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res
        .status(400)
        .json({ error: "Bad Request: `messages` array is required." });
    }

    // Optional structured context from client (burned, consumed, meals, workouts)
    let contextText = "";
    if (context) {
      const parts = [];
      if (typeof context.burned === "number" || typeof context.consumed === "number") {
        parts.push(
          `Calories today: burned ${context.burned || 0}, consumed ${context.consumed || 0}, net ${
            (context.consumed || 0) - (context.burned || 0)
          }.`
        );
      }
      if (Array.isArray(context.meals) && context.meals.length > 0) {
        parts.push(
          "Meals logged today:\n" +
            context.meals
              .map(
                (m) =>
                  `- ${m.title || "Meal"}: ${m.total_calories || 0} cal (${(m.items || [])
                    .map((it) => `${it.food_name} ${it.qty}${it.unit || ""}`)
                    .join(", ")})`
              )
              .join("\n")
        );
      }
      if (Array.isArray(context.workouts) && context.workouts.length > 0) {
        parts.push(
          "Workouts logged today:\n" +
            context.workouts
              .map(
                (w) =>
                  `- ${w.exercise_name}: ${w.reps} reps × ${w.weight} lb (${w.calories || 0} cal est.)`
              )
              .join("\n")
        );
      }
      if (parts.length) {
        contextText = "\n\nExtra context from the app:\n" + parts.join("\n");
      }
    }

    const augmented = [
      ...messages,
      ...(contextText
        ? [{ role: "user", content: contextText }]
        : []),
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: augmented,
    });

    return res.status(200).json(completion);
  } catch (err) {
    console.error("OpenAI request failed:", err);
    return res
      .status(500)
      .json({ error: "OpenAI request failed.", detail: err.message });
  }
}
