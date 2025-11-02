// src/context/EntitlementsContext.jsx
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
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

function toSet(list) {
  if (!list) return new Set();
  if (list instanceof Set) return list;
  if (Array.isArray(list)) return new Set(list);
  return new Set(Object.keys(list));
}

export function EntitlementsProvider({ children }) {
  const [email, setEmailState] = useState(
    () => localStorage.getItem("sc_email") || ""
  );
  const [userId, setUserId] = useState(
    () => localStorage.getItem("sc_user_id") || ""
  );

  const [state, setState] = useState({
    loading: false,
    // Pro / subscription-esque fields
    isProActive: false,
    status: "none",
    trialEnd: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: null,
    customerId: null,
    priceId: null,
    // Feature entitlements (e.g., 'ambassador_badge', 'pro', etc.)
    features: [],
    entitlements: new Set(),
    // source markers (debug)
    _proSource: "none",
    _featSource: "none",
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
      const newId = u?.id || "";

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
      const newId = u?.id || "";

      if (newEmail && newEmail !== email) {
        localStorage.setItem("sc_email", newEmail);
        setEmailState(newEmail);
      }
      if (newId && newId !== userId) {
        localStorage.setItem("sc_user_id", newId);
        setUserId(newId);
      }
      // Pro status / entitlements may have changed on login/logout
      window.dispatchEvent(new Event("slimcal:pro:refresh"));
    });

    return () => {
      mounted = false;
      sub?.data?.subscription?.unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Core fetchers ------------------------------------------------------

  // (A) Server-truth PRO/subscription status by user_id, fallback to email
  async function fetchProStatus({ uid, mail }) {
    // 1) Server truth by user_id
    if (uid) {
      try {
        const r = await fetch(
          `/api/me/pro-status?user_id=${encodeURIComponent(uid)}`,
          { credentials: "same-origin" }
        );
        const j = await r.json().catch(() => ({}));
        if (
          j &&
          (j.isPro !== undefined || j.isProActive !== undefined || j.status)
        ) {
          const isProActive = toBoolStatus(j);
          return {
            isProActive,
            status: j.status || (isProActive ? "active" : "none"),
            trialEnd: j.trial_end || j.trialEnd || null,
            currentPeriodEnd: j.current_period_end || j.currentPeriodEnd || null,
            cancelAtPeriodEnd: !!(
              j.cancel_at_period_end ?? j.cancelAtPeriodEnd
            ),
            customerId: j.customer_id || j.customerId || null,
            priceId: j.price_id || j.priceId || null,
            _proSource: j.source || "pro-status",
          };
        }
      } catch (e) {
        // fall through to email route
        console.warn(
          "[Entitlements] /api/me/pro-status failed; falling back to email.",
          e?.message
        );
      }
    }

    // 2) Fallback by email (legacy/admin view)
    if (mail) {
      try {
        const r = await fetch(
          `/api/entitlements?email=${encodeURIComponent(mail)}`,
          { credentials: "same-origin" }
        );
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
          _proSource: "entitlements",
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
      _proSource: "none",
    };
  }

  // (B) Feature entitlements (badge, pro, etc.) — via unified view API
  async function fetchFeatureEntitlements({ uid }) {
    if (!uid) {
      return { features: [], entitlements: new Set(), _featSource: "none" };
    }
    try {
      const r = await fetch(`/api/me/entitlements?user_id=${uid}`, {
        credentials: "same-origin",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        return { features: [], entitlements: new Set(), _featSource: "error" };
      }
      const features = Array.isArray(j.features) ? j.features : [];
      return {
        features,
        entitlements: toSet(features),
        _featSource: "v_user_entitlements",
      };
    } catch (e) {
      console.warn("[Entitlements] /api/me/entitlements failed", e?.message);
      return { features: [], entitlements: new Set(), _featSource: "error" };
    }
  }

  // --- Auto-refresh when userId/email changes; listen for manual refresh
  useEffect(() => {
    let alive = true;

    async function run() {
      if (alive) setState((s) => ({ ...s, loading: true }));

      // fetch in parallel
      const [pro, feats] = await Promise.all([
        fetchProStatus({ uid: userId, mail: email }),
        fetchFeatureEntitlements({ uid: userId }),
      ]);

      if (!alive) return;

      // local echo for instant UI across tabs
      try {
        localStorage.setItem("isPro", pro.isProActive ? "true" : "false");
      } catch {}

      setState({
        loading: false,
        // pro-ish
        isProActive: !!pro.isProActive,
        status: pro.status || "none",
        trialEnd: pro.trialEnd || null,
        currentPeriodEnd: pro.currentPeriodEnd || null,
        cancelAtPeriodEnd: !!pro.cancelAtPeriodEnd,
        customerId: pro.customerId || null,
        priceId: pro.priceId || null,
        // features
        features: feats.features || [],
        entitlements: feats.entitlements || new Set(),
        _proSource: pro._proSource,
        _featSource: feats._featSource,
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

  const value = useMemo(() => {
    const isEntitled = toBoolStatus({
      isProActive: state.isProActive,
      status: state.status,
    });
    return {
      // identity
      email,
      userId,
      setEmail,
      // pro/subscription
      loading: state.loading,
      isProActive: state.isProActive,
      status: state.status,
      trialEnd: state.trialEnd,
      currentPeriodEnd: state.currentPeriodEnd,
      cancelAtPeriodEnd: state.cancelAtPeriodEnd,
      customerId: state.customerId,
      priceId: state.priceId,
      // features
      features: state.features,
      entitlements: state.entitlements, // <- Set of strings (e.g., 'ambassador_badge', 'pro')
      // convenience
      isEntitled, // boolean for components
      // debug/meta
      _proSource: state._proSource,
      _featSource: state._featSource,
      // manual refresh helper
      refreshEntitlements: async () => {
        const [pro, feats] = await Promise.all([
          fetchProStatus({ uid: userId, mail: email }),
          fetchFeatureEntitlements({ uid: userId }),
        ]);
        try {
          localStorage.setItem("isPro", pro.isProActive ? "true" : "false");
        } catch {}
        setState((s) => ({
          ...s,
          isProActive: !!pro.isProActive,
          status: pro.status || "none",
          trialEnd: pro.trialEnd || null,
          currentPeriodEnd: pro.currentPeriodEnd || null,
          cancelAtPeriodEnd: !!pro.cancelAtPeriodEnd,
          customerId: pro.customerId || null,
          priceId: pro.priceId || null,
          features: feats.features || [],
          entitlements: feats.entitlements || new Set(),
          _proSource: pro._proSource,
          _featSource: feats._featSource,
        }));
      },
    };
  }, [email, userId, state]);

  return <EntCtx.Provider value={value}>{children}</EntCtx.Provider>;
}

export function useEntitlements() {
  const ctx = useContext(EntCtx);
  if (!ctx) throw new Error("useEntitlements must be used within <EntitlementsProvider>");
  return ctx;
}
