import { useEffect } from "react";
import { useHistory, useLocation } from "react-router-dom";
import { supabase } from "./lib/supabaseClient";

export default function AuthCallback() {
  const history = useHistory();
  const location = useLocation();

  useEffect(() => {
    (async () => {
      try {
        const fullUrl = window.location.href;
        const qs = new URLSearchParams(location.search);
        const hasCode = !!qs.get("code");
        const hasHashTokens = /access_token=|refresh_token=/.test(window.location.hash || "");

        console.log("[AuthCallback] url", { fullUrl, hasCode, hasHashTokens });

        if (hasCode) {
          console.log("[AuthCallback] calling exchangeCodeForSession");
          await supabase.auth.exchangeCodeForSession(fullUrl);
        } else if (hasHashTokens) {
          console.log("[AuthCallback] hash tokens present, waiting 150ms");
          await new Promise(r => setTimeout(r, 150));
        } else {
          console.warn("[AuthCallback] no code/tokens in URL");
        }

        const { data: sess } = await supabase.auth.getSession();
        const { data: usr }  = await supabase.auth.getUser();
        console.log("[AuthCallback] session?", !!sess?.session, "user?", usr?.user?.email);

        if (!sess?.session) throw new Error("No session after exchange");

        history.replace("/");
      } catch (err) {
        console.error("[AuthCallback] FAILED:", err);
        // Stay here so we can read the console error.
      }
    })();
  }, [history, location.search]);

  return null;
}
