// /api/_lib/supabaseAdmin.js
import { createClient } from "@supabase/supabase-js"; 

const url = process.env.SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Never throw at module scope; return null if misconfigured
export const supabaseAdmin =
  url && serviceKey
    ? createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      })
    : null;

if (!url || !serviceKey) {
  console.warn("[supabaseAdmin] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}
