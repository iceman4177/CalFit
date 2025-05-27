// src/components/WaitlistSignup.jsx

import React, { useState } from 'react';
import { Box, Typography, TextField, Button, Alert } from '@mui/material';

export default function WaitlistSignup() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle | success | error

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setStatus('error');
      return;
    }

    try {
      // TODO: replace with real API call
      const saved = JSON.parse(localStorage.getItem('waitlistEmails') || '[]');
      if (!saved.includes(email)) {
        saved.push(email);
        localStorage.setItem('waitlistEmails', JSON.stringify(saved));
      }
      setStatus('success');
      setEmail('');
    } catch {
      setStatus('error');
    }
  };

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
      sx={{
        maxWidth: 400,
        mx: 'auto',
        mt: 4,
        p: 3,
        border: '1px solid',
        borderColor: 'grey.300',
        borderRadius: 2
      }}
    >
      <Typography variant="h5" align="center" gutterBottom>
        Join Our Waitlist
      </Typography>
      <Typography variant="body2" align="center" sx={{ mb: 2 }}>
        Sign up with your email and be first to get access to new features!
      </Typography>
      {status === 'success' && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Thanks! You’re on the waitlist.
        </Alert>
      )}
      {status === 'error' && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Please enter a valid email address.
        </Alert>
      )}
      <TextField
        label="Email Address"
        type="email"
        fullWidth
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        sx={{ mb: 2 }}
      />
      <Button
        type="submit"
        variant="contained"
        fullWidth
      >
        Join Waitlist
      </Button>
    </Box>
  );
}
