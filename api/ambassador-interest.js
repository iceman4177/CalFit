import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // server-side key
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id, email, streak, client_id, joined_at } = req.body || {};

  try {
    const { error } = await supabase
      .from('ambassador_leads')
      .insert({
        user_id,
        email,
        streak_at_signup: streak || 0,
        client_id,
        joined_at: joined_at || new Date().toISOString(),
      });

    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[API] ambassador-interest insert failed:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
