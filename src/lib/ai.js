// src/lib/ai.js

// Stable device/client id for per-device limits (anon users)
export function getClientId() {
  let cid = localStorage.getItem('clientId');
  if (!cid) {
    cid = (crypto?.randomUUID?.() || `cid_${Date.now()}`);
    localStorage.setItem('clientId', cid);
  }
  return cid;
}

// Try to read the Supabase session JWT from localStorage (works in incognito too)
function getSupabaseJWTFromStorage() {
  try {
    const key = Object.keys(localStorage).find(
      k => k.startsWith('sb-') && k.endsWith('-auth-token')
    );
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const obj = JSON.parse(raw);
    // Supabase stores either { access_token, user, ... } or { currentSession: { access_token, user } }
    return (
      obj?.access_token ||
      obj?.currentSession?.access_token ||
      obj?.session?.access_token ||
      obj?.accessToken ||
      null
    );
  } catch (e) {
    return null;
  }
}

function getSupabaseUserFromStorage() {
  try {
    const key = Object.keys(localStorage).find(
      k => k.startsWith('sb-') && k.endsWith('-auth-token')
    );
    if (!key) return {};
    const obj = JSON.parse(localStorage.getItem(key) || '{}');
    const user =
      obj?.user ||
      obj?.currentSession?.user ||
      obj?.session?.user ||
      null;
    return { id: user?.id || null, email: user?.email || null };
  } catch {
    return {};
  }
}

// Main helper — ALWAYS sends Authorization + X-Client-Id (+ user/email when known)
export async function callAIGenerate(payload) {
  const token = getSupabaseJWTFromStorage();
  const { id: uid, email } = getSupabaseUserFromStorage();
  const clientId = getClientId();

  const headers = {
    'Content-Type': 'application/json',
    'X-Client-Id': clientId,
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (uid) headers['X-User-Id'] = uid;
  if (email) headers['X-User-Email'] = email;

  const resp = await fetch('/api/ai/generate', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload || {}),
  });

  if (resp.status === 402) {
    const err = new Error('Payment Required');
    err.code = 402;
    throw err;
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const err = new Error(`AI gateway error: ${resp.status} ${text}`);
    err.code = resp.status;
    throw err;
  }
  return resp.json().catch(() => ({}));
}
