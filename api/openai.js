// api/openai.js

import { Configuration, OpenAIApi } from "openai";

// Initialize configuration with your secret key
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
if (!configuration.apiKey) {
  console.error("Missing OPENAI_API_KEY environment variable");
}
const openai = new OpenAIApi(configuration);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Safely parse the incoming JSON body—even if req.body is undefined
  let body = {};
  try {
    body = req.body ? JSON.parse(req.body) : {};
  } catch {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
    }
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }
  }

  const { messages } = body;
  if (!messages) {
    return res.status(400).json({ error: "'messages' field is required" });
  }

  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",  // or whatever model you’re using
      messages,
    });
    return res.status(200).json(completion.data);
  } catch (err) {
    console.error("OpenAI error:", err);
    return res.status(500).json({ error: err.message || "Internal Server Error" });
  }
}
