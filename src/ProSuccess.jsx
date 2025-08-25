
import React, { useEffect } from "react";
import { useRouter } from "next/router";

export default function ProSuccess() {
  const router = useRouter();

  useEffect(() => {
    // ✅ Mark user as Pro
    localStorage.setItem("isPro", "true");

    // ✅ Set 7-day trial expiry (only if not already set)
    if (!localStorage.getItem("trialEndTs")) {
      const trialEnd = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days in ms
      localStorage.setItem("trialEndTs", String(trialEnd));
    }

    // redirect back to app homepage after short delay
    const timer = setTimeout(() => {
      router.push("/");
    }, 2000);

    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div style={{ textAlign: "center", marginTop: "3rem" }}>
      <h2>🎉 Welcome to Slimcal Pro!</h2>
      <p>Your 7-day free trial has started. Unlimited AI features are unlocked.</p>
      <p>Redirecting back to the app…</p>
    </div>
  );
}
