// src/ShareWorkoutModal.jsx
import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Stack,
  TextField,
  Typography,
  Chip,
  Box,
  Divider,
} from '@mui/material';

function lineFromExercise(ex) {
  const name = ex?.exerciseName || ex?.name || 'Exercise';
  const sets = Number.isFinite(Number(ex?.sets)) ? Number(ex.sets) : null;
  const reps = Number.isFinite(Number(ex?.reps)) ? Number(ex.reps) : null;
  const weight = Number.isFinite(Number(ex?.weight)) ? Number(ex.weight) : null;
  const calories = Number.isFinite(Number(ex?.calories)) ? Math.round(Number(ex.calories)) : null;
  const type = String(ex?.exerciseType || '').toLowerCase();
  const isSauna = type === 'sauna' || /sauna/i.test(name);
  const isTimed = isSauna || type === 'cardio';

  if (isTimed) {
    const timedPart = reps ? `${reps} min` : sets ? `${sets} round${sets === 1 ? '' : 's'}` : '';
    return `• ${name}${timedPart ? ` — ${timedPart}` : ''}${calories ? ` • ${calories} cal` : ''}`;
  }

  const volumeParts = [];
  if (sets) volumeParts.push(`${sets} set${sets === 1 ? '' : 's'}`);
  if (reps) volumeParts.push(`${reps} reps`);
  if (weight && weight > 0) volumeParts.push(`${weight} lb`);

  return `• ${name}${volumeParts.length ? ` — ${volumeParts.join(' • ')}` : ''}${calories ? ` • ${calories} cal` : ''}`;
}

function buildCaption({ shareText, exercises, totalCalories, workoutDate }) {
  const total = Math.max(0, Math.round(Number(totalCalories) || 0));
  const dateText = workoutDate || 'today';
  const header = total > 0
    ? `🔥 Just crushed my workout on ${dateText} — ${total} kcal burned!`
    : `🔥 Just finished my workout on ${dateText}!`;

  const body = Array.isArray(exercises) && exercises.length
    ? exercises.map(lineFromExercise).join('\n')
    : (shareText || '').trim();

  const footer = '\n\nTracked with Slimcal.ai 💪 #SlimcalAI';
  return `${header}${body ? `\n${body}` : ''}${footer}`.trim();
}

const SOCIALS = [
  { name: 'Facebook', url: 'https://www.facebook.com/', label: 'Post on Facebook' },
  { name: 'X', url: 'https://twitter.com/compose/tweet', label: 'Share on X' },
  { name: 'LinkedIn', url: 'https://www.linkedin.com/feed/', label: 'Share on LinkedIn' },
  { name: 'WhatsApp', url: 'https://web.whatsapp.com/', label: 'Send on WhatsApp' },
  { name: 'Instagram', url: 'https://www.instagram.com/', label: 'Open Instagram' },
];

function ShareWorkoutModal({ open, onClose, shareText, exercises = [], totalCalories = 0, workoutDate = '' }) {
  const builtCaption = React.useMemo(
    () => buildCaption({ shareText, exercises, totalCalories, workoutDate }),
    [shareText, exercises, totalCalories, workoutDate]
  );

  const handleCopy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(builtCaption);
      alert('Copied. Paste it into your post and tag #SlimcalAI');
    } catch (err) {
      alert('Could not copy the workout caption.');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800 }}>Share this session</DialogTitle>
      <DialogContent>
        <Stack spacing={2.25}>
          <Box
            sx={{
              p: 2,
              borderRadius: 3,
              border: '1px solid rgba(16,24,40,0.08)',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.98) 100%)',
            }}
          >
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
              <Chip label={`${Math.max(0, Math.round(Number(totalCalories) || 0))} kcal`} />
              <Chip label={`${Array.isArray(exercises) ? exercises.length : 0} exercises`} />
              {workoutDate ? <Chip label={workoutDate} /> : null}
            </Stack>
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
              Copy the caption below, then drop it into your post or story.
            </Typography>
            <TextField
              multiline
              fullWidth
              minRows={8}
              variant="outlined"
              value={builtCaption}
              InputProps={{ readOnly: true }}
            />
          </Box>

          <Button variant="contained" size="large" onClick={handleCopy}>
            Copy caption
          </Button>

          <Divider />

          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1.25 }}>
              Open a social app
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {SOCIALS.map((link) => (
                <Button
                  key={link.name}
                  variant="outlined"
                  onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}
                  sx={{ borderRadius: 999, px: 2 }}
                >
                  {link.name}
                </Button>
              ))}
            </Stack>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1.25 }}>
              Best flow: copy the caption first, then open the app you want to post in.
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export default ShareWorkoutModal;
