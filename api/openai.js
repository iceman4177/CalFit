// /api/openai.js
import { Configuration, OpenAIApi } from "openai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Missing OPENAI_API_KEY");
    return res.status(500).json({ error: "Server misconfiguration." });
  }

  const config = new Configuration({ apiKey });
  const client = new OpenAIApi(config);

  try {
    const { messages } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "Request must include an array of messages." });
    }

    const completion = await client.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages
    });

    return res.status(200).json(completion.data);
  } catch (err) {
    console.error("OpenAI error:", err);
    const status  = err.response?.status || 500;
    const message = err.response?.data?.error?.message || err.message;
    return res.status(status).json({ error: message });
  }
}
