// src/components/WaitlistSignup.jsx

import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Container,
  FormControlLabel,
  Paper,
  Stack,
  TextField,
  Typography,
  Alert
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ShareIcon from '@mui/icons-material/Share';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

// Optional: if you want the signed-in user email
import { useAuth } from '../context/AuthProvider.jsx';

function getPrefill() {
  const ud = JSON.parse(localStorage.getItem('userData') || '{}');
  const streak = Number(ud.currentStreak || 0);
  const name = ud.name || '';
  const emailLocal = ud.email || ''; // in case you saved it locally before
  return { streak, name, emailLocal };
}

export default function WaitlistSignup() {
  const { user } = useAuth();
  const { streak, name: nameLocal, emailLocal } = useMemo(getPrefill, []);
  const [name, setName] = useState(nameLocal || '');
  const [email, setEmail] = useState(user?.email || emailLocal || '');
  const [handle, setHandle] = useState('');
  const [why, setWhy] = useState('');
  const [consent, setConsent] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState('');

  // Share text & link
  const shareText = useMemo(() => {
    const days = streak > 0 ? `${streak}-day streak` : `my streak`;
    return `I just hit a ${days} on Slimcal.ai! Join me and track your transformation → slimcal.ai #SlimcalAmbassador`;
  }, [streak]);

  const twitterIntent = useMemo(() => {
    const url = new URL('https://twitter.com/intent/tweet');
    url.searchParams.set('text', shareText);
    return url.toString();
  }, [shareText]);

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setError('');
    } catch {
      setError('Could not copy to clipboard. You can manually copy the text above.');
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!name || !email || !consent) {
      setError('Please complete name, email, and consent.');
      return;
    }
    setSubmitting(true);
    try {
      const clientId = localStorage.getItem('clientId') || null;
      const payload = {
        user_id: user?.id || null,
        email,
        name,
        handle,
        why,
        streak: Number(streak) || 0,
        client_id: clientId,
        source: 'waitlist_form',
        joined_at: new Date().toISOString(),
      };
      const resp = await fetch('/api/ambassador-interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // Don’t block UX on non-200 — still show success if API is reachable
      if (!resp.ok) {
        // Try best-effort parse to surface server message if helpful
        try {
          const j = await resp.json();
          // If server returned a structured error, show but still allow completion
          if (j?.error) setError(`Saved locally. Server note: ${j.error}`);
        } catch {
          /* ignore */
        }
      }

      // Mark locally they joined the list
      const ud = JSON.parse(localStorage.getItem('userData') || '{}');
      ud.ambassadorInterested = true;
      localStorage.setItem('userData', JSON.stringify(ud));
      setOk(true);
    } catch (err) {
      // Fallback: open your Google Form so we still capture the lead
      window.open('https://forms.gle/ambassador-interest-form', '_blank');
      setOk(true);
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    // Soft prefill user name if you store it elsewhere later
  }, []);

  if (ok) {
    return (
      <Container maxWidth="sm" sx={{ py: 6 }}>
        <Paper elevation={2} sx={{ p: 4, textAlign: 'center' }}>
          <CheckCircleIcon color="success" sx={{ fontSize: 48, mb: 1 }} />
          <Typography variant="h4" gutterBottom>
            You’re on the Ambassador List 🎉
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            We’ll email you with early rewards and free Pro access opportunities.
            Share your streak now to inspire others.
          </Typography>

          <Paper variant="outlined" sx={{ p: 2, textAlign: 'left', mb: 2 }}>
            <Typography sx={{ whiteSpace: 'pre-wrap' }}>{shareText}</Typography>
          </Paper>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center">
            <Button
              variant="contained"
              startIcon={<ContentCopyIcon />}
              onClick={copyShare}
            >
              Copy Share Text
            </Button>
            <Button
              variant="outlined"
              startIcon={<ShareIcon />}
              onClick={() => window.open(twitterIntent, '_blank')}
            >
              Share on X/Twitter
            </Button>
          </Stack>

          <Typography variant="body2" sx={{ mt: 3 }} color="text.secondary">
            Tip: Post your streak to IG/Stories and tag <strong>@slimcal.ai</strong> for an early spotlight.
          </Typography>
        </Paper>
      </Container>
    );
  }

  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Paper elevation={2} sx={{ p: 4 }}>
        <Typography variant="h4" gutterBottom align="center">
          Slimcal Ambassador Program
        </Typography>
        <Typography color="text.secondary" align="center" sx={{ mb: 3 }}>
          You’ve logged {streak || 0} days — that’s elite consistency. Join our early ambassador list to get rewards and first access.
        </Typography>

        {error && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box component="form" onSubmit={onSubmit}>
          <Stack spacing={2}>
            <TextField
              label="Name"
              fullWidth
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <TextField
              label="Email"
              type="email"
              fullWidth
              value={email}
              onChange={e => setEmail(e.target.value)}
              helperText={user?.email ? 'Prefilled from your account' : ''}
            />
            <TextField
              label="Instagram/TikTok Handle (optional)"
              fullWidth
              value={handle}
              onChange={e => setHandle(e.target.value)}
            />
            <TextField
              label="Why would you be a great ambassador? (optional)"
              multiline
              minRows={3}
              fullWidth
              value={why}
              onChange={e => setWhy(e.target.value)}
            />
            <FormControlLabel
              control={<Checkbox checked={consent} onChange={e => setConsent(e.target.checked)} />}
              label="I agree to be contacted about rewards and early access."
            />

            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={submitting}
            >
              {submitting ? 'Submitting…' : 'Join the Ambassador List'}
            </Button>
          </Stack>
        </Box>

        <Box sx={{ mt: 4 }}>
          <Typography variant="subtitle2" gutterBottom>Share your streak</Typography>
          <Paper variant="outlined" sx={{ p: 2, mb: 1 }}>
            <Typography sx={{ whiteSpace: 'pre-wrap' }}>{shareText}</Typography>
          </Paper>
          <Stack direction="row" spacing={2}>
            <Button
              variant="outlined"
              startIcon={<ContentCopyIcon />}
              onClick={copyShare}
            >
              Copy Text
            </Button>
            <Button
              variant="outlined"
              startIcon={<ShareIcon />}
              onClick={() => window.open(twitterIntent, '_blank')}
            >
              Share on X/Twitter
            </Button>
          </Stack>
        </Box>
      </Paper>
    </Container>
  );
}
