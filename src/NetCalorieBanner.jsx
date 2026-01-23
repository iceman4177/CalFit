// src/components/NetCalorieBanner.jsx
import React, { useMemo } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Stack,
  Chip,
  CircularProgress,
  Divider,
} from "@mui/material";

/**
 * NetCalorieBanner (Enhanced MFP-style)
 *
 * Primary number: Remaining calories (Goal - Food + Exercise)
 * Slimcal net calories: Food - Exercise (your canonical definition)
 *
 * Props are intentionally flexible for backwards compatibility.
 */
export default function NetCalorieBanner({
  goalCalories = 0,
  caloriesEaten = 0,
  caloriesBurned = 0,
  // optional: if caller already computed net, we’ll use it; otherwise compute
  netCalories,
  // optional: allow a tiny title override if needed later
  title = "Today",
}) {
  const goal = Number(goalCalories) || 0;
  const eaten = Number(caloriesEaten) || 0;
  const burned = Number(caloriesBurned) || 0;

  // MFP-style remaining
  const remaining = useMemo(() => Math.round(goal - eaten + burned), [goal, eaten, burned]);

  // Slimcal canonical net
  const net = useMemo(() => {
    if (Number.isFinite(Number(netCalories))) return Math.round(Number(netCalories));
    return Math.round(eaten - burned);
  }, [netCalories, eaten, burned]);

  const isOver = remaining < 0;
  const remainingAbs = Math.abs(remaining);

  // Progress ring: percent of goal "used" after exercise credit (eaten - burned)
  const effectiveUsed = useMemo(() => Math.max(0, eaten - burned), [eaten, burned]);

  const pct = useMemo(() => {
    if (!goal) return 0;
    return Math.max(0, Math.min(100, (effectiveUsed / goal) * 100));
  }, [goal, effectiveUsed]);

  const formatInt = (n) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return "0";
    return String(Math.round(x));
  };

  const labelPrimary = isOver ? "Over by" : "Remaining";

  return (
    <Card
      elevation={0}
      sx={{
        border: "1px solid rgba(2,6,23,0.10)",
        borderRadius: 3,
        overflow: "hidden",
        background: "white",
      }}
    >
      <CardContent sx={{ p: 2 }}>
        {/* Header */}
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 700 }}>
              {title}
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 900, lineHeight: 1.1 }}>
              Calories
            </Typography>
          </Box>

          {/* Net chip (Slimcal differentiator) */}
          <Chip
            size="small"
            label={`Net: ${net > 0 ? `+${formatInt(net)}` : formatInt(net)} kcal`}
            sx={{ fontWeight: 800 }}
          />
        </Stack>

        <Divider sx={{ my: 1.5 }} />

        {/* Main row: Ring + Remaining */}
        <Stack direction="row" spacing={2} alignItems="center">
          <Box sx={{ position: "relative", width: 72, height: 72, flex: "0 0 auto" }}>
            {/* Track */}
            <CircularProgress
              variant="determinate"
              value={100}
              size={72}
              thickness={5}
              sx={{ color: "rgba(2,6,23,0.08)" }}
            />
            {/* Fill */}
            <CircularProgress
              variant="determinate"
              value={pct}
              size={72}
              thickness={5}
              sx={{
                position: "absolute",
                left: 0,
                top: 0,
              }}
            />
            {/* Center text */}
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
              }}
            >
              <Typography sx={{ fontWeight: 900, fontSize: 12, lineHeight: 1 }}>
                {labelPrimary}
              </Typography>
              <Typography sx={{ fontWeight: 900, fontSize: 14, lineHeight: 1.1 }}>
                {formatInt(remainingAbs)}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 700 }}>
              Remaining = Goal − Food + Exercise
            </Typography>

            <Typography
              variant="h5"
              sx={{
                mt: 0.5,
                fontWeight: 950,
                letterSpacing: "-0.02em",
                lineHeight: 1.1,
              }}
            >
              {isOver ? `Over by ${formatInt(remainingAbs)}` : `${formatInt(remainingAbs)} left`}
              <Typography component="span" sx={{ fontWeight: 800, ml: 0.75 }} color="text.secondary">
                kcal
              </Typography>
            </Typography>

            {!!goal && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.4 }}>
                Based on your goal of {formatInt(goal)} kcal
              </Typography>
            )}
          </Box>
        </Stack>

        {/* Breakdown row */}
        <Stack direction="row" spacing={1} sx={{ mt: 1.75, flexWrap: "wrap" }}>
          <BreakPill icon="🎯" label="Goal" value={`${formatInt(goal)} kcal`} />
          <BreakPill icon="🍽️" label="Food" value={`${formatInt(eaten)} kcal`} />
          <BreakPill icon="🔥" label="Exercise" value={`${formatInt(burned)} kcal`} />
        </Stack>
      </CardContent>
    </Card>
  );
}

function BreakPill({ icon, label, value }) {
  return (
    <Box
      sx={{
        px: 1.25,
        py: 0.75,
        borderRadius: 2,
        border: "1px solid rgba(2,6,23,0.08)",
        background: "rgba(2,6,23,0.02)",
        display: "flex",
        alignItems: "center",
        gap: 0.8,
      }}
    >
      <Box sx={{ width: 20, textAlign: "center" }}>{icon}</Box>
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 800, lineHeight: 1 }}>
          {label}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 900, lineHeight: 1.1 }}>
          {value}
        </Typography>
      </Box>
    </Box>
  );
}
