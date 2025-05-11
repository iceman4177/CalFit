// src/components/DailyRecapCoach.jsx
import React, { useState, useEffect } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from "@mui/material";

export default function DailyRecapCoach({ openUpgradeModal }) {
  const [loading, setLoading]   = useState(false);
  const [recap, setRecap]       = useState("");
  const [error, setError]       = useState("");
  const [usage, setUsage]       = useState(0);
  const [showUpgrade, setShowUpgrade] = useState(false);

  // Use ISO date string so it resets daily
  const todayKey = new Date().toISOString().slice(0, 10);

  // Load or initialize our usage record
  useEffect(() => {
    let record = null;
    try {
      record = JSON.parse(localStorage.getItem("dailyRecapUsage"));
    } catch {}
    if (!record || record.date !== todayKey) {
      record = { date: todayKey, count: 0 };
      localStorage.setItem("dailyRecapUsage", JSON.stringify(record));
    }
    setUsage(record.count);
  }, [todayKey]);

  const incrementUsage = () => {
    const raw = localStorage.getItem("dailyRecapUsage");
    const record = raw ? JSON.parse(raw) : { date: todayKey, count: 0 };
    const next = { date: todayKey, count: record.count + 1 };
    localStorage.setItem("dailyRecapUsage", JSON.stringify(next));
    setUsage(next.count);
    return next.count;
  };

  const handleGetRecap = async () => {
    // if they've used up all 3 free tries, prompt upgrade
    if (usage >= 3) {
      setShowUpgrade(true);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const messages = [
        { role: "system", content: "You are a friendly fitness coach." },
        { role: "user",   content: "Give me a recap of today's workout." }
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
      const newCount = incrementUsage();

      // if they've just hit 3, we can optionally auto‑prompt
      if (newCount >= 3) {
        setShowUpgrade(true);
      }
    } catch (err) {
      console.error("Recap error:", err);
      setError("Sorry, I couldn’t generate your daily recap right now.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpgradeClick = () => {
    setShowUpgrade(false);
    openUpgradeModal && openUpgradeModal();
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

      {/* Upgrade dialog */}
      <Dialog open={showUpgrade} onClose={() => setShowUpgrade(false)}>
        <DialogTitle>Free Recaps Used Up</DialogTitle>
        <DialogContent>
          You’ve used all 3 of your free daily recaps.{" "}
          <strong>Upgrade to premium</strong> for unlimited AI coaching!
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowUpgrade(false)}>Not Now</Button>
          <Button variant="contained" onClick={handleUpgradeClick}>
            Upgrade
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
