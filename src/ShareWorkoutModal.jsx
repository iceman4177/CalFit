// ShareWorkoutModal.jsx
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
  // Handler to copy text to clipboard
  const handleCopy = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareText)
        .then(() => alert('Workout summary copied to clipboard!'))
        .catch(() => alert('Failed to copy workout summary'));
    } else {
      alert('Clipboard API not supported.');
    }
  };

  // Define social media links that ideally open a new post (or the homepage if no dedicated composer exists)
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
            value={shareText}
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
