import { supabaseAdmin } from "../_lib/supabaseAdmin.js";
export const config = { api: { bodyParser: true } };
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"Method not allowed" });
  if (!supabaseAdmin) return res.status(500).json({ ok:false, error:"Supabase admin not configured" });
  try {
    const { id, email, provider, display_name, last_client } = req.body || {};
    if (!email) return res.status(400).json({ ok:false, error:"Missing email" });
    const now = new Date().toISOString();
    const payload = {
      email, last_seen_at: now, last_client: last_client || "web",
      ...(id ? { id } : {}), ...(provider ? { provider } : {}),
      ...(display_name ? { display_name } : {})
    };
    const { data, error } = await supabaseAdmin
      .from("app_users")
      .upsert(payload, { onConflict: "email" })
      .select()
      .single();
    if (error) return res.status(500).json({ ok:false, error:error.message });
    return res.status(200).json({ ok:true, user:data });
  } catch (e) { return res.status(500).json({ ok:false, error:e.message }); }
}
