// /api/_notify-email.js  (Vercel Node.js Serverless Function)
export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed", method: req.method });
  }

  try {
    // 1) Secret check
    const secret = req.headers["x-notify-secret"];
    if (!process.env.NOTIFY_SECRET || secret !== process.env.NOTIFY_SECRET) {
      return res.status(403).json({ ok: false, error: "Forbidden (bad secret)" });
    }

    // 2) Pull destination and payload from env (no code edits later)
    const to = process.env.NOTIFY_TO || "flyurteam@gmail.com";
    const from = process.env.NOTIFY_FROM; // must be a verified sender at Resend
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey || !from) {
      return res.status(500).json({ ok: false, error: "Missing RESEND_API_KEY or NOTIFY_FROM" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const subject = body.subject || "Slimcal notification";
    const text = body.text || "(no text)";
    const html = body.html || `<pre>${text}</pre>`;

    // 3) Send via Resend
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        text,
      }),
    });

    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return res.status(500).json({ ok: false, error: "Resend failed", details: json });
    }

    return res.status(200).json({ ok: true, id: json.id || null });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
