// src/components/AmbassadorModal.jsx
import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography
} from '@mui/material';

export default function AmbassadorModal({ open, onClose }) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>🎉 You Hit a 30-Day Streak!</DialogTitle>
      <DialogContent>
        <Typography gutterBottom>
          You’ve been crushing it for 30 days straight—amazing work!
        </Typography>
        <Typography gutterBottom>
          We'd love to feature power users like you. Would you be interested in becoming a Slimcal.ai ambassador?
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Maybe Later</Button>
        <Button onClick={() => {
          window.open('https://forms.gle/ambassador-interest-form', '_blank');
          onClose();
        }} variant="contained" color="primary">
          I’m Interested!
        </Button>
      </DialogActions>
    </Dialog>
  );
}
