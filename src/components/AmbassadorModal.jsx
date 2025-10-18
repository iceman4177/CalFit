import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography
} from '@mui/material';

export default function AmbassadorModal({ open, onClose, user, streak }) {
  const handleInterested = async () => {
    try {
      const clientId = localStorage.getItem('clientId') || null;

      // POST to Slimcal backend API route
      await fetch('/api/ambassador-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user?.id || null,
          email: user?.email || null,
          streak: Number(streak) || 0,
          client_id: clientId,
          joined_at: new Date().toISOString(),
        }),
      });

      // Optional: mark in localStorage that interest was logged
      const data = JSON.parse(localStorage.getItem('userData') || '{}');
      data.ambassadorInterested = true;
      localStorage.setItem('userData', JSON.stringify(data));

      // Navigate to your Waitlist page (in-app)
      onClose();
      window.location.assign('/waitlist');
    } catch (err) {
      console.error('[AmbassadorModal] Error logging interest:', err);
      // Fallback — open Google Form if API fails
      window.open('https://forms.gle/ambassador-interest-form', '_blank');
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>🎉 You Hit a 30-Day Streak!</DialogTitle>
      <DialogContent>
        <Typography gutterBottom>
          You’ve been crushing it for 30 days straight—amazing work!
        </Typography>
        <Typography gutterBottom>
          We’d love to feature power users like you. Would you be interested in
          becoming a Slimcal.ai ambassador?
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Maybe Later</Button>
        <Button
          onClick={handleInterested}
          variant="contained"
          color="primary"
        >
          I’m Interested!
        </Button>
      </DialogActions>
    </Dialog>
  );
}
