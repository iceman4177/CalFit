// api/openai.js

import { Configuration, OpenAIApi } from "openai";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Ensure API key is set
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ Missing OPENAI_API_KEY");
    return res
      .status(500)
      .json({ error: "OpenAI API key not configured on the server." });
  }

  // Extract messages from already‑parsed JSON body
  const { messages } = req.body || {};
  if (!messages) {
    return res
      .status(400)
      .json({ error: "'messages' field is required in the request body." });
  }

  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages,
    });
    return res.status(200).json(completion.data);
  } catch (error) {
    console.error("OpenAI error:", error);
    const status = error.response?.status || 500;
    const message = error.message || "Internal Server Error";
    return res.status(status).json({ error: message });
  }
}
