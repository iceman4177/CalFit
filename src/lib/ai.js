// src/lib/ai.js
import { supabase } from '../lib/supabaseClient';

export async function callAIGenerate(payload = {}) {
  // get Supabase session (works in normal + incognito)
  const { data: { session } = {} } = await supabase.auth.getSession();
  const user = session?.user || null;

  // stable client id for free-pass accounting
  let clientId = localStorage.getItem('clientId');
  if (!clientId) {
    clientId = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`).toString();
    localStorage.setItem('clientId', clientId);
  }

  const headers = {
    'Content-Type': 'application/json',
    'X-Client-Id': clientId,
  };
  if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  if (user?.id) headers['X-User-Id'] = user.id;
  if (user?.email) headers['X-User-Email'] = user.email;

  const res = await fetch('/api/ai/generate', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      // body fallback identity for server-side resolution
      user_id: user?.id ?? null,
      email: user?.email ?? null,
      ...payload,
    }),
  });

  if (res.status === 402) {
    const detail = await res.json().catch(() => ({}));
    const err = new Error('Upgrade required');
    err.code = 402;
    err.detail = detail;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`AI generate failed: ${res.status} ${text}`);
    err.code = res.status;
    throw err;
  }
  return res.json();
}
