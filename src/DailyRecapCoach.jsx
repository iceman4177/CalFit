// src/DailyRecapCoach.jsx
import React, { useState } from "react";
import {
  Container,
  Typography,
  Box,
  Button,
  CircularProgress,
  Paper,
} from "@mui/material";
import { openai } from "./openaiClient";

export default function DailyRecapCoach() {
  const [recap, setRecap] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGetRecap = async () => {
    setLoading(true);
    setError("");
    setRecap("");

    try {
      // Gather today’s meals & workouts
      const meals = JSON.parse(localStorage.getItem("meals") || "[]")
        .filter(m => m.date === new Date().toLocaleDateString("en-US"));
      const workouts = JSON.parse(localStorage.getItem("workoutHistory") || "[]")
        .filter(w => w.date === new Date().toLocaleDateString("en-US"));

      const prompt = `
You are a friendly fitness coach. Here’s today’s data:
Meals logged: ${meals.length}
${meals.map(m => `- ${m.name}: ${m.calories} cal`).join("\n")}
Workouts logged: ${workouts.length}
${workouts
  .flatMap(w => w.exercises.map(e => `- ${e.name}: ${e.calories.toFixed(2)} cal`))
  .join("\n")}

Please give me a brief, positive recap: what went well, where I can improve, and one tip for tomorrow.
      `.trim();

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 250,
      });

      setRecap(response.choices[0].message.content.trim());
    } catch (e) {
      console.error(e);
      setError("Sorry, something went wrong. Try again later.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Typography variant="h4" align="center" gutterBottom>
        🧠 Daily Recap Coach
      </Typography>
      <Box textAlign="center" mb={3}>
        <Button
          variant="contained"
          size="large"
          onClick={handleGetRecap}
          disabled={loading}
        >
          {loading ? <CircularProgress size={24} /> : "Get Daily Recap"}
        </Button>
      </Box>

      {error && (
        <Typography color="error" align="center" gutterBottom>
          {error}
        </Typography>
      )}

      {recap && (
        <Paper sx={{ p: 3, bgcolor: "background.paper" }}>
          <Typography variant="body1" whiteSpace="pre-line">
            {recap}
          </Typography>
        </Paper>
      )}
    </Container>
  );
}
