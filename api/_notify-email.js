// /api/_notify-email.js
// Sends a simple transactional email using SendGrid.
// Env needed:
//   SENDGRID_API_KEY
//   NOTIFY_TO           (where you want alerts delivered, e.g., "Josh@LifeChangingLending.com")
//   NOTIFY_FROM         (verified sender, e.g., "alerts@slimcal.ai")
//   NOTIFY_SECRET       (shared secret; DB/webhooks must include X-Notify-Secret header)

import sgMail from "@sendgrid/mail";

export const config = { api: { bodyParser: true, externalResolver: true } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const secret = req.headers["x-notify-secret"] || "";
    if (!process.env.NOTIFY_SECRET || secret !== process.env.NOTIFY_SECRET) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const { subject, text, html } = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (!subject || (!text && !html)) {
      return res.status(400).json({ ok: false, error: "Missing subject or content" });
    }

    const to = process.env.NOTIFY_TO;
    const from = process.env.NOTIFY_FROM;
    if (!process.env.SENDGRID_API_KEY || !to || !from) {
      return res.status(500).json({ ok: false, error: "Missing SENDGRID_API_KEY/NOTIFY_TO/NOTIFY_FROM" });
    }

    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    const msg = {
      to,
      from,
      subject: `[Slimcal.ai] ${subject}`,
      text: text || (html ? html.replace(/<[^>]+>/g, "") : ""),
      html: html || `<pre>${(text || "").replace(/&/g,"&amp;").replace(/</g,"&lt;")}</pre>`,
    };

    await sgMail.send(msg);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "send failed" });
  }
}
