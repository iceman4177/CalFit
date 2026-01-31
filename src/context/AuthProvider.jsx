// src/context/AuthProvider.jsx
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import useBootstrapSync from '../hooks/useBootstrapSync';

const DEFAULT_AUTH = {
  session: null,
  user: null,
  loading: true,
  signInWithGoogle: () => supabase.auth.signInWithOAuth({ provider: 'google' }),
  signOut: () => supabase.auth.signOut(),
};

const AuthCtx = createContext(DEFAULT_AUTH);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);
  const prevUserIdRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session || null);
      setUser(data.session?.user || null);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user || null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // 🔹 Reset local Pro/trial flags when the authenticated account changes
  useEffect(() => {
    const currentId = user?.id || null;
    const prevId = prevUserIdRef.current;

    if (prevId && currentId && prevId !== currentId) {
      try {
        // Pro flags written by ProSuccess.jsx (and older builds)
        localStorage.removeItem('isPro');
        const ud = JSON.parse(localStorage.getItem('userData') || '{}');
        if (ud?.isPremium) {
          delete ud.isPremium;
          localStorage.setItem('userData', JSON.stringify(ud));
        }

        // Optional: clear any account-scoped gating/trial flags that could hide CTAs
        // Uncomment if you use these keys elsewhere:
        // localStorage.removeItem('trialStart');
        // localStorage.removeItem('ambassadorPrompted');

        // NOTE: do NOT clear offline sync maps; they are already keyed by userId in your code.
      } catch {
        /* ignore */
      }
    }

    prevUserIdRef.current = currentId;
  }, [user?.id]);

  // 🔹 One-time bootstrap + quiet queue flush on sign-in
  useBootstrapSync(user);

  const value = useMemo(() => ({
    session, user, loading,
    signInWithGoogle: () => supabase.auth.signInWithOAuth({ provider: 'google' }),
    signOut: () => supabase.auth.signOut(),
  }), [session, user, loading]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx) || DEFAULT_AUTH;
