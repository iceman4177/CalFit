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
  Typography
} from '@mui/material';

function ShareWorkoutModal({ open, onClose, shareText, shareUrl }) {
  // Pull latest session from localStorage (no prop changes needed)
  const latest = React.useMemo(() => {
    try {
      const hist = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
      return hist[hist.length - 1] || null;
    } catch {
      return null;
    }
  }, []);

  const linesFromLatest = React.useMemo(() => {
    if (!latest || !Array.isArray(latest.exercises)) return [];

    const fmtNum = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    return latest.exercises.map((ex) => {
      const name = ex.exerciseName || ex.name || 'Exercise';
      const isSauna = (ex.exerciseType === 'Sauna') || /sauna/i.test(name);
      const sets = fmtNum(ex.sets);
      const reps = typeof ex.reps === 'string' ? ex.reps.trim() : fmtNum(ex.reps);
      const weight = fmtNum(ex.weight);
      const cals = fmtNum(ex.calories);

      // Build volume string
      let vol = '';
      if (sets && reps && reps !== 0 && reps !== '0') vol = `${sets}×${reps}`;
      else if (sets) vol = `${sets}×`;
      else if (reps && reps !== 0 && reps !== '0') vol = `×${reps}`;

      // Build weight string
      const wt = weight && weight > 0 ? ` @ ${weight} lb` : '';

      // Per-item calories
      const kcal = cals && cals > 0 ? ` — ${Math.round(cals)} kcal` : '';

      // Sauna gets a friendlier label
      if (isSauna) return `• Sauna Session${kcal}`;

      // Strength/cardio
      return `• ${name}${vol || wt ? ` — ${vol}${wt}` : ''}${kcal}`;
    });
  }, [latest]);

  const builtCaption = React.useMemo(() => {
    if (latest && Array.isArray(latest.exercises)) {
      const total = Math.max(0, Math.round(Number(latest.totalCalories || 0)));
      const header = total > 0
        ? `🔥 Just crushed my workout — ${total} kcal burned!`
        : `🔥 Just finished my workout!`;

      const body = linesFromLatest.join('\n');
      const footer = `\n\nTracked with Slimcal.ai 💪 #SlimcalAI`;

      return `${header}\n${body}${footer}`.trim();
    }

    // Fallback: clean up any old shareText a bit (remove timestamps & “items”)
    if (shareText) {
      let t = shareText.replace(/\d{1,2}:\d{2}:\d{2}\s*(AM|PM)?/i, '').trim();
      t = t.replace(/\b\d+\s*items?,?\s*/i, '').trim();
      return `${t}\n\nTracked with Slimcal.ai 💪 #SlimcalAI`;
    }
    return '🔥 Just finished my workout!\n\nTracked with Slimcal.ai 💪 #SlimcalAI';
  }, [latest, linesFromLatest, shareText]);

  const handleCopy = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(builtCaption)
        .then(() => alert('🔥 Copied! Paste it into your post and tag #SlimcalAI'))
        .catch(() => alert('Failed to copy workout summary'));
    } else {
      alert('Clipboard API not supported.');
    }
  };

  const socialLinks = [
    { name: 'Facebook', url: 'https://www.facebook.com/' },
    { name: 'Twitter', url: 'https://twitter.com/compose/tweet' },
    { name: 'LinkedIn', url: 'https://www.linkedin.com/feed/' },
    { name: 'WhatsApp', url: 'https://web.whatsapp.com/' },
    { name: 'Instagram', url: 'https://www.instagram.com/' }
  ];

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Share Your Workout</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <TextField
            multiline
            fullWidth
            minRows={6}
            variant="outlined"
            value={builtCaption}
            InputProps={{ readOnly: true }}
          />
          <Button variant="contained" onClick={handleCopy}>
            Copy to Clipboard
          </Button>
          <Stack direction="row" spacing={2} justifyContent="center" flexWrap="wrap">
            {socialLinks.map((link) => (
              <Button
                key={link.name}
                variant="outlined"
                onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}
              >
                {link.name}
              </Button>
            ))}
          </Stack>
          <Typography variant="body2" align="center">
            Tap a social icon, then paste your caption. Let’s go! 💥
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export default ShareWorkoutModal;
