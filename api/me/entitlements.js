// /api/me/entitlements.js
// Returns the user's entitlements (features) from v_user_entitlements.
// Usage: GET /api/me/entitlements?user_id=<uuid>

import { createClient } from '@supabase/supabase-js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'GET')
    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !srk)
    return res
      .status(500)
      .json({ ok: false, error: 'Missing Supabase env vars' });

  try {
    const user_id = String(req.query.user_id || '').trim();
    if (!user_id)
      return res.status(400).json({ ok: false, error: 'user_id is required' });

    const supabase = createClient(url, srk, { auth: { persistSession: false } });

    const { data, error } = await supabase
      .from('v_user_entitlements')
      .select('feature, starts_at, ends_at')
      .eq('user_id', user_id);

    if (error)
      return res.status(500).json({ ok: false, error: error.message });

    const features = Array.from(new Set((data || []).map((r) => r.feature)));

    const isProActive = (data || []).some((r) => {
      if (r.feature !== 'pro') return false;
      if (!r.ends_at) return true;
      return new Date(r.ends_at) > new Date();
    });

    const status = isProActive ? 'active' : 'none';
    return res.status(200).json({
      ok: true,
      user_id,
      features,
      isProActive,
      status,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
