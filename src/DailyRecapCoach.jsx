import React, { useState } from "react";
import { Box, Button, CircularProgress, Typography } from "@mui/material";

export default function DailyRecapCoach() {
  const [loading, setLoading] = useState(false);
  const [recap, setRecap]     = useState("");
  const [error, setError]     = useState("");

  const handleGetRecap = async () => {
    setLoading(true);
    setError("");
    try {
      const messages = [
        { role: "system", content: "You are a friendly fitness coach." },
        { role: "user",   content: "Give me a recap of today's workout." }
      ];

      const res = await fetch("/api/openai", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ messages })
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
      <Button variant="contained" onClick={handleGetRecap} disabled={loading}>
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
