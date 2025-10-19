// /api/users/heartbeat.js
import { supabaseAdmin } from "../_lib/supabaseAdmin.js";

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({
      ok: false,
      stage: "config",
      error: "Supabase admin client not configured (check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)",
    });
  }

  try {
    const {
      id,            // optional but nice: auth.uid()
      email,         // required (unique key for conflict)
      provider,      // 'google' etc
      display_name,  // optional
      last_client,   // optional e.g. 'web:slimcal-ai'
      ambassador_prompted, // optional boolean
    } = req.body || {};

    if (!email) {
      return res.status(400).json({ ok: false, error: "Missing email" });
    }

    const now = new Date().toISOString();

    const payload = {
      email,
      last_seen_at: now,
      last_client: last_client || "web",
    };
    if (id) payload.id = id;
    if (provider) payload.provider = provider;
    if (typeof display_name === "string") payload.display_name = display_name;
    if (typeof ambassador_prompted === "boolean") payload.ambassador_prompted = ambassador_prompted;

    const { data, error } = await supabaseAdmin
      .from("app_users")
      .upsert(payload, { onConflict: "email" })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, stage: "upsert", error: error.message });
    }

    return res.status(200).json({ ok: true, user: data });
  } catch (e) {
    return res.status(500).json({ ok: false, stage: "handler", error: e.message });
  }
}
