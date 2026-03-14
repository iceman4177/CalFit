// src/ShareWorkoutModal.jsx
import React from "react";
import { shareOrDownloadPng } from "./lib/frameCheckSharePng.js";
import { makeWorkoutShareCardBlob } from "./lib/workoutShareCard.js";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  TextField,
  Typography,
  Box,
  Chip
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

export default function ShareWorkoutModal({ open, onClose, shareText, exercises, totalCalories, startedAt }) {
  const caption = React.useMemo(
    () => buildCaption({ shareText, exercises, totalCalories }),
    [shareText, exercises, totalCalories]
  );

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(caption);
      alert("Copied caption — paste it into your post.");
    } catch (e) {
      alert("Could not copy caption.");
    }
  }, [caption]);

  const [shareBusy, setShareBusy] = React.useState(false);

  const handleNativeShare = React.useCallback(async () => {
    try {
      setShareBusy(true);
      const blob = await makeWorkoutShareCardBlob({
        exercises,
        totalCalories,
        shareText: caption,
        startedAt,
      });

      if (blob) {
        await shareOrDownloadPng(blob, "slimcal-workout-share.png", caption);
        return;
      }

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
    } finally {
      setShareBusy(false);
    }
  }, [caption, exercises, handleCopy, startedAt, totalCalories]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      PaperProps={{
        sx: {
          borderRadius: 5,
          p: { xs: 1, sm: 1.5 },
          overflow: "hidden",
        },
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Typography sx={{ fontSize: { xs: 24, sm: 28 }, fontWeight: 900, color: "#0f172a" }}>
          Share your workout
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: 0.5 }}>
        <Stack spacing={2.25}>
          <Typography sx={{ color: "#667085", fontSize: { xs: 16, sm: 17 }, lineHeight: 1.55 }}>
            Share a clean workout post fast with a SlimCal card plus a ready caption.
          </Typography>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip label={`${Math.round(Number(totalCalories) || 0)} cal`} sx={{ borderRadius: 999, fontWeight: 800, background: "#eef2ff", color: "#0f172a" }} />
            <Chip label={`${Array.isArray(exercises) ? exercises.length : 0} ${(Array.isArray(exercises) ? exercises.length : 0) === 1 ? "exercise" : "exercises"}`} variant="outlined" sx={{ borderRadius: 999, fontWeight: 800 }} />
          </Stack>

          <TextField
            multiline
            fullWidth
            minRows={6}
            maxRows={10}
            variant="outlined"
            value={caption}
            InputProps={{ readOnly: true }}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 4,
                background: '#f8fafc',
                alignItems: 'flex-start',
              },
              '& .MuiOutlinedInput-input': {
                fontSize: 16,
                lineHeight: 1.5,
              },
            }}
          />

          <Stack spacing={1.5}>
            <Button
              fullWidth
              variant="contained"
              startIcon={<ContentCopyIcon />}
              onClick={handleCopy}
              sx={{
                py: 1.6,
                borderRadius: 999,
                textTransform: 'none',
                fontSize: 18,
                fontWeight: 800,
                boxShadow: 'none',
                backgroundColor: '#3367E8',
                '&:hover': { backgroundColor: '#2c58ca', boxShadow: 'none' },
              }}
            >
              Copy Caption
            </Button>

            <Button
              fullWidth
              variant="outlined"
              startIcon={<IosShareIcon />}
              onClick={handleNativeShare}
              disabled={shareBusy}
              sx={{
                py: 1.6,
                borderRadius: 999,
                textTransform: 'none',
                fontSize: 18,
                fontWeight: 800,
                borderColor: '#9db7ff',
                color: '#3367E8',
              }}
            >
              {shareBusy ? "Preparing…" : "Share Post"}
            </Button>
          </Stack>

          <Typography sx={{ color: "#64748b", fontSize: 13.5, lineHeight: 1.45, px: 0.5 }}>
            Share Post opens the phone’s native share sheet with a workout card. Copy Caption stays as the fallback for apps that don’t accept text prefills.
          </Typography>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pt: 0.5, pb: 1 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none', fontWeight: 800, fontSize: 17, color: '#3367E8' }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
