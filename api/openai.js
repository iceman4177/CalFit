// api/openai.js
import OpenAI from "openai";

export default async function handler(req, res) {
  // Ensure we only handle POST requests
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Grab your secret key from env
  const apiKey = process.env.OPENAI_API_KEY;
  console.log("🔑 OPENAI_API_KEY present?", Boolean(apiKey));

  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "Server misconfiguration: missing OPENAI_API_KEY." });
  }

  // Instantiate the client
  const openai = new OpenAI({ apiKey });

  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res
        .status(400)
        .json({ error: "Bad Request: `messages` array is required." });
    }

    // Call the chat completion endpoint
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages
    });

    // Forward the API response
    return res.status(200).json(completion);
  } catch (err) {
    console.error("OpenAI request failed:", err);
    return res
      .status(500)
      .json({ error: "OpenAI request failed.", detail: err.message });
  }
}
