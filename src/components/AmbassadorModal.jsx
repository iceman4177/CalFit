// src/components/AmbassadorModal.jsx
import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  TextField,
  Box
} from '@mui/material';

export default function AmbassadorModal({ open, onClose, user, streak }) {
  const [submitting, setSubmitting] = React.useState(false);
  const [email, setEmail] = React.useState('');
  const [name, setName] = React.useState('');
  const [error, setError] = React.useState('');

  const hasAuthedEmail = Boolean(user?.email);
  const emailToUse = hasAuthedEmail ? user.email : email.trim();

  React.useEffect(() => {
    if (!open) {
      // reset form state when modal is closed
      setSubmitting(false);
      setEmail('');
      setName('');
      setError('');
    }
  }, [open]);

  async function handleInterested() {
    if (submitting) return;

    // Basic validation (only needed when not signed in)
    if (!hasAuthedEmail) {
      if (!emailToUse || !emailToUse.includes('@')) {
        setError('Please enter a valid email.');
        return;
      }
    }

    setError('');
    setSubmitting(true);

    try {
      const clientId = localStorage.getItem('clientId') || null;

      const resp = await fetch('/api/ambassador-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user?.id || null,
          email: emailToUse || null,
          streak: Number(streak) || 0,
          client_id: clientId,
          joined_at: new Date().toISOString(),
          // Optional: store a name if provided when logged out
          name: name || null,
        }),
      });

      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        // Surface server error so we can iterate quickly
        throw new Error(json?.error || 'Submit failed');
      }

      // Optional local marker so we can avoid re-prompting
      const data = JSON.parse(localStorage.getItem('userData') || '{}');
      data.ambassadorInterested = true;
      localStorage.setItem('userData', JSON.stringify(data));

      onClose();
      // Navigate to the success/waitlist page
      window.location.assign('/waitlist');
    } catch (err) {
      console.error('[AmbassadorModal] submit failed:', err);
      setError('Could not join the Ambassador list. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>🎉 You Hit a 30-Day Streak!</DialogTitle>

      <DialogContent>
        <Typography gutterBottom>
          You’ve been crushing it for 30 days straight—amazing work!
        </Typography>
        <Typography gutterBottom sx={{ mb: 2 }}>
          We’d love to feature power users like you. Would you be interested in
          becoming a Slimcal.ai ambassador?
        </Typography>

        {!hasAuthedEmail && (
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              fullWidth
              required
            />
            <TextField
              label="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
            />
            {error && (
              <Typography color="error" variant="body2">
                {error}
              </Typography>
            )}
          </Box>
        )}

        {hasAuthedEmail && error && (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            {error}
          </Typography>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          Maybe Later
        </Button>
        <Button
          onClick={handleInterested}
          variant="contained"
          color="primary"
          disabled={submitting}
        >
          {submitting ? 'Sending…' : 'I’m Interested!'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
