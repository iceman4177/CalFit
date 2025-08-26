// src/ProSuccess.jsx
import React, { useEffect } from "react";
import { useHistory } from "react-router-dom";

export default function ProSuccess() {
  const history = useHistory();

  useEffect(() => {
    // ✅ Optimistically mark user as Pro in localStorage
    localStorage.setItem("isPro", "true");

    // ❌ Do NOT reset trialEndTs here anymore — Stripe handles the real trial.
    // Only set it if you want an optimistic backup in case redirect failed.
    if (!localStorage.getItem("trialEndTs")) {
      const trialEnd = Date.now() + 7 * 24 * 60 * 60 * 1000;
      localStorage.setItem("trialEndTs", String(trialEnd));
    }

    // redirect home after 2s
    const timer = setTimeout(() => {
      history.push("/");
    }, 2000);

    return () => clearTimeout(timer);
  }, [history]);

  return (
    <div style={{ textAlign: "center", marginTop: "3rem" }}>
      <h2>🎉 Welcome to Slimcal Pro!</h2>
      <p>Your Pro subscription is active. Unlimited AI features are now unlocked.</p>
      <p>Redirecting back to the app…</p>
    </div>
  );
}
