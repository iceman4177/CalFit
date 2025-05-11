// src/DailyRecapCoach.jsx
import React, { useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import UpgradeModal from "./components/UpgradeModal";

export default function DailyRecapCoach() {
  const [recap, setRecap] = useState("");
  const [loading, setLoading] = useState(false);
  const [callsMade, setCallsMade] = useState(
    parseInt(localStorage.getItem("recapCalls") || "0", 10)
  );
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const handleGetRecap = async () => {
    if (callsMade >= 3) {
      setUpgradeOpen(true);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: "You are a helpful fitness coach." },
            { role: "user", content: "Give me my daily recap..." }
          ]
        })
      });
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "";
      setRecap(content);

      const next = callsMade + 1;
      setCallsMade(next);
      localStorage.setItem("recapCalls", next.toString());
    } catch (err) {
      console.error("Recap error:", err);
      setRecap("Error getting recap. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" gutterBottom>
        Daily Recap Coach
      </Typography>
      {recap && (
        <Typography sx={{ whiteSpace: "pre-wrap", mb: 2 }}>{recap}</Typography>
      )}
      <Button
        variant="contained"
        onClick={handleGetRecap}
        disabled={loading}
      >
        {loading ? "Loading…" : "Get Daily Recap"}
      </Button>

      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
    </Box>
  );
}
