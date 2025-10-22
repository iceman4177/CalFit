// src/components/Header.jsx
import React from 'react';
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
  const pro = isProActive || isProLocal();
  const location = useLocation();

  const openSignIn = () => {
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  const openUpgrade = () => {
    window.dispatchEvent(new CustomEvent('slimcal:open-upgrade'));
  };

  const openPortal = async () => {
    await openBillingPortal();
  };

  const linkStyle = {
    textDecoration: 'none',
    color: '#2563eb',
    fontWeight: 700,
    padding: '6px 10px',
    borderRadius: 10,
  };

  const activeStyle = {
    ...linkStyle,
    background: 'rgba(37, 99, 235, 0.08)',
  };

  return (
    <AppBar
      position="sticky"
      elevation={0}
      color="transparent"
      sx={{ backdropFilter: 'blur(8px)', borderBottom: '1px solid rgba(0,0,0,0.06)' }}
    >
      <Toolbar sx={{ maxWidth: 1200, width: '100%', mx: 'auto' }}>
        {/* Left: Brand */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mr: 2 }}>
          <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
            <img
              src={logoSrc}
              alt="Slimcal.ai"
              style={{ height: 28, width: 'auto' }}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
            <Typography variant="h6" sx={{ fontWeight: 900, color: '#0f172a' }}>
              Slimcal.ai
            </Typography>
          </a>
        </Box>

        {/* Center: Nav */}
        <Box sx={{ flex: 1, display: { xs: 'none', sm: 'flex' }, justifyContent: 'center' }}>
          <Stack direction="row" spacing={0.5}>
            {/* Dashboard: treat "/" as active too */}
            <NavLink
              to="/dashboard"
              exact
              style={linkStyle}
              activeStyle={activeStyle}
              isActive={(match, loc) => loc.pathname === '/' || Boolean(match)}
            >
              Dashboard
            </NavLink>

            <NavLink to="/meals" style={linkStyle} activeStyle={activeStyle}>
              Meals
            </NavLink>
            <NavLink to="/workout" style={linkStyle} activeStyle={activeStyle}>
              Workout
            </NavLink>
            <NavLink to="/history" style={linkStyle} activeStyle={activeStyle}>
              History
            </NavLink>
          </Stack>
        </Box>

        {/* Right: Plan action + quick sign-in */}
        <Stack direction="row" spacing={1} alignItems="center">
          {pro ? (
            <Button
              variant="outlined"
              onClick={openPortal}
              sx={{ borderRadius: 10, textTransform: 'none', fontWeight: 700 }}
            >
              Manage Billing
            </Button>
          ) : (
            <Button
              variant="contained"
              color="error"
              onClick={openUpgrade}
              sx={{ borderRadius: 10, textTransform: 'none', fontWeight: 800 }}
            >
              Upgrade
            </Button>
          )}

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
        </Stack>
      </Toolbar>
    </AppBar>
  );
}
