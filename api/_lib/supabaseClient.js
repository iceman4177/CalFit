import { createClient } from '@supabase/supabase-js';

// Requires these to be set in your environment (Vite):
// VITE_SUPABASE_URL
// VITE_SUPABASE_ANON_KEY
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Handle both ?code=... and #access_token=... returns automatically
    detectSessionInUrl: true,
  },
});
