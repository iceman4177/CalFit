// src/AuthCallback.jsx
import { useEffect } from "react";
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

        if (hasCode) {
          await supabase.auth.exchangeCodeForSession(url);
        } else if (hasHashTokens) {
          // detectSessionInUrl handles this; give it a tick
          await new Promise(r => setTimeout(r, 150));
        }

        // prove session exists before leaving the page
        const { data: sess } = await supabase.auth.getSession();
        if (!sess?.session) throw new Error("No session after exchange");
        history.replace("/");
      } catch (err) {
        console.error("[AuthCallback] exchange failed:", err);
        // stay here so you can read the error in console
      }
    })();
  }, [history, location.search]);

  return null;
}
