// api/supa-check.js
import { supabaseAdmin } from "./_lib/supabaseAdmin.js";

export default async function handler(req, res) {
  try {
    const { error } = await supabaseAdmin
      .from("app_stripe_customers")
      .select("id", { head: true, count: "exact" })
      .limit(1);
    if (error) throw error;
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[supa-check] error", e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
