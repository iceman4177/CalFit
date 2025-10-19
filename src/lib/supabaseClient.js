// src/lib/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

// Works with Vite and Next/Vercel env names
const url =
  (typeof import !== 'undefined' && import.meta?.env?.VITE_SUPABASE_URL) ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL; // optional fallback

const anon =
  (typeof import !== 'undefined' && import.meta?.env?.VITE_SUPABASE_ANON_KEY) ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anon) {
  // eslint-disable-next-line no-console
  console.error('[Supabase] Missing env vars', { urlPresent: !!url, anonPresent: !!anon });
}

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce', // recommended for SPA + Google
  },
});
