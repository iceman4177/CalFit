// src/DailyRecapCoach.jsx
import React, { useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Typography
} from "@mui/material";

export default function DailyRecapCoach() {
  const [loading, setLoading] = useState(false);
  const [recap, setRecap]     = useState("");
  const [error, setError]     = useState("");

  const handleGetRecap = async () => {
    setLoading(true);
    setError("");
    setRecap("");

    try {
      // 1) Load your workout history and filter to today's date
      const history = JSON.parse(localStorage.getItem("workoutHistory") || "[]");
      const today   = new Date().toLocaleDateString("en-US");
      const todaysWorkouts = history.filter(w => w.date === today);

      // 2) Build the user prompt based on whether you logged anything
      let userContent;
      if (todaysWorkouts.length === 0) {
        userContent =
          "I haven't logged any workout today. Can you suggest a full‑body workout plan for me?";
      } else {
        // Flatten all exercises from today's sessions
        const lines = todaysWorkouts.flatMap(w =>
          w.exercises.map(ex =>
            `- ${ex.name}: ${ex.sets}×${ex.reps} (${ex.calories.toFixed(2)} cal)`
          )
        );
        userContent = `Here’s what I did today:\n${lines.join("\n")}\n\nPlease give me a friendly recap of my workout.`;
      }

      // 3) Send to your API route
      const messages = [
        { role: "system", content: "You are a friendly fitness coach." },
        { role: "user", content: userContent }
      ];

      const res = await fetch("/api/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages })
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
      setError("Sorry, I couldn’t generate your daily recap right now.");
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
    </Box>
  );
}
