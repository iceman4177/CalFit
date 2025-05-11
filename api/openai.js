// api/openai.js
import { Configuration, OpenAIApi } from "openai";

const config = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,  // must be set in Vercel Dashboard → Settings → Environment Variables
});
const openai = new OpenAIApi(config);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { messages, model = "gpt-3.5-turbo", temperature = 0.7 } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "Invalid request: messages must be an array" });
    }

    const completion = await openai.createChatCompletion({
      model,
      messages,
      temperature,
    });

    return res.status(200).json(completion.data);
  } catch (err) {
    console.error("❌ OpenAI error:", err);
    // if OpenAI returned a specific error payload:
    if (err.response?.data) {
      return res.status(err.response.status).json(err.response.data);
    }
    return res.status(500).json({ error: "Server misconfiguration." });
  }
}
