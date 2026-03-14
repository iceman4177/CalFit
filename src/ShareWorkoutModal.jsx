// src/ShareWorkoutModal.jsx
import React from "react";
import { makeWorkoutShareCardBlob } from "./lib/workoutShareCard.js";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  Typography,
  Chip,
  Box
} from "@mui/material";
import IosShareIcon from "@mui/icons-material/IosShare";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { showAppToast } from "./lib/appToast";

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

function compactPreview(text = "", maxLines = 5) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .join("\n");
}

async function copyTextQuiet(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  return false;
}

async function downloadBlob(blob, fileName) {
  if (!(blob instanceof Blob)) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

export default function ShareWorkoutModal({ open, onClose, shareText, exercises, totalCalories, startedAt }) {
  const caption = React.useMemo(
    () => buildCaption({ shareText, exercises, totalCalories }),
    [shareText, exercises, totalCalories]
  );

  const previewText = React.useMemo(() => compactPreview(caption, 5), [caption]);
  const exerciseCount = Array.isArray(exercises) ? exercises.length : 0;
  const [shareBusy, setShareBusy] = React.useState(false);

  const handleCopy = React.useCallback(async () => {
    const ok = await copyTextQuiet(caption);
    showAppToast(ok ? "Copied caption — paste it into your post." : "Could not copy caption.", ok ? "success" : "warning");
  }, [caption]);

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
        const copied = await copyTextQuiet(caption);
        const file = new File([blob], "slimcal-workout-share.png", { type: "image/png" });

        if (navigator?.share && navigator?.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file] });
          if (copied) {
            setTimeout(() => {
              try { showAppToast("Workout card shared. Caption is already copied for paste.", "success"); } catch {}
            }, 180);
          }
          return;
        }

        await downloadBlob(blob, "slimcal-workout-share.png");
        if (copied) {
          showAppToast("Workout card saved/downloaded. Caption is copied and ready to paste.", "success");
        }
        return;
      }

      if (navigator?.share) {
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
          px: { xs: 1.25, sm: 1.5 },
          pt: { xs: 1, sm: 1.25 },
          pb: 0.5,
          overflow: "hidden",
          mx: 1.5,
        },
      }}
    >
      <DialogTitle sx={{ pb: 0.5 }}>
        <Typography sx={{ fontSize: { xs: 25, sm: 29 }, fontWeight: 900, color: "#0f172a", lineHeight: 1.05 }}>
          Share your workout
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: 0.5, pb: 0 }}>
        <Stack spacing={2}>
          <Typography sx={{ color: "#667085", fontSize: { xs: 15, sm: 16 }, lineHeight: 1.45 }}>
            Open the workout card fast and keep the caption ready to paste.
          </Typography>

          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: "wrap", justifyContent: "center", alignItems: "center" }}
          >
            <Chip
              label={`${Math.round(Number(totalCalories) || 0)} cal`}
              sx={{
                borderRadius: 999,
                fontWeight: 800,
                fontSize: 15,
                height: 42,
                background: "#eef2ff",
                color: "#0f172a",
              }}
            />
            <Chip
              label={`${exerciseCount} ${exerciseCount === 1 ? "exercise" : "exercises"}`}
              variant="outlined"
              sx={{
                borderRadius: 999,
                fontWeight: 800,
                fontSize: 15,
                height: 42,
              }}
            />
          </Stack>

          <Stack spacing={1.25}>
            <Button
              fullWidth
              variant="contained"
              startIcon={<IosShareIcon />}
              onClick={handleNativeShare}
              disabled={shareBusy}
              sx={{
                py: 1.45,
                borderRadius: 999,
                textTransform: "none",
                fontSize: 18,
                fontWeight: 800,
                boxShadow: "none",
                backgroundColor: "#3367E8",
                "&:hover": { backgroundColor: "#2c58ca", boxShadow: "none" },
              }}
            >
              {shareBusy ? "Preparing…" : "Share workout"}
            </Button>

            <Button
              fullWidth
              variant="outlined"
              startIcon={<ContentCopyIcon />}
              onClick={handleCopy}
              sx={{
                py: 1.45,
                borderRadius: 999,
                textTransform: "none",
                fontSize: 18,
                fontWeight: 800,
                borderWidth: 2,
                borderColor: "#c7d2fe",
                color: "#3367E8",
              }}
            >
              Copy caption
            </Button>
          </Stack>

          <Box
            sx={{
              borderRadius: 4,
              border: "1.5px solid #dbe4ff",
              background: "#f8fafc",
              px: 2,
              py: 1.5,
            }}
          >
            <Typography sx={{ color: "#2563eb", fontWeight: 900, fontSize: 15.5, mb: 0.75 }}>
              Caption preview
            </Typography>
            <Typography
              sx={{
                color: "#0f172a",
                fontSize: 15,
                lineHeight: 1.45,
                display: "-webkit-box",
                WebkitLineClamp: 5,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                whiteSpace: "pre-line",
              }}
            >
              {previewText}
            </Typography>
          </Box>

        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 2.5, pt: 0.5, pb: 0.75 }}>
        <Button onClick={onClose} sx={{ textTransform: "none", fontWeight: 800, fontSize: 17, color: "#3367E8" }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
