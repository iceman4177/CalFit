import React, { useState, useEffect } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Typography
} from "@mui/material";
import UpgradeModal from "./components/UpgradeModal";
import { useUserData } from "./UserDataContext";

export default function DailyRecapCoach() {
  const { isPremium } = useUserData();
  const [loading, setLoading]     = useState(false);
  const [recap, setRecap]         = useState("");
  const [error, setError]         = useState("");
  const [count, setCount]         = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

  const today = new Date().toLocaleDateString("en-US");
  const storageKey = `recapUsage`;

  // Load today’s count on mount
  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
    if (stored.date === today) setCount(stored.count);
    else                     setCount(0);
  }, [today]);

  // Persist new count
  const incrementCount = () => {
    const stored   = JSON.parse(localStorage.getItem(storageKey) || "{}");
    const newCount = stored.date === today ? stored.count + 1 : 1;
    localStorage.setItem(
      storageKey,
      JSON.stringify({ date: today, count: newCount })
    );
    setCount(newCount);
    return newCount;
  };

  const handleGetRecap = async () => {
    // Free users: max 3/day
    if (!isPremium && count >= 3) {
      setModalOpen(true);
      return;
    }
    if (!isPremium) incrementCount();

    setLoading(true);
    setError("");
    setRecap("");

    try {
      // 1) Today's workout history
      const history = JSON.parse(
        localStorage.getItem("workoutHistory") || "[]"
      );
      const todayWorkouts = history.filter(w => w.date === today);

      // 2) Build prompt
      let userContent;
      if (todayWorkouts.length === 0) {
        userContent =
          "I haven't logged any workout today. Can you suggest a full-body workout plan for me?";
      } else {
        const lines = todayWorkouts.flatMap(w =>
          w.exercises.map(ex =>
            `- ${ex.name}: ${ex.sets}×${ex.reps} (${ex.calories.toFixed(2)} cal)`
          )
        );
        userContent = `Here’s what I did today:\n${lines.join(
          "\n"
        )}\n\nPlease give me a friendly recap of my workout.`;
      }

      // 3) Call your OpenAI-backed API
      const res = await fetch("/api/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [
          { role: "system", content: "You are a friendly fitness coach." },
          { role: "user",   content: userContent }
        ] })
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API error (${res.status}): ${text}`);
      }

      const data = await res.json();
      const msg  = data.choices?.[0]?.message?.content;
      if (!msg) throw new Error("No message returned from OpenAI.");

      setRecap(msg);
    } catch (err) {
      console.error("Recap error:", err);
      setError(
        err.message ||
          "Sorry, I couldn’t generate your daily recap right now."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 2, textAlign: "center" }}>
      <Button
        variant="contained"
        onClick={handleGetRecap}
        disabled={loading}
      >
        {loading ? <CircularProgress size={24} /> : "Get Daily Recap"}
      </Button>

      {error && (
        <Typography color="error" sx={{ mt: 2 }}>
          {error}
        </Typography>
      )}

      {recap && (
        <Typography sx={{ mt: 3, whiteSpace: "pre-wrap" }}>
          {recap}
        </Typography>
      )}

      {/* If non-premium and over limit, show upgrade */}
      <UpgradeModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </Box>
  );
}
