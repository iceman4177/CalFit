// /api/openai.js

import { Configuration, OpenAIApi } from "openai";

export default async function handler(req, res) {
  // only allow POST
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // make sure API key is present
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Missing OPENAI_API_KEY.");
    return res.status(500).json({ error: "Server misconfiguration." });
  }

  // parse body
  let body;
  try {
    body = req.body;
  } catch (err) {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const { messages, model = "gpt-4o-mini" } = body;
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: "`messages` must be an array." });
  }

  // configure OpenAI client
  const configuration = new Configuration({ apiKey });
  const openai = new OpenAIApi(configuration);

  try {
    const completion = await openai.createChatCompletion({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 500,
    });
    return res.status(200).json(completion.data);
  } catch (err) {
    console.error("OpenAI error:", err);
    const status = err.response?.status || 500;
    const data   = err.response?.data   || { error: "OpenAI API Error" };
    return res.status(status).json(data);
  }
}
