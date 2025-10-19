// src/AuthCallback.jsx
import React, { useEffect } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";

export default function AuthCallback() {
  const history = useHistory();
  const location = useLocation();

  useEffect(() => {
    (async () => {
      try {
        const url = window.location.href;
        const qs = new URLSearchParams(location.search);
        const hasCode = !!qs.get("code");
        const hasHashTokens = /access_token=|refresh_token=/.test(window.location.hash || "");

        // 1) If we have ?code=... do the PKCE exchange explicitly
        if (hasCode) {
          console.log("[AuthCallback] exchanging code...");
          await supabase.auth.exchangeCodeForSession(url);
        } else if (hasHashTokens) {
          // hash flow: detectSessionInUrl will handle; tiny settle
          await new Promise(r => setTimeout(r, 150));
        }

        // 2) Verify the session actually exists before redirecting
        const { data: sess } = await supabase.auth.getSession();
        console.log("[AuthCallback] session after exchange:", !!sess?.session, sess?.session?.user?.email);

        if (!sess?.session) {
          throw new Error("No session after exchange. Check env keys and redirect URLs.");
        }

        // 3) Clean URL and go home
        history.replace("/");
      } catch (err) {
        console.error("[AuthCallback] exchange failed:", err);
        // Stay on this page so you can see the console error;
        // do NOT redirect so we don't lose the error signal.
      }
    })();
  }, [history, location.search]);

  return null;
}
