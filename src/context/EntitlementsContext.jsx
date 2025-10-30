// src/context/EntitlementsContext.jsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const EntCtx = createContext(null);

// Statuses that should count as "active" features on
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

function toBoolStatus(data) {
  // Accept either shape: { isProActive } OR { isPro } OR stripe-like { status }
  const flag = data?.isProActive ?? data?.isPro ?? false;
  const status = (data?.status || "").toLowerCase();
  return !!(flag || (status && ACTIVE_STATUSES.has(status)));
}

export function EntitlementsProvider({ children }) {
  const [email, setEmailState] = useState(() => localStorage.getItem("sc_email") || "");
  const [userId, setUserId]   = useState(() => localStorage.getItem("sc_user_id") || "");

  const [state, setState] = useState({
    loading: false,
    isProActive: false,
    status: "none",
    trialEnd: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: null,
    customerId: null,
    priceId: null,
  });

  const setEmail = (e) => {
    const v = (e || "").trim().toLowerCase();
    localStorage.setItem("sc_email", v);
    setEmailState(v);
  };

  // --- Track Supabase auth; keep localStorage mirrors for resilience
  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getUser();
      const u = data?.user ?? null;
      if (!mounted) return;

      const newEmail = (u?.email || "").toLowerCase();
      const newId    = u?.id || "";

      if (newEmail && newEmail !== email) {
        localStorage.setItem("sc_email", newEmail);
        setEmailState(newEmail);
      }
      if (newId && newId !== userId) {
        localStorage.setItem("sc_user_id", newId);
        setUserId(newId);
      }
    })();

    const sub = supabase.auth.onAuthStateChange((_evt, session) => {
      if (!mounted) return;
      const u = session?.user ?? null;

      const newEmail = (u?.email || "").toLowerCase();
      const newId    = u?.id || "";

      if (newEmail && newEmail !== email) {
        localStorage.setItem("sc_email", newEmail);
        setEmailState(newEmail);
      }
      if (newId && newId !== userId) {
        localStorage.setItem("sc_user_id", newId);
        setUserId(newId);
      }
      // Pro status may have changed on login/logout
      window.dispatchEvent(new Event("slimcal:pro:refresh"));
    });

    return () => {
      mounted = false;
      sub?.data?.subscription?.unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Core fetcher: prefer /api/me/pro-status (user_id), fallback to /api/entitlements (email)
  async function fetchEntitlements({ uid, mail }) {
    // 1) Server truth by user_id
    if (uid) {
      try {
        const r = await fetch(`/api/me/pro-status?user_id=${encodeURIComponent(uid)}`, { credentials: "same-origin" });
        const j = await r.json().catch(() => ({}));
        if (j && (j.isPro !== undefined || j.isProActive !== undefined || j.status)) {
          const isProActive = toBoolStatus(j);
          return {
            isProActive,
            status: j.status || (isProActive ? "active" : "none"),
            trialEnd: j.trial_end || j.trialEnd || null,
            currentPeriodEnd: j.current_period_end || j.currentPeriodEnd || null,
            cancelAtPeriodEnd: !!(j.cancel_at_period_end ?? j.cancelAtPeriodEnd),
            customerId: j.customer_id || j.customerId || null,
            priceId: j.price_id || j.priceId || null,
            source: j.source || "pro-status",
          };
        }
      } catch (e) {
        // fall through to email route
        console.warn("[Entitlements] /api/me/pro-status failed; falling back to email.", e?.message);
      }
    }

    // 2) Fallback by email (legacy/admin view)
    if (mail) {
      try {
        const r = await fetch(`/api/entitlements?email=${encodeURIComponent(mail)}`, { credentials: "same-origin" });
        const j = await r.json().catch(() => ({}));
        const isProActive = toBoolStatus(j);
        return {
          isProActive,
          status: j?.status || (isProActive ? "active" : "none"),
          trialEnd: j?.trialEnd || null,
          currentPeriodEnd: j?.currentPeriodEnd || null,
          cancelAtPeriodEnd: !!j?.cancelAtPeriodEnd,
          customerId: j?.customerId || null,
          priceId: j?.priceId || null,
          source: "entitlements",
        };
      } catch (e) {
        console.error("[Entitlements] /api/entitlements failed", e);
      }
    }

    // No data
    return {
      isProActive: false,
      status: "none",
      trialEnd: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: null,
      customerId: null,
      priceId: null,
      source: "none",
    };
  }

  // --- Auto-refresh when userId/email changes; also listen for manual refresh signals
  useEffect(() => {
    let alive = true;
    async function run() {
      if (alive) setState((s) => ({ ...s, loading: true }));
      const ent = await fetchEntitlements({ uid: userId, mail: email });
      if (!alive) return;

      // Keep a small local echo so UI can hide the CTA instantly across tabs
      try { localStorage.setItem("isPro", ent.isProActive ? "true" : "false"); } catch {}

      setState({
        loading: false,
        isProActive: !!ent.isProActive,
        status: ent.status || "none",
        trialEnd: ent.trialEnd || null,
        currentPeriodEnd: ent.currentPeriodEnd || null,
        cancelAtPeriodEnd: !!ent.cancelAtPeriodEnd,
        customerId: ent.customerId || null,
        priceId: ent.priceId || null,
      });
    }
    run();

    const onRefresh = () => run();
    window.addEventListener("slimcal:pro:refresh", onRefresh);
    return () => {
      alive = false;
      window.removeEventListener("slimcal:pro:refresh", onRefresh);
    };
  }, [userId, email]);

  const value = useMemo(() => ({
    email,
    userId,
    setEmail,
    ...state,
    refreshEntitlements: async () => {
      const ent = await fetchEntitlements({ uid: userId, mail: email });
      try { localStorage.setItem("isPro", ent.isProActive ? "true" : "false"); } catch {}
      setState((s) => ({
        ...s,
        isProActive: !!ent.isProActive,
        status: ent.status || "none",
        trialEnd: ent.trialEnd || null,
        currentPeriodEnd: ent.currentPeriodEnd || null,
        cancelAtPeriodEnd: !!ent.cancelAtPeriodEnd,
        customerId: ent.customerId || null,
        priceId: ent.priceId || null,
      }));
    }
  }), [email, userId, state]);

  return <EntCtx.Provider value={value}>{children}</EntCtx.Provider>;
}

export function useEntitlements() {
  const ctx = useContext(EntCtx);
  if (!ctx) throw new Error("useEntitlements must be used within <EntitlementsProvider>");
  return ctx;
}
