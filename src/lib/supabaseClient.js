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

const mask = (s) => (typeof s === 'string' && s.length > 10 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s);
console.log('[Supabase ENV]', {
  urlHost: (() => { try { return new URL(url).host; } catch { return null; } })(),
  urlPresent: !!url,
  anonPresent: !!anon,
  anonPreview: mask(anon)
});

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
});

// expose for console poking
if (typeof window !== 'undefined') {
  window.supabase = supabase;
}
