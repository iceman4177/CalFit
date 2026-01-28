import React, { useState } from 'react';
import { Button, CircularProgress } from '@mui/material';
import { useAuth } from '../context/AuthProvider.jsx';
import { openBillingPortal } from '../lib/billing';

function isProActive() {
  try {
    if (localStorage.getItem('isPro') === 'true') return true;
    if (localStorage.getItem('trialStart')) return true; // trial counts as Pro for UI
  } catch {}
  return false;
}

export default function ManageBillingButton({ variant = 'text', size = 'medium' }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const pro = isProActive();

  const openUpgrade = () => {
    window.dispatchEvent(new CustomEvent('slimcal:open-upgrade'));
  };

  const openPortal = async () => {
    if (!user?.id) {
      window.dispatchEvent(new CustomEvent('slimcal:open-signin'));
      return;
    }
    setLoading(true);
    try {
      await openBillingPortal();
    } finally {
      setLoading(false);
    }
  };

  if (pro) {
    return (
      <Button onClick={openPortal} variant={variant} size={size} disabled={loading}>
        {loading ? <CircularProgress size={18} /> : 'Manage Billing'}
      </Button>
    );
  }

  return (
    
      <span>
        <Button onClick={openUpgrade} variant={variant} size={size}>
          Upgrade
        </Button>
      </span>
    
  );
}
