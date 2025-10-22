// src/lib/billing.js
import { supabase } from './supabaseClient';

/**
 * Opens Stripe Billing Portal for the current signed-in user.
 * Uses your existing POST /api/portal (returns { url } or 404 if no customer yet).
 */
export async function openBillingPortal() {
  try {
    const { data } = await supabase.auth.getUser();
    const user_id = data?.user?.id;
    if (!user_id) {
      console.warn('[billing] no user, cannot open portal');
      // optionally trigger your sign-in flow:
      window.dispatchEvent(new CustomEvent('slimcal:open-signin'));
      return;
    }

    const res = await fetch('/api/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id }),
    });

    // If no Stripe customer on file, nudge user to Upgrade flow
    if (res.status === 404) {
      console.info('[billing] no stripe customer yet -> open Upgrade');
      window.dispatchEvent(new CustomEvent('slimcal:open-upgrade'));
      return;
    }

    const json = await res.json();
    if (res.ok && json?.url) {
      window.location.href = json.url;
    } else {
      console.error('[billing] portal response invalid', json);
      alert(json?.error || 'Unable to open billing portal.');
    }
  } catch (e) {
    console.error('[billing] failed opening portal', e);
    alert(e?.message || 'Network error opening billing portal');
  }
}
