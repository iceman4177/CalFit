// /api/identify.js
import { createClient } from '@supabase/supabase-js';

// Force Node runtime (so env + supabase-js work)
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!URL || !SRK) {
      return res.status(500).json({ ok: false, error: 'Missing Supabase env vars' });
    }

    const supabase = createClient(URL, SRK, { auth: { persistSession: false } });

    // Handle both stringified and JSON body
    const body = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});

    const {
      user_id = null,   // Supabase auth.users.id
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
      full_name = null,
    } = body;

    if (!user_id && !email) {
      return res.status(400).json({ ok: false, error: 'Missing user_id or email' });
    }

    const now = new Date().toISOString();

    // We design app_users with PRIMARY KEY (id) referencing auth.users(id).
    // That means inserts must include id. For "email only" calls, we only UPDATE an existing row.
    // See SQL: id uuid primary key references auth.users(id)
    const payload = {
      // DB columns that exist (ensure your SQL includes these):
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

    let resp;

    if (user_id) {
      // Preferred path: upsert by id (PRIMARY KEY). Works for first insert and updates.
      resp = await supabase
        .from('app_users')
        .upsert({ id: user_id, ...payload }, { onConflict: 'id' })
        .select()
        .single();

      if (resp.error) {
        return res.status(500).json({ ok: false, error: resp.error.message, code: resp.error.code });
      }
      return res.status(200).json({ ok: true, user: resp.data });
    }

    // Fallback: no user_id — try UPDATE by unique email only (no insert).
    // This requires a UNIQUE constraint on email (included in SQL below).
    const update = await supabase
      .from('app_users')
      .update(payload)
      .eq('email', email)
      .select()
      .maybeSingle();

    if (update.error) {
      return res.status(500).json({ ok: false, error: update.error.message, code: update.error.code });
    }

    if (!update.data) {
      // No matching email row exists; we can’t insert without id due to FK/PK.
      return res.status(409).json({
        ok: false,
        error: 'No app_user row to update by email, and no user_id provided.',
        code: 'NO_ID_FOR_INSERT'
      });
    }

    return res.status(200).json({ ok: true, user: update.data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Unexpected error' });
  }
}
