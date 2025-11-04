// /api/_notify-email.js
import { Resend } from "resend";
export const config = { api: { bodyParser: true } };

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "Method not allowed" });

  // simple auth gate
  const secret = req.headers["x-notify-secret"];
  if (!secret || secret !== process.env.NOTIFY_SECRET)
    return res.status(403).json({ ok: false, error: "Unauthorized" });

  try {
    const to = process.env.NOTIFY_TO;
    const from = process.env.NOTIFY_FROM;
    if (!to || !from)
      return res
        .status(500)
        .json({ ok: false, error: "Missing NOTIFY_TO/NOTIFY_FROM env vars" });

    const { subject = "Slimcal Notification", text = "", html } = req.body || {};

    const result = await resend.emails.send({
      from,
      to,
      subject,
      text,
      html: html || `<pre>${text}</pre>`,
    });

    res.status(200).json({ ok: true, result });
  } catch (e) {
    console.error("Resend error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
}
