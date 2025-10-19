// src/AuthCallback.jsx
import React, { useEffect, useState } from 'react';
import { Typography, Box, CircularProgress } from '@mui/material';
import { useHistory, useLocation } from 'react-router-dom';
import { supabase } from './lib/supabaseClient';

export default function AuthCallback() {
  const history = useHistory();
  const location = useLocation();
  const [msg, setMsg] = useState('Completing sign-in…');

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const fullUrl = window.location.href;
        const hasCode = /[?&]code=/.test(fullUrl);
        const hasHashTokens = /#access_token=/.test(fullUrl);

        console.log('[AuthCallback] url', { fullUrl, hasCode, hasHashTokens });
        setMsg('Checking session…');

        // If a session is already available, skip exchanging.
        const { data: s1 } = await supabase.auth.getSession();
        const existingSession = s1?.session || null;
        if (existingSession?.user) {
          console.log('[AuthCallback] session already present; skipping exchange');
          setMsg('Signed in. Redirecting…');
          if (mounted) history.replace('/');
          return;
        }

        // Only try exchange if we actually have a `code` and no session yet
        if (hasCode && !existingSession) {
          console.log('[AuthCallback] calling exchangeCodeForSession');
          setMsg('Exchanging code…');

          const { data, error } = await supabase.auth.exchangeCodeForSession(window.location.href);
          if (error) {
            // Non-fatal if we can confirm a session right after (cookies might already be set)
            console.warn('[AuthCallback] exchange error', error);
            setMsg('Verifying session…');
          } else {
            console.log('[AuthCallback] exchange ok?', Boolean(data?.session));
          }
        }

        // Final check – if session exists, proceed; else surface a clean message.
        const { data: s2, error: e2 } = await supabase.auth.getSession();
        const finalSession = s2?.session || null;

        console.log('[AuthCallback] session?', Boolean(finalSession), 'user?', finalSession?.user?.email);
        if (finalSession?.user) {
          setMsg('Signed in. Redirecting…');
          if (mounted) history.replace('/');
        } else {
          console.error('[AuthCallback] No session after callback', e2);
          setMsg('Sign-in could not be completed. Please try again.');
        }
      } catch (err) {
        console.error('[AuthCallback] fatal', err);
        setMsg('Something went wrong during sign-in. Please try again.');
      }
    })();

    return () => { mounted = false; };
  }, [history, location.search]);

  return (
    <Box sx={{ py: 8, textAlign: 'center' }}>
      <CircularProgress />
      <Typography variant="h6" sx={{ mt: 2 }}>{msg}</Typography>
    </Box>
  );
}
