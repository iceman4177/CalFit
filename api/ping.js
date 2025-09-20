// api/ping.js
export const config = { api: { bodyParser: false } }; // don't pre-parse

async function readRaw(req) {
  // If the runtime provides the WHATWG Request API:
  if (typeof req.text === "function") {
    return await req.text(); // string
  }
  // Fallback to Node stream (http.IncomingMessage)
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req, res) {
  if (req.method === "POST") {
    try {
      const raw = await readRaw(req);
      console.log("[ping] POST raw length =", raw.length, "first 80:", raw.slice(0, 80));
      return res.status(200).json({ ok: true, len: raw.length });
    } catch (e) {
      console.error("[ping] read error:", e);
      return res.status(200).json({ ok: false, error: "read error" });
    }
  }
  // GET health
  return res.status(200).json({ ok: true, ts: Date.now() });
}
