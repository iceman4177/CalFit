// api/_lib/supabaseAdmin.js
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

// Service-role client (bypasses RLS) — SERVER USE ONLY
export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false },
});
