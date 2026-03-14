// src/DailyGoalTracker.jsx
import React from "react";
import { Box, Typography, LinearProgress, Paper, Stack } from "@mui/material";

export default function DailyGoalTracker({ burned, consumed, goal }) {
  const safeGoal = Math.max(Number(goal) || 0, 0);
  const safeBurned = Math.max(Number(burned) || 0, 0);
  const safeConsumed = Math.max(Number(consumed) || 0, 0);
  const net = safeConsumed - safeBurned;

  const rawPct = safeGoal > 0 ? (Math.abs(net) / safeGoal) * 100 : 0;
  const pct = Math.max(0, Math.min(rawPct, 100));
  const paceCopy =
    net > 0
      ? `You are ${Math.round(net)} kcal above burned so far.`
      : net < 0
        ? `You are ${Math.round(Math.abs(net))} kcal under burned so far.`
        : "You are perfectly balanced so far today.";

  return (
    <Paper
      elevation={0}
      sx={{
        p: { xs: 2.5, md: 4 },
        borderRadius: "32px",
        border: "1px solid rgba(15,23,42,0.06)",
        mb: 3,
      }}
    >
      <Stack spacing={1.25} alignItems="center" textAlign="center" sx={{ mb: 2.25 }}>
        <Typography sx={{ fontSize: 16, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6b7280", fontWeight: 700 }}>
          Today&apos;s Pace
        </Typography>
        <Typography sx={{ fontSize: { xs: 28, md: 36 }, fontWeight: 900, color: "#0f172a" }}>
          How today is tracking
        </Typography>
        <Typography sx={{ color: "#98a2b3", fontSize: { xs: 18, md: 20 } }}>{paceCopy}</Typography>
      </Stack>

      <Box sx={{ px: { xs: 0, md: 1 } }}>
        <LinearProgress
          variant="determinate"
          value={pct}
          sx={{
            height: 14,
            borderRadius: 999,
            bgcolor: "rgba(15,23,42,0.07)",
            "& .MuiLinearProgress-bar": {
              borderRadius: 999,
              background: net >= 0 ? "linear-gradient(90deg, #2563eb 0%, #3b82f6 100%)" : "linear-gradient(90deg, #10b981 0%, #34d399 100%)",
            },
          }}
        />
        <Box sx={{ display: "flex", justifyContent: "space-between", mt: 1.25, gap: 2, flexWrap: "wrap" }}>
          <Typography sx={{ color: "#98a2b3", fontSize: { xs: 16, md: 18 } }}>
            Net: {net >= 0 ? "+" : "-"}
            {Math.round(Math.abs(net))} kcal
          </Typography>
          <Typography sx={{ color: "#98a2b3", fontSize: { xs: 16, md: 18 } }}>Goal: {Math.round(safeGoal)} kcal</Typography>
        </Box>
      </Box>
    </Paper>
  );
}
