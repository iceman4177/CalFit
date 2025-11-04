// /api/users/heartbeat.js
import { supabaseAdmin } from "../_lib/supabaseAdmin.js";

export const config = { api: { bodyParser: true } };

async function notify(subject, payload = {}) {
  try {
    const base =
      process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ||
      (process.env.VERCEL_URL
        ? (process.env.VERCEL_URL.startsWith("http")
            ? process.env.VERCEL_URL
            : `https://${process.env.VERCEL_URL}`).replace(/\/$/, "")
        : "");
    if (!base) return;
    const url = `${base}/api/_notify-email`;
    if (!process.env.NOTIFY_SECRET) return;

    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Notify-Secret": process.env.NOTIFY_SECRET,
      },
      body: JSON.stringify({
        subject,
        text: JSON.stringify(payload, null, 2),
        html: `<pre>${JSON.stringify(payload, null, 2)}</pre>`,
      }),
    });
  } catch {
    // never block heartbeat on notify
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!supabaseAdmin) {
    return res
      .status(500)
      .json({ ok: false, error: "Supabase admin not configured" });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { id, email, provider, display_name, last_client } = body;

    if (!email) return res.status(400).json({ ok: false, error: "Missing email" });

    const now = new Date().toISOString();

    // Check if we've seen this user before
    let hadExisting = false;
    if (id) {
      const existingById = await supabaseAdmin
        .from("app_users")
        .select("id")
        .eq("id", id)
        .maybeSingle();
      hadExisting = !!existingById?.data;
    }
    if (!hadExisting) {
      const existingByEmail = await supabaseAdmin
        .from("app_users")
        .select("id")
        .eq("email", email.toLowerCase())
        .maybeSingle();
      hadExisting = !!existingByEmail?.data;
    }

    // Upsert user row
    const payload = {
      email: String(email).toLowerCase(),
      last_seen_at: now,
      last_client: last_client || "web",
      ...(id ? { id } : {}),
      ...(provider ? { provider } : {}),
      ...(display_name ? { display_name } : {}),
    };

    const { data, error } = await supabaseAdmin
      .from("app_users")
      .upsert(payload, { onConflict: "email" })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }

    // FIRST SIGN-IN email
    if (!hadExisting && data) {
      await notify(`New user signed in: ${data.email}`, {
        user_id: data.id || id || null,
        email: data.email,
        provider: provider || data.provider || "unknown",
        display_name: display_name || data.display_name || null,
        last_client: payload.last_client,
        first_seen_at: now,
      });
    }

    return res.status(200).json({ ok: true, user: data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
