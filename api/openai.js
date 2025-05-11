// api/openai.js
import { Configuration, OpenAIApi } from "openai";

export default async function handler(req, res) {
  // 1) ONLY POST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 2) VERIFY we have your secret
  const key = process.env.OPENAI_API_KEY;
  console.log("🔑 OPENAI_API_KEY present?", Boolean(key));
  if (!key) {
    console.error("❌ Missing OPENAI_API_KEY in environment!");
    return res
      .status(500)
      .json({ error: "Server misconfiguration: missing API key." });
  }

  // 3) CONFIGURE client
  const config = new Configuration({ apiKey: key });
  const openai = new OpenAIApi(config);

  // 4) PARSE & VALIDATE body
  let { messages, model = "gpt-3.5-turbo", temperature = 0.7 } = req.body;
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: "Invalid request: messages must be an array" });
  }

  try {
    // 5) CALL OpenAI
    const completion = await openai.createChatCompletion({
      model,
      messages,
      temperature,
    });
    return res.status(200).json(completion.data);
  } catch (err) {
    // 6) HANDLE errors
    console.error("❌ OpenAI API error:", err);
    if (err.response?.data) {
      return res.status(err.response.status).json(err.response.data);
    }
    return res.status(500).json({ error: "Server misconfiguration." });
  }
}
