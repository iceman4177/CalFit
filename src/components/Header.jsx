// src/components/Header.jsx
import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  AppBar,
  Toolbar,
  Box,
  Button,
  IconButton,
  Typography,
  Stack,
  Tooltip,
  Chip,
} from '@mui/material';
import { useEntitlements } from '../context/EntitlementsContext.jsx';
import { supabase } from '../lib/supabaseClient';
import { openBillingPortal } from '../lib/billing';

function isProLocal() {
  try {
    if (localStorage.getItem('isPro') === 'true') return true;
    if (localStorage.getItem('trialStart')) return true;
  } catch {}
  return false;
}

export default function Header({ logoSrc = '/slimcal-logo.svg' }) {
  const { isProActive } = useEntitlements();
  const location = useLocation();

  // auth state (so we can decide whether to open OAuth first)
  const [authUser, setAuthUser] = useState(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (mounted) setAuthUser(data?.user ?? null);
      } catch {
        if (mounted) setAuthUser(null);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setAuthUser(session?.user ?? null);
    });
    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  const pro = isProActive || isProLocal();

  const openSignIn = () => {
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  const handleTryPro = () => {
    if (!authUser) {
      // open the upgrade modal automatically after OAuth completes
      localStorage.setItem('slimcal:openUpgradeAfterLogin', '1');
      openSignIn();
      return;
    }
    window.dispatchEvent(new CustomEvent('slimcal:open-upgrade'));
  };

  const handleManageBilling = async () => {
    // If user isn't signed in, sign in first
    if (!authUser) {
      openSignIn();
      return;
    }
    // If somehow not pro, fall back to upgrade
    if (!pro) {
      window.dispatchEvent(new CustomEvent('slimcal:open-upgrade'));
      return;
    }
    // Open Stripe Billing Portal with a nice return path
    await openBillingPortal({
      return_url: `${window.location.origin}${location.pathname || '/'}`,
      user_id: authUser.id,
      email: authUser.email || null,
    });
  };

  const linkStyle = {
    textDecoration: 'none',
    color: '#2563eb',
    fontWeight: 700,
    padding: '6px 10px',
    borderRadius: 10,
  };
  const activeStyle = { ...linkStyle, background: 'rgba(37, 99, 235, 0.08)' };

  return (
    <AppBar
      position="sticky"
      elevation={0}
      color="transparent"
      sx={{
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
      }}
    >
      <Toolbar sx={{ maxWidth: 1200, width: '100%', mx: 'auto' }}>
        {/* Brand */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mr: 2 }}>
          <a
            href="/"
            style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}
          >
            <img
              src={logoSrc}
              alt="Slimcal.ai"
              style={{ height: 28, width: 'auto' }}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            <Typography variant="h6" sx={{ fontWeight: 900, color: '#0f172a' }}>
              Slimcal.ai
            </Typography>
          </a>
        </Box>

        {/* Primary nav */}
        <Box sx={{ flex: 1, display: { xs: 'none', sm: 'flex' }, justifyContent: 'center' }}>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <NavLink
              to="/dashboard"
              exact
              style={linkStyle}
              activeStyle={activeStyle}
              isActive={(match, loc) => loc.pathname === '/' || Boolean(match)}
            >
              Dashboard
            </NavLink>
            <NavLink to="/meals"   style={linkStyle} activeStyle={activeStyle}>Meals</NavLink>
            <NavLink to="/workout" style={linkStyle} activeStyle={activeStyle}>Workout</NavLink>

            {/* Recap with AI chip */}
            <NavLink to="/recap" style={linkStyle} activeStyle={activeStyle}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                Recap
                <Tooltip title="AI Daily Recap">
                  <Chip
                    label="AI"
                    size="small"
                    color="primary"
                    sx={{ height: 18, borderRadius: '8px', fontWeight: 800, ml: 0.5 }}
                  />
                </Tooltip>
              </span>
            </NavLink>

            <NavLink to="/history" style={linkStyle} activeStyle={activeStyle}>History</NavLink>
          </Stack>
        </Box>

        {/* Plan action + quick sign-in */}
        <Stack direction="row" spacing={1} alignItems="center">
          {pro ? (
            <Button
              variant="outlined"
              onClick={handleManageBilling}
              sx={{ borderRadius: 10, textTransform: 'none', fontWeight: 700 }}
            >
              Manage Billing
            </Button>
          ) : (
            <Button
              variant="contained"
              color="error"
              onClick={handleTryPro}
              sx={{ borderRadius: 10, textTransform: 'none', fontWeight: 800 }}
            >
              Try Pro Free
            </Button>
          )}

          {/* Only show sign-in icon if logged out */}
          {!authUser && (
            <Tooltip title="Sign in with Google">
              <IconButton onClick={openSignIn} size="small" sx={{ ml: 0.5 }}>
                <img
                  src="https://www.svgrepo.com/show/475656/google-color.svg"
                  alt="Sign in"
                  width={20}
                  height={20}
                  style={{ display: 'block' }}
                />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      </Toolbar>
    </AppBar>
  );
}
