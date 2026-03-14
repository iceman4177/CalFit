// src/ShareWorkoutModal.jsx
import React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  Typography,
  Box
} from "@mui/material";
import IosShareIcon from "@mui/icons-material/IosShare";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";

function buildCaption({ shareText, exercises = [], totalCalories = 0 }) {
  const cleanExercises = Array.isArray(exercises) ? exercises : [];

  if (cleanExercises.length) {
    const header = totalCalories > 0
      ? `🔥 Just crushed my workout — ${Math.round(Number(totalCalories) || 0)} kcal burned.`
      : `🔥 Just crushed my workout.`;

    const body = cleanExercises
      .map((ex) => {
        const name = String(ex?.exerciseName || ex?.name || "Exercise").trim() || "Exercise";
        const sets = Number(ex?.sets) || 0;
        const reps = ex?.reps != null && String(ex.reps).trim() !== "" ? String(ex.reps).trim() : "";
        const weight = Number(ex?.weight) || 0;
        const calories = Number(ex?.calories) || 0;
        const isSauna = (ex?.exerciseType === "Sauna") || /sauna/i.test(name);

        if (isSauna) return `• Sauna session${calories > 0 ? ` — ${Math.round(calories)} cal` : ""}`;

        let volume = "";
        if (sets && reps) volume = `${sets}x${reps}`;
        else if (sets) volume = `${sets} sets`;
        else if (reps) volume = `${reps} reps`;

        const weightText = weight > 0 ? ` @ ${Math.round(weight)} lb` : "";
        const calText = calories > 0 ? ` (${Math.round(calories)} cal)` : "";
        return `• ${name}${volume ? ` — ${volume}` : ""}${weightText}${calText}`;
      })
      .join("\n");

    return `${header}\n${body}\n\nTracked with Slimcal.ai 💪 #SlimcalAI`;
  }

  if (shareText) {
    let t = String(shareText).trim();
    if (!/Slimcal/i.test(t)) t += `\n\nTracked with Slimcal.ai 💪 #SlimcalAI`;
    return t;
  }

  return "🔥 Just finished my workout.\n\nTracked with Slimcal.ai 💪 #SlimcalAI";
}

function StatChip({ children, filled = false }) {
  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        px: 2.1,
        py: 1.05,
        minWidth: 132,
        borderRadius: 999,
        border: filled ? "1px solid transparent" : "1.5px solid #d1d5db",
        background: filled ? "#eef2ff" : "#ffffff",
        color: "#0f172a",
        fontSize: { xs: 16, sm: 17 },
        fontWeight: 900,
        lineHeight: 1,
      }}
    >
      {children}
    </Box>
  );
}

export default function ShareWorkoutModal({ open, onClose, shareText, exercises, totalCalories }) {
  const caption = React.useMemo(
    () => buildCaption({ shareText, exercises, totalCalories }),
    [shareText, exercises, totalCalories]
  );

  const exerciseCount = Array.isArray(exercises) ? exercises.length : 0;

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(caption);
      alert("Copied caption — paste it into your post.");
    } catch (e) {
      alert("Could not copy caption.");
    }
  }, [caption]);

  const handleNativeShare = React.useCallback(async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: "SlimCal Workout",
          text: caption,
        });
        return;
      }
      await handleCopy();
    } catch (e) {
      if (e?.name === "AbortError") return;
      await handleCopy();
    }
  }, [caption, handleCopy]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      PaperProps={{
        sx: {
          borderRadius: 5,
          px: { xs: 1.5, sm: 2 },
          py: { xs: 1, sm: 1.5 },
          overflow: "hidden",
          maxHeight: "calc(100dvh - 28px)",
          m: { xs: 1.25, sm: 2 },
        },
      }}
    >
      <DialogTitle sx={{ pb: 0.75, pt: 0.75 }}>
        <Typography sx={{ fontSize: { xs: 22, sm: 26 }, fontWeight: 900, color: "#0f172a", lineHeight: 1.05 }}>
          Share your workout
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: 0.25, pb: 0.5 }}>
        <Stack spacing={1.5}>
          <Typography sx={{ color: "#667085", fontSize: { xs: 15, sm: 16 }, lineHeight: 1.45 }}>
            Open a polished post fast and keep the caption ready to paste.
          </Typography>

          {(Number(totalCalories) > 0 || exerciseCount > 0) && (
            <Stack direction="row" spacing={1.2} sx={{ flexWrap: "wrap", rowGap: 1.2 }}>
              {Number(totalCalories) > 0 && <StatChip filled>{Math.round(Number(totalCalories) || 0)} cal</StatChip>}
              {exerciseCount > 0 && <StatChip>{exerciseCount} exercises</StatChip>}
            </Stack>
          )}

          <Stack spacing={1.15}>
            <Button
              fullWidth
              variant="contained"
              startIcon={<IosShareIcon />}
              onClick={handleNativeShare}
              sx={{
                py: 1.45,
                borderRadius: 999,
                textTransform: "none",
                fontSize: { xs: 19, sm: 18 },
                fontWeight: 900,
                boxShadow: "none",
                backgroundColor: "#3367E8",
                '&:hover': { backgroundColor: '#2c58ca', boxShadow: 'none' },
              }}
            >
              Share workout
            </Button>

            <Button
              fullWidth
              variant="outlined"
              startIcon={<ContentCopyIcon />}
              onClick={handleCopy}
              sx={{
                py: 1.35,
                borderRadius: 999,
                textTransform: "none",
                fontSize: { xs: 18, sm: 17 },
                fontWeight: 800,
                borderColor: "#b7c8ff",
                color: "#3367E8",
                backgroundColor: "#ffffff",
              }}
            >
              Copy caption
            </Button>
          </Stack>

          <Box
            sx={{
              p: 1.4,
              borderRadius: 4,
              background: "#f8fafc",
              border: "1px solid #e6ecf5",
            }}
          >
            <Typography sx={{ color: "#3367E8", fontSize: 15, fontWeight: 900, mb: 0.7 }}>
              Caption preview
            </Typography>
            <Box
              sx={{
                maxHeight: { xs: 170, sm: 200 },
                overflowY: "auto",
                pr: 0.75,
              }}
            >
              <Typography
                sx={{
                  color: "#0f172a",
                  fontSize: { xs: 14, sm: 15 },
                  lineHeight: 1.45,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {caption}
              </Typography>
            </Box>
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 2.5, pt: 0.25, pb: 0.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none", fontWeight: 800, fontSize: 17, color: "#3367E8" }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
