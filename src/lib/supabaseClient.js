// src/lib/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

// Detect Vite-style envs safely (TS-friendly)
const hasViteEnv = typeof import.meta !== 'undefined' && !!import.meta.env;

const url =
  (hasViteEnv && import.meta.env.VITE_SUPABASE_URL) ||
  (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_SUPABASE_URL) ||
  (typeof process !== 'undefined' && process.env && process.env.SUPABASE_URL) || // optional fallback
  '';

const anon =
  (hasViteEnv && import.meta.env.VITE_SUPABASE_ANON_KEY) ||
  (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ||
  (typeof process !== 'undefined' && process.env && process.env.SUPABASE_ANON_KEY) || // optional fallback
  '';

// Loud log if misconfigured
if (!url || !anon) {
  // eslint-disable-next-line no-console
  console.error('[Supabase] Missing env vars', { urlPresent: !!url, anonPresent: !!anon });
}

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce', // recommended for SPA + Google OAuth
  },
});
