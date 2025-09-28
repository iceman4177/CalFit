// api/me/pro-status.js
import { supabaseAdmin } from "../_lib/supabaseAdmin.js";

export const config = { api: { bodyParser: false } };

function setCors(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin || "https://slimcal.ai");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const OK = new Set(["active", "trialing"]);

export default async function handler(req, res) {
  setCors(res, process.env.ALLOWED_ORIGIN || "https://slimcal.ai");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const url = new URL(req.url, "http://x");
    const user_id = url.searchParams.get("user_id") || "";
    if (!user_id) return res.status(200).json({ isPro: false, reason: "missing_user_id" });

    if (!supabaseAdmin) {
      return res.status(200).json({ isPro: false, reason: "server_config" });
    }

    // 1) Prefer entitlements if the table exists
    try {
      const { data: ent, error: entErr } = await supabaseAdmin
        .from("entitlements")
        .select("is_pro, status, current_period_end, updated_at")
        .eq("user_id", user_id)
        .maybeSingle();

      if (!entErr && ent) {
        const isPro = !!ent.is_pro || (ent.status && OK.has(ent.status.toLowerCase()));
        return res.status(200).json({
          isPro,
          status: ent.status || null,
          current_period_end: ent.current_period_end || null,
          source: "entitlements",
        });
      }
    } catch {
      // table may not exist — fall through
    }

    // 2) Fallback to app_subscriptions (your table definitely has a row now)
    const { data: sub, error: subErr } = await supabaseAdmin
      .from("app_subscriptions")
      .select("status, current_period_end")
      .eq("user_id", user_id)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (subErr) {
      return res.status(200).json({ isPro: false, reason: "db_error", detail: subErr.message });
    }

    const row = sub?.[0] || null;
    const status = row?.status || null;
    const isPro = status ? OK.has(status.toLowerCase()) : false;

    return res.status(200).json({
      isPro,
      status,
      current_period_end: row?.current_period_end || null,
      source: "app_subscriptions",
    });
  } catch (e) {
    return res.status(200).json({ isPro: false, reason: "error", detail: e?.message || String(e) });
  }
}
