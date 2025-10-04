// /api/_lib/openaiClient.js
export async function callOpenAI({ system, user, response_format = "json_object" }) {
  const r = await fetch((process.env.PUBLIC_BASE_URL || "") + "/api/openai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: typeof user === "string" ? user : JSON.stringify(user) }
      ],
      response_format: { type: response_format }
    })
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`AI upstream failed: ${txt || r.statusText}`);
  }
  return r.json();
}
