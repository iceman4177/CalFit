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
  // Helper to clean up share text (remove timestamp, fix sauna)
  const formattedText = React.useMemo(() => {
    if (!shareText) return '';

    let text = shareText;

    // Remove timestamp (keep date only)
    text = text.replace(/\d{1,2}:\d{2}:\d{2}\s*(AM|PM)?/i, '').trim();

    // Replace sauna line if present
    text = text.replace(/-+\s*Sauna.*0 reps/i, match => {
      const caloriesMatch = shareText.match(/(\d+(?:\.\d+)?)\s*cal/i);
      const cals = caloriesMatch ? `${caloriesMatch[1]} cals` : '';
      return `- Sauna Session${cals ? ` (${cals})` : ''}`;
    });

    // Simplify intro sentence
    text = text.replace(
      /I just logged a workout on\s*(.*)with Slimcal\.ai — ([\d.]+)\s*calories burned! #SlimcalAI/i,
      'I just finished a workout with Slimcal.ai — $2 burned! #SlimcalAI'
    );

    return text;
  }, [shareText]);

  // Handler to copy text to clipboard
  const handleCopy = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(formattedText)
        .then(() => alert('Workout summary copied to clipboard!'))
        .catch(() => alert('Failed to copy workout summary'));
    } else {
      alert('Clipboard API not supported.');
    }
  };

  // Define social media links that ideally open a new post (or homepage if no composer exists)
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
            variant="outlined"
            value={formattedText}
            InputProps={{ readOnly: true }}
          />
          <Button variant="contained" onClick={handleCopy}>
            Copy to Clipboard
          </Button>
          <Stack direction="row" spacing={2} justifyContent="center">
            {socialLinks.map((link) => (
              <Button
                key={link.name}
                variant="outlined"
                onClick={() => window.open(link.url, '_blank')}
              >
                {link.name}
              </Button>
            ))}
          </Stack>
          <Typography variant="body2" align="center">
            After clicking a social media button, paste your copied workout summary into the new post.
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
