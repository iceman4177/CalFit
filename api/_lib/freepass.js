// /api/_lib/freepass.js
import { createClient } from '@supabase/supabase-js';

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const FREE_LIMIT = 3;

/**
 * Returns { allowed: boolean, remaining: number }
 * - Grants up to FREE_LIMIT uses per feature per day per client_id when user has no pro/trial.
 */
export async function checkAndConsumeFreePass({ clientId, feature }) {
  if (!clientId || !feature) return { allowed: false, remaining: 0 };

  // upsert row and increment atomically with single RPC-like statement
  const { data, error } = await supa
    .from('ai_free_passes')
    .upsert(
      { client_id: clientId, feature, day_key: new Date().toISOString().slice(0,10), uses: 0 },
      { onConflict: 'client_id,feature,day_key', ignoreDuplicates: false }
    )
    .select('client_id,feature,day_key,uses')
    .single();

  if (error && !data) {
    console.error('[freepass] upsert error', error);
    return { allowed: false, remaining: 0 };
  }

  const currentUses = data?.uses ?? 0;
  if (currentUses >= FREE_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  const { error: updErr } = await supa
    .from('ai_free_passes')
    .update({ uses: currentUses + 1 })
    .eq('client_id', data.client_id)
    .eq('feature', data.feature)
    .eq('day_key', data.day_key);

  if (updErr) {
    console.error('[freepass] update error', updErr);
    return { allowed: false, remaining: 0 };
  }

  return { allowed: true, remaining: FREE_LIMIT - (currentUses + 1) };
}
