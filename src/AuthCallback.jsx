import { useEffect } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";

/**
 * Dedicated OAuth return handler.
 * Google -> Supabase -> your app lands here with ?code=... (or hash tokens).
 * We exchange the code for a session *before* anything else in the app can redirect,
 * then clean the URL and send the user back to "/".
 */
export default function AuthCallback() {
  const history = useHistory();
  const location = useLocation();

  useEffect(() => {
    (async () => {
      try {
        const qs = new URLSearchParams(location.search);
        const hasCode = qs.get("code");
        const hasHashTokens = /access_token=|refresh_token=/.test(
          window.location.hash || ""
        );

        if (hasCode) {
          await supabase.auth.exchangeCodeForSession(window.location.href);
        } else if (hasHashTokens) {
          // detectSessionInUrl:true handles hash; small settle time
          await new Promise((r) => setTimeout(r, 100));
        }
      } catch (err) {
        // Optional: toast/log
        console.error("[AuthCallback] exchange failed:", err);
      } finally {
        // Clean URL and move back into the app
        history.replace("/");
      }
    })();
  }, [history, location.search]);

  return null; // no UI
}
