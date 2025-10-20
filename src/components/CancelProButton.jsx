// src/components/CancelProButton.jsx
import React, { useState } from "react";
import { useAuth } from "../context/AuthProvider.jsx";

export default function CancelProButton({ subscriptionId }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  async function handleCancel() {
    if (!subscriptionId || !user?.id) {
      setMsg("No subscription found.");
      return;
    }
    if (!confirm("Cancel your Pro plan? You’ll keep access until your trial/billing ends.")) return;

    setLoading(true);
    try {
      const res = await fetch("/api/cancel-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription_id: subscriptionId, user_id: user.id }),
      });
      const data = await res.json();
      if (data.ok) {
        setMsg("Subscription canceled. You’ll keep Pro until your trial/billing ends.");
      } else {
        throw new Error(data.error || "Unknown error");
      }
    } catch (e) {
      console.error(e);
      setMsg("Error canceling subscription.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleCancel}
        disabled={loading}
        className="px-4 py-2 rounded-lg border border-red-500 text-red-600 hover:bg-red-50 disabled:opacity-60"
      >
        {loading ? "Canceling…" : "Cancel Pro Plan"}
      </button>
      {msg ? <span className="text-sm text-gray-600">{msg}</span> : null}
    </div>
  );
}
