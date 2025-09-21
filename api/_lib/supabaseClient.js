// src/lib/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

// Vite envs (define in .env and on Vercel):
// VITE_SUPABASE_URL=https://<your-project>.supabase.co
// VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR...
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,       // keep user session in localStorage
    autoRefreshToken: true,     // refresh tokens automatically
    detectSessionInUrl: false,  // we’ll exchange ?code=… manually in App.jsx
  },
});
