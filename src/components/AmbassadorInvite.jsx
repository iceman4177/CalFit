// src/components/AmbassadorInvite.jsx

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  Button
} from '@mui/material';

export default function AmbassadorInvite({ streak }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const hasSeen = localStorage.getItem('hasSeenAmbassadorInvite');
    if (streak >= 30 && !hasSeen) {
      setOpen(true);
      localStorage.setItem('hasSeenAmbassadorInvite', 'true');
    }
  }, [streak]);

  const handleClose = () => setOpen(false);
  const handleJoin = () => {
    // Replace with future logic to add user to waitlist
    alert('🎉 You’re on the Ambassador waitlist!');
    setOpen(false);
  };

  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogTitle>🎯 Become a Transformation Ambassador</DialogTitle>
      <DialogContent>
        <Typography gutterBottom>
          You’ve logged workouts for <strong>{streak}</strong> days in a row!
        </Typography>
        <Typography>
          Want to earn free Pro upgrades and rewards by inspiring others on their journey?
          Join our Transformation Ambassador program.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Maybe Later</Button>
        <Button variant="contained" onClick={handleJoin}>Join Waitlist</Button>
      </DialogActions>
    </Dialog>
  );
}
