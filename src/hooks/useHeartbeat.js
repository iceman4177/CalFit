// /src/hooks/useHeartbeat.js
import { useEffect } from "react";
import { sendHeartbeat } from "../lib/heartbeat";
import { useAuth } from "../context/AuthProvider.jsx";

const HEARTBEAT_KEY = "slimcal:lastHeartbeatTs";
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

export default function useHeartbeat() {
  const { session } = useAuth(); // assumes your AuthProvider exposes { session }

  useEffect(() => {
    function shouldPing() {
      const last = Number(localStorage.getItem(HEARTBEAT_KEY) || 0);
      return Date.now() - last > TWELVE_HOURS_MS;
    }

    async function ping() {
      const s = session;
      if (!s?.user?.email) return;

      const id = s.user.id;
      const email = s.user.email;
      const provider = s.user.app_metadata?.provider || "unknown";
      const display_name = s.user.user_metadata?.full_name || s.user.user_metadata?.name || "";
      const last_client = "web:slimcal-ai";

      const res = await sendHeartbeat({ id, email, provider, display_name, last_client });
      if (res?.ok) localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
    }

    // initial ping on mount or session change
    if (session && shouldPing()) {
      ping();
    }

    // ping when tab becomes visible
    const onVis = () => {
      if (document.visibilityState === "visible" && session && shouldPing()) {
        ping();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [session]);
}
