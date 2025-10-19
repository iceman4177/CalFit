import { createClient } from '@supabase/supabase-js';

// Force Node runtime (not Edge)
export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'Method not allowed' });

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const srk = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !srk) return res.status(500).json({ ok:false, error:'Missing Supabase env vars' });

    // Body can be string in some setups; parse safely
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const {
      user_id = null,
      email,
      name = null,
      streak = 0,
      client_id = null,
      joined_at = new Date().toISOString(),
    } = body;

    if (!email || !String(email).includes('@')) {
      return res.status(400).json({ ok:false, error:'Missing or invalid email' });
    }

    // Create admin client inside handler
    const supabase = createClient(url, srk, { auth: { persistSession: false } });

    // Try rich upsert first (requires these columns)
    const payloadFull = {
      email: String(email).trim().toLowerCase(),
      name,
      user_id,
      streak_at_signup: Number(streak) || 0,
      client_id,
      joined_at,
    };

    let full = await supabase
      .from('ambassador_leads')
      .upsert(payloadFull, { onConflict: 'email' })
      .select()
      .single();

    if (!full.error) {
      return res.status(200).json({ ok:true, lead: full.data });
    }

    // If schema mismatch (undefined column), fallback to legacy/minimal
    const msg = full.error.message || '';
    if (/column .* does not exist|42703/.test(msg)) {
      // Legacy schema path: assume `streak` instead of `streak_at_signup`, no client_id/joined_at
      let legacy = await supabase
        .from('ambassador_leads')
        .upsert({
          email: String(email).trim().toLowerCase(),
          name,
          user_id,
          streak: Number(streak) || 0,
        }, { onConflict: 'email' })
        .select()
        .single();

      if (!legacy.error) {
        return res.status(200).json({ ok:true, lead: legacy.data, downgraded:true });
      }

      // Minimal fallback: email only
      const minimal = await supabase
        .from('ambassador_leads')
        .upsert({ email: String(email).trim().toLowerCase() }, { onConflict: 'email' })
        .select()
        .single();

      if (!minimal.error) {
        return res.status(200).json({ ok:true, lead: minimal.data, minimal:true });
      }

      return res.status(500).json({
        ok:false, stage:'minimal', error:minimal.error.message, code:minimal.error.code || null,
        details:minimal.error.details || null, hint:minimal.error.hint || null
      });
    }

    // Non-schema error (RLS/keys/etc) — return details so we can fix
    return res.status(500).json({
      ok:false, stage:'full-upsert', error:full.error.message, code:full.error.code || null,
      details:full.error.details || null, hint:full.error.hint || null
    });
  } catch (e) {
    return res.status(500).json({ ok:false, error:e.message || 'Unexpected error' });
  }
}
