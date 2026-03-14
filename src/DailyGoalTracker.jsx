// src/DailyGoalTracker.jsx
import React from "react";
import { Box, Typography, LinearProgress, Paper, Stack } from "@mui/material";

export default function DailyGoalTracker({ burned, consumed, goal }) {
  const net = consumed - burned;
  const absNet = Math.abs(net);
  const pct = goal > 0 ? Math.min((absNet / goal) * 100, 100) : 0;

  const title = net < 0 ? "Today" : "Today's pace";
  const status = net < 0
    ? `You are in a ${Math.round(absNet)} kcal deficit so far.`
    : net > 0
      ? `You are ${Math.round(net)} kcal above burned so far.`
      : "You are perfectly even so far today.";

  return (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 2.25, md: 3 },
        borderRadius: 4,
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 12px 30px rgba(0,0,0,0.16)",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <Typography variant="overline" sx={{ display: "block", textAlign: "center", opacity: 0.65, letterSpacing: 1.3 }}>
        {title}
      </Typography>
      <Typography variant="h6" align="center" sx={{ mt: 0.25, fontWeight: 800 }}>
        How today is tracking
      </Typography>
      <Typography variant="body2" align="center" sx={{ mt: 0.75, opacity: 0.78 }}>
        {status}
      </Typography>

      <Box sx={{ mt: 2.25 }}>
        <LinearProgress
          variant="determinate"
          value={pct}
          sx={{
            height: 12,
            borderRadius: 999,
            bgcolor: "rgba(255,255,255,0.08)",
            ".MuiLinearProgress-bar": { borderRadius: 999 },
          }}
        />
      </Box>

      <Stack direction="row" justifyContent="space-between" sx={{ mt: 1.25, opacity: 0.72 }}>
        <Typography variant="body2">Net: {Math.round(net)} kcal</Typography>
        <Typography variant="body2">Goal: {Math.round(goal || 0)} kcal</Typography>
      </Stack>
    </Paper>
  );
}
