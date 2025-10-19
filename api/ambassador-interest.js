// api/ambassador-interest.js
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { user_id, email, name, streak, client_id, joined_at } = body || {};

    if (!url || !serviceKey) {
      return res.status(500).json({ ok: false, error: 'Missing Supabase env vars' });
    }
    if (!email || !String(email).includes('@')) {
      return res.status(400).json({ ok: false, error: 'Missing or invalid email' });
    }

    const { data, error } = await supabase
      .from('ambassador_leads')
      .upsert(
        {
          user_id: user_id || null,
          email: String(email).trim().toLowerCase(),
          name: name || null,
          streak_at_signup: Number(streak) || 0,   // <-- column must exist
          client_id: client_id || null,            // <-- column must exist if you keep it
          joined_at: joined_at || new Date().toISOString(), // <-- column must exist if you keep it
        },
        { onConflict: 'email' } // OK even if you don't have a unique index yet
      )
      .select()
      .single();

    if (error) {
      // Return full details so you can see the exact cause in Network → Response
      return res.status(500).json({
        ok: false,
        error: error.message,
        code: error.code || null,
        details: error.details || null,
        hint: error.hint || null,
      });
    }

    return res.status(200).json({ ok: true, lead: data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || 'Unexpected error' });
  }
}
