// /api/openai.js
import { Configuration, OpenAIApi } from "openai";

export default async function handler(req, res) {
  // 1) Only accept POST
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ error: "Method Not Allowed", allowed: ["POST"] });
  }

  // 2) Check body
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ error: "Bad Request: no JSON body" });
  }

  // 3) Verify API key
  const apiKey = process.env.OPENAI_API_KEY;
  console.log("OPENAI_API_KEY present?", !!apiKey);
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "Server misconfiguration: missing OPENAI_API_KEY" });
  }

  // 4) Initialize client
  const configuration = new Configuration({ apiKey });
  const openai = new OpenAIApi(configuration);

  try {
    // forward the exact payload
    const completion = await openai.createChatCompletion(req.body);
    return res.status(200).json(completion.data);
  } catch (err) {
    console.error("OpenAI error:", err);
    // if the error has a response body, include it
    const message =
      err.response?.data || err.message || "Unknown server error";
    return res.status(500).json({ error: "OpenAI API error", message });
  }
}
