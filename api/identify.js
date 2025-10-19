// /api/identify.js
import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const URL =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL;
    const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!URL || !SRK) {
      return res.status(500).json({ ok: false, error: 'Missing Supabase env vars' });
    }

    const admin = createClient(URL, SRK, { auth: { persistSession: false } });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const {
      user_id = null,          // Supabase auth user id
      email = null,
      full_name = null,
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
      return res.status(400).json({ ok: false, error: 'Missing user_id or email' });
    }

    const now = new Date().toISOString();
    const base = {
      email,
      full_name,
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
    };

    // Try modern schema: primary key "id" (uuid) = auth.users.id
    let up = await admin
      .from('app_users')
      .upsert(user_id ? { id: user_id, ...base } : { ...base }, { onConflict: user_id ? 'id' : 'email' })
      .select()
      .single();

    // If the column "id" does not exist, retry using legacy "user_id"
    if (up.error && up.error.code === '42703') {
      up = await admin
        .from('app_users')
        .upsert(user_id ? { user_id, ...base } : { ...base }, { onConflict: user_id ? 'user_id' : 'email' })
        .select()
        .single();
    }

    if (up.error) {
      console.error('[identify] upsert error:', up.error);
      return res.status(500).json({ ok: false, error: up.error.message, code: up.error.code });
    }

    return res.status(200).json({ ok: true, user: up.data });
  } catch (e) {
    console.error('[identify] exception:', e);
    return res.status(500).json({ ok: false, error: e?.message || 'Unexpected error' });
  }
}
