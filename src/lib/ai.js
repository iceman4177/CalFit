// src/lib/ai.js
// Shared AI helpers used by Meals, Workouts, and Daily Recap Coach.

//
// Stable device/client id for per-device limits (anon & signed-out users)
//
export function getClientId() {
  try {
    let cid = localStorage.getItem('clientId');
    if (!cid) {
      cid = (crypto?.randomUUID?.() || `cid_${Date.now()}`).slice(0, 64);
      localStorage.setItem('clientId', cid);
    }
    return cid;
  } catch {
    return 'anon';
  }
}

//
// Supabase session helpers (robust to incognito and key name changes)
//
function findSupabaseAuthRecord() {
  try {
    const key =
      Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token')) ||
      // legacy/dev keys:
      'supabase.auth.token';
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj || null;
  } catch {
    return null;
  }
}

export function getSupabaseJWTFromStorage() {
  const rec = findSupabaseAuthRecord();
  if (!rec) return null;
  return (
    rec?.access_token ||
    rec?.currentSession?.access_token ||
    rec?.session?.access_token ||
    rec?.accessToken ||
    null
  );
}

export function getSupabaseUserFromStorage() {
  const rec = findSupabaseAuthRecord();
  const user = rec?.user || rec?.currentSession?.user || rec?.session?.user || null;
  return {
    id: user?.id || null,
    email: user?.email || null,
  };
}

export function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() };
  const tok = getSupabaseJWTFromStorage();
  const { id, email } = getSupabaseUserFromStorage();
  if (tok) headers['Authorization'] = `Bearer ${tok}`;
  if (id) headers['X-Supabase-User-Id'] = id;    // server checks this too
  if (email) headers['X-User-Email'] = email;
  return headers;
}

//
// Central POST to AI gateway
//
export async function postAI(feature, body = {}) {
  const resp = await fetch('/api/ai/generate', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ feature, ...body }),
  });

  if (resp.status === 402) {
    const e = new Error('Payment Required');
    e.code = 402;
    throw e;
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const e = new Error(`AI gateway error ${resp.status} ${text}`);
    e.code = resp.status;
    throw e;
  }
  return resp.json();
}

// Lightweight probe to decide if a feature is gated for the current user/device
export async function probeEntitlement(feature, body = {}) {
  try {
    const resp = await fetch('/api/ai/generate', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ feature, count: 1, ...body }),
    });
    if (resp.status === 402) return { gated: true };
    return { gated: !resp.ok };
  } catch {
    // Fail open so Pro/Trial don’t get accidentally blocked offline
    return { gated: false };
  }
}

// Back-compat wrapper if some code imports callAIGenerate directly
export async function callAIGenerate(payload) {
  const feature = String(payload?.feature || payload?.type || payload?.mode || 'workout').toLowerCase();
  return postAI(feature, payload);
}
