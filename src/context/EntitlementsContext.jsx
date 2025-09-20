// src/context/EntitlementsContext.jsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

const EntCtx = createContext(null);

export function EntitlementsProvider({ children }) {
  const [email, setEmailState] = useState(() => localStorage.getItem("sc_email") || "");
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

  // Refresh entitlements whenever email changes (and on mount)
  useEffect(() => {
    let alive = true;
    async function run() {
      if (!email) {
        if (alive) setState((s) => ({ ...s, isProActive: false, status: "none" }));
        return;
      }
      try {
        if (alive) setState((s) => ({ ...s, loading: true }));
        const res = await fetch(`/api/entitlements?email=${encodeURIComponent(email)}`);
        const data = await res.json();
        if (!alive) return;
        const isProActive = !!(data && (data.isPro || data.status === "active" || data.status === "trialing" || data.status === "past_due"));
        setState({
          loading: false,
          isProActive,
          status: data?.status || "none",
          trialEnd: data?.trialEnd || null,
          currentPeriodEnd: data?.currentPeriodEnd || null,
          cancelAtPeriodEnd: !!data?.cancelAtPeriodEnd,
          customerId: data?.customerId || null,
          priceId: data?.priceId || null,
        });
      } catch (err) {
        console.error("[Entitlements] fetch failed", err);
        if (alive) setState((s) => ({ ...s, loading: false }));
      }
    }
    run();
    return () => { alive = false; };
  }, [email]);

  const value = useMemo(() => ({
    email,
    setEmail,
    ...state,
    refreshEntitlements: async () => {
      if (!email) return;
      const res = await fetch(`/api/entitlements?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      const isProActive = !!(data && (data.isPro || data.status === "active" || data.status === "trialing" || data.status === "past_due"));
      setState((s) => ({
        ...s,
        isProActive,
        status: data?.status || "none",
        trialEnd: data?.trialEnd || null,
        currentPeriodEnd: data?.currentPeriodEnd || null,
        cancelAtPeriodEnd: !!data?.cancelAtPeriodEnd,
        customerId: data?.customerId || null,
        priceId: data?.priceId || null,
      }));
    }
  }), [email, state]);

  return <EntCtx.Provider value={value}>{children}</EntCtx.Provider>;
}

export function useEntitlements() {
  const ctx = useContext(EntCtx);
  if (!ctx) throw new Error("useEntitlements must be used within <EntitlementsProvider>");
  return ctx;
}
