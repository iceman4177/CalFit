// src/ProSuccess.jsx
import React, { useEffect } from "react";
import { useHistory } from "react-router-dom";

export default function ProSuccess() {
  const history = useHistory();

  useEffect(() => {
    // ✅ Mark user as Pro
    localStorage.setItem("isPro", "true");

    // ✅ Set 7-day trial expiry (if not already set)
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
      <p>Your 7-day free trial has started. Unlimited AI features are now unlocked.</p>
      <p>Redirecting back to the app…</p>
    </div>
  );
}
