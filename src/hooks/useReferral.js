// src/hooks/useReferral.js
import { useEffect } from 'react';

export default function useReferral() {
  useEffect(() => {
    // 1) Ensure each user has a unique referral code
    let code = localStorage.getItem('referralCode');
    if (!code) {
      // Use the built‑in crypto API instead of uuid library
      const uuidFragment = crypto.randomUUID().split('-')[0].toUpperCase();
      code = `SLIMCAL-${uuidFragment}`;
      localStorage.setItem('referralCode', code);
    }

    // 2) Capture incoming ?ref= parameter
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) {
      // Prevent duplicate attribution in the same day
      const todayKey = new Date().toLocaleDateString('en-US');
      const flagKey  = `ref_${ref}_${todayKey}`;
      if (!localStorage.getItem(flagKey)) {
        const counts = JSON.parse(localStorage.getItem('referralCounts') || '{}');
        counts[ref] = (counts[ref] || 0) + 1;
        localStorage.setItem('referralCounts', JSON.stringify(counts));
        localStorage.setItem(flagKey, '1');
      }
    }
  }, []);
}
