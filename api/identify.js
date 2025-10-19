// api/identify.js
import { createClient } from '@supabase/supabase-js';

// Force Node runtime (so env + supabase-js work)
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

  try {
    const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!URL || !SRK) return res.status(500).json({ ok:false, error:'Missing Supabase env vars' });

    const supabase = createClient(URL, SRK, { auth: { persistSession: false } });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const {
      user_id = null,
      email = null,
      client_id = null,
      last_path = '/',
      is_pro = false,
      plan_status = null,
      source = 'web',
      utm_source = null,
      utm_medium = null,
      utm_campaign = null,
      referrer = null,
      user_agent = null,
    } = body;

    if (!user_id && !email) {
      return res.status(400).json({ ok:false, error:'Missing user_id or email' });
    }

    const now = new Date().toISOString();

    // Try upsert by user_id first (preferred)
    let up = null;
    if (user_id) {
      up = await supabase
        .from('app_users')
        .upsert({
          user_id,
          email,
          client_id,
          last_path,
          last_seen_at: now,
          is_pro,
          plan_status,
          source,
          utm_source,
          utm_medium,
          utm_campaign,
          referrer,
          user_agent,
        }, { onConflict: 'user_id' })
        .select().single();
    } else {
      // fallback upsert by email
      up = await supabase
        .from('app_users')
        .upsert({
          email,
          client_id,
          last_path,
          last_seen_at: now,
          is_pro,
          plan_status,
          source,
          utm_source,
          utm_medium,
          utm_campaign,
          referrer,
          user_agent,
        }, { onConflict: 'email' })
        .select().single();
    }

    if (up.error) {
      return res.status(500).json({ ok:false, error: up.error.message, code: up.error.code });
    }

    return res.status(200).json({ ok:true, user: up.data });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message || 'Unexpected error' });
  }
}
