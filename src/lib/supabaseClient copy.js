// src/lib/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

const hasViteEnv = typeof import.meta !== 'undefined' && !!import.meta.env;

const url =
  (hasViteEnv && import.meta.env.VITE_SUPABASE_URL) ||
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SUPABASE_URL) ||
  (typeof process !== 'undefined' && process.env?.SUPABASE_URL) ||
  '';

const anon =
  (hasViteEnv && import.meta.env.VITE_SUPABASE_ANON_KEY) ||
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SUPABASE_ANON_KEY) ||
  (typeof process !== 'undefined' && process.env?.SUPABASE_ANON_KEY) ||
  '';

// Create as null if misconfigured so the app can still run in offline/local mode
export const supabase =
  url && anon
    ? createClient(url, anon, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          flowType: 'pkce',
        },
      })
    : null;

if (!url || !anon) {
  console.warn('[supabaseClient] Missing Supabase env. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}

// expose for console poking (helpful in dev)
if (typeof window !== 'undefined') {
  window.supabase = supabase;
}
