// src/ShareWorkoutModal.jsx
import React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  TextField,
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

export default function ShareWorkoutModal({ open, onClose, shareText, exercises, totalCalories }) {
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
      // user cancel = ignore
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
          <Typography sx={{ color: "#667085", fontSize: { xs: 17, sm: 18 }, lineHeight: 1.55 }}>
            Open a post fast, keep the caption clean, and show your progress with SlimCal style.
          </Typography>

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
              Copy caption
            </Button>

            <Button
              fullWidth
              variant="outlined"
              startIcon={<IosShareIcon />}
              onClick={handleNativeShare}
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
              Share session
            </Button>
          </Stack>

          <Box
            sx={{
              px: 1,
              py: 1.25,
              borderRadius: 3,
              background: 'linear-gradient(180deg, rgba(235,242,255,0.85) 0%, rgba(247,249,252,0.85) 100%)',
            }}
          >
            <Typography sx={{ color: '#64748b', fontSize: 14, lineHeight: 1.5 }}>
              On iPhone, Share session opens the native share sheet like Pose Session. Some apps may still limit true caption prefills, so Copy caption stays here as the clean fallback.
            </Typography>
          </Box>
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
