// src/components/Header.jsx
import React, { useEffect, useMemo, useState } from 'react';
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
    // legacy: some older builds set trialStart; keep for backward compatibility
    if (localStorage.getItem('trialStart')) return true;
  } catch {}
  return false;
}

export default function Header({ logoSrc = '/slimcal-logo.svg', showBeta = false }) {
  // Preserve existing pro logic
  const { isProActive, entitlements, features } = useEntitlements();
  const location = useLocation();

  // Derive ambassador flag without disturbing old behavior
  const hasAmbassador =
    !!(entitlements && typeof entitlements.has === 'function' && entitlements.has('ambassador_badge')) ||
    !!(Array.isArray(features) && features.includes('ambassador_badge'));

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

  // --- Trial eligibility (server truth) ---
  const [trialEligible, setTrialEligible] = useState(true);
  const [trialEligLoading, setTrialEligLoading] = useState(false);

  useEffect(() => {
    let abort = false;

    const run = async () => {
      if (!authUser?.id) {
        if (!abort) {
          setTrialEligible(true);
          setTrialEligLoading(false);
        }
        return;
      }
      if (!abort) setTrialEligLoading(true);

      try {
        const res = await fetch(
          `/api/me/pro-status?user_id=${encodeURIComponent(authUser.id)}`,
          { credentials: 'same-origin', cache: 'no-store' }
        );
        const json = await res.json().catch(() => ({}));
        if (abort) return;

        // If pro is active, eligibility doesn't matter; but keep it consistent
        const eligible = Boolean(json?.trial_eligible);
        setTrialEligible(eligible);
      } catch {
        // fail-open: allow trial button if we can't verify
        if (!abort) setTrialEligible(true);
      } finally {
        if (!abort) setTrialEligLoading(false);
      }
    };

    run();
    return () => {
      abort = true;
    };
  }, [authUser?.id]);

  const openSignIn = () => {
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  const ctaLabel = useMemo(() => {
    if (pro) return 'Manage Billing';
    if (trialEligLoading) return 'Checking…';
    return trialEligible ? 'Try Pro Free' : 'Upgrade to Pro';
  }, [pro, trialEligible, trialEligLoading]);

  const handlePrimaryCta = async () => {
    if (pro) {
      // Manage billing
      if (!authUser) {
        openSignIn();
        return;
      }
      await openBillingPortal({
        return_url: `${window.location.origin}${location.pathname || '/'}`,
        user_id: authUser.id,
        email: authUser.email || null,
      });
      return;
    }

    // Not pro: open upgrade modal (trial or upgrade-only mode)
    try {
      localStorage.setItem('slimcal:upgradeMode', trialEligible ? 'trial' : 'upgrade');
    } catch {}

    if (!authUser) {
      // open the upgrade modal automatically after OAuth completes
      localStorage.setItem('slimcal:openUpgradeAfterLogin', '1');
      openSignIn();
      return;
    }

    window.dispatchEvent(new CustomEvent('slimcal:open-upgrade'));
  };

  const linkStyle = {
    textDecoration: 'none',
    color: '#2563eb',
    fontWeight: 700,
    padding: '6px 10px',
    borderRadius: 10,
  };
  const activeStyle = { ...linkStyle, background: 'rgba(37, 99, 235, 0.08)' };

  // ✅ Make "Try Pro Free" GREEN (and keep "Manage Billing" as outlined blue)
  const ctaColor = useMemo(() => {
    if (pro) return 'primary';
    if (!trialEligible) return 'primary'; // upgrade-only mode should feel "trust/structure"
    return 'success'; // try-pro CTA should be green
  }, [pro, trialEligible]);

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

          {showBeta && (
            <Chip
              label="BETA"
              size="small"
              sx={{
                ml: 1,
                fontWeight: 800,
                height: 22,
                '& .MuiChip-label': { px: 1 },
              }}
            />
          )}

          {/* Ambassador badge */}
          {hasAmbassador && (
            <Tooltip title="Slimcal Ambassador">
              <Chip
                label="Ambassador"
                size="small"
                color="warning"
                sx={{
                  ml: 1,
                  fontWeight: 700,
                  height: 22,
                  '& .MuiChip-label': { px: 1 },
                }}
              />
            </Tooltip>
          )}
        </Box>

        {/* Primary nav */}
        <Box sx={{ flex: 1, display: { xs: 'none', sm: 'flex' }, justifyContent: 'center' }}>
          <Stack direction="row" spacing={0.5} alignItems="center">
            {/* ✅ Daily Eval is now the hero home */}
            <NavLink to="/" exact style={linkStyle} activeStyle={activeStyle}>
              Evaluate
            </NavLink>

            {/* ✅ Coach removed from top-centered nav (moved to More menu in App.jsx) */}

            <NavLink to="/meals" style={linkStyle} activeStyle={activeStyle}>
              Meals
            </NavLink>
            <NavLink to="/workout" style={linkStyle} activeStyle={activeStyle}>
              Workout
            </NavLink>
            <NavLink to="/history" style={linkStyle} activeStyle={activeStyle}>
              History
            </NavLink>
            <NavLink to="/dashboard" style={linkStyle} activeStyle={activeStyle}>
              Dashboard
            </NavLink>
          </Stack>
        </Box>

        {/* Plan action + quick sign-in */}
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant={pro ? 'outlined' : 'contained'}
            color={ctaColor}
            onClick={handlePrimaryCta}
            disabled={!pro && trialEligLoading}
            sx={{ borderRadius: 10, textTransform: 'none', fontWeight: 800 }}
          >
            {ctaLabel}
          </Button>

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
