// src/lib/billing.js
import { supabase } from './supabaseClient';

/**
 * Opens Stripe Billing Portal for the current signed-in user.
 * - Calls POST /api/portal with { user_id, email, return_url }
 * - Redirects to Stripe if a portal URL is returned.
 * - If the server returns 404 "no_customer", we open the Upgrade modal.
 * - If the user isn't signed in, we trigger your sign-in flow.
 */
export async function openBillingPortal() {
  try {
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if (!user?.id) {
      console.warn('[billing] no user, opening sign-in');
      window.dispatchEvent(new CustomEvent('slimcal:open-signin'));
      return;
    }

    const payload = {
      user_id: user.id,
      email: user.email || null,
      return_url: window.location.href,
    };

    const res = await fetch('/api/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // If no Stripe customer is mapped yet, nudge to Upgrade flow
    if (res.status === 404) {
      console.info('[billing] no stripe customer yet -> open Upgrade');
      window.dispatchEvent(new CustomEvent('slimcal:open-upgrade'));
      return;
    }

    const json = await res.json().catch(() => ({}));

    if (res.ok && json?.url) {
      window.location.href = json.url;
      return;
    }

    // Other non-OK outcomes — show an error, do NOT silently open Upgrade
    const msg = json?.error || `Portal error (${res.status})`;
    console.error('[billing] invalid portal response:', msg, json);
    alert(msg);
  } catch (e) {
    console.error('[billing] failed opening portal', e);
    alert(e?.message || 'Network error opening billing portal');
  }
}
