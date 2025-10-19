// /api/identify.js
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    if (!supabaseAdmin) {
      // Don't crash the app; log and return soft-ok to avoid UI noise
      console.warn("[identify] Admin client not configured");
      return res.status(200).json({ ok: true, note: "admin client missing; skipped" });
    }

    const {
      user_id, email, full_name, client_id, last_path,
      is_pro, plan_status, source,
      utm_source, utm_medium, utm_campaign,
      referrer, user_agent
    } = req.body || {};

    // Minimal insert; avoid failing if fields are missing
    const payload = {
      user_id: user_id || null,
      email: email || null,
      full_name: full_name || null,
      client_id: client_id || null,
      last_path: last_path || null,
      is_pro: !!is_pro,
      plan_status: plan_status || null,
      source: source || "web",
      utm_source: utm_source || null,
      utm_medium: utm_medium || null,
      utm_campaign: utm_campaign || null,
      referrer: referrer || null,
      user_agent: user_agent || null
    };

    const { error } = await supabaseAdmin
      .from("app_identify_events")
      .insert(payload);

    if (error) {
      console.warn("[identify] insert error", error.message);
      // Return soft-ok so the UI isn’t spammed by red errors
      return res.status(200).json({ ok: true, note: "logged with warning" });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.warn("[identify] handler error", e.message);
    // Return soft-ok to avoid noisy UI; the analytics event is non-critical
    return res.status(200).json({ ok: true, note: "exception swallowed" });
  }
}
