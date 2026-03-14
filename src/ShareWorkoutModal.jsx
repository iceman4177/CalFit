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
  Box,
  Chip,
  alpha,
} from '@mui/material';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import ShareRoundedIcon from '@mui/icons-material/ShareRounded';
import FacebookRoundedIcon from '@mui/icons-material/FacebookRounded';
import InstagramIcon from '@mui/icons-material/Instagram';
import XIcon from '@mui/icons-material/X';
import LinkedInIcon from '@mui/icons-material/LinkedIn';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';

function ShareWorkoutModal({ open, onClose, shareText, shareUrl, exercises = [], totalCalories = 0 }) {
  const builtCaption = React.useMemo(() => {
    const trimmed = String(shareText || '').trim();
    if (trimmed) {
      return /Slimcal/i.test(trimmed)
        ? trimmed
        : `${trimmed}\n\nTracked with Slimcal.ai 💪 #SlimcalAI`;
    }

    const total = Math.max(0, Math.round(Number(totalCalories) || 0));
    const header = total > 0
      ? `🔥 Just crushed my workout — ${total} kcal burned!`
      : `🔥 Just finished my workout!`;

    const body = Array.isArray(exercises) && exercises.length
      ? exercises.map((ex) => {
          const name = ex.exerciseName || ex.name || 'Exercise';
          const sets = Number(ex.sets) || 0;
          const reps = ex.reps != null && ex.reps !== '' ? ex.reps : '';
          const weight = Number(ex.weight) || 0;
          const calories = Number(ex.calories) || 0;
          const volume = sets && reps ? `${sets}×${reps}` : sets ? `${sets} sets` : '';
          const weightText = weight > 0 ? ` @ ${Math.round(weight)} lb` : '';
          const calText = calories > 0 ? ` — ${Math.round(calories)} kcal` : '';
          return `• ${name}${volume ? ` — ${volume}` : ''}${weightText}${calText}`;
        }).join('\n')
      : '';

    return `${header}${body ? `\n${body}` : ''}\n\nTracked with Slimcal.ai 💪 #SlimcalAI`.trim();
  }, [shareText, exercises, totalCalories]);

  const pageUrl = shareUrl || (typeof window !== 'undefined' ? window.location.href : 'https://slimcal.ai');
  const encodedCaption = React.useMemo(() => encodeURIComponent(builtCaption), [builtCaption]);
  const encodedUrl = React.useMemo(() => encodeURIComponent(pageUrl), [pageUrl]);
  const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share;
  const isMobile = typeof window !== 'undefined'
    ? window.matchMedia?.('(max-width: 900px)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')
    : false;

  const copyCaption = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(builtCaption);
      return true;
    } catch {
      return false;
    }
  }, [builtCaption]);

  const openUrl = React.useCallback((url) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const handleNativeShare = React.useCallback(async () => {
    try {
      if (!navigator.share) return;
      await navigator.share({ text: builtCaption, url: pageUrl });
    } catch {}
  }, [builtCaption, pageUrl]);

  const openWithPrefill = React.useCallback(async (platform) => {
    if (canNativeShare && isMobile) {
      if (platform === 'instagram' || platform === 'facebook') {
        await copyCaption();
      }
      await handleNativeShare();
      return;
    }

    switch (platform) {
      case 'x':
        openUrl(`https://twitter.com/intent/tweet?text=${encodedCaption}`);
        break;
      case 'linkedin':
        openUrl(`https://www.linkedin.com/feed/?shareActive=true&text=${encodedCaption}`);
        break;
      case 'whatsapp':
        openUrl(`https://wa.me/?text=${encodeURIComponent(`${builtCaption}\n${pageUrl}`)}`);
        break;
      case 'facebook': {
        await copyCaption();
        openUrl(`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`);
        break;
      }
      case 'instagram': {
        await copyCaption();
        openUrl('https://www.instagram.com/');
        break;
      }
      default:
        break;
    }
  }, [canNativeShare, isMobile, copyCaption, handleNativeShare, openUrl, encodedCaption, builtCaption, pageUrl, encodedUrl]);

  const socialActions = [
    { key: 'x', label: 'X', icon: <XIcon />, color: '#111827' },
    { key: 'linkedin', label: 'LinkedIn', icon: <LinkedInIcon />, color: '#2563eb' },
    { key: 'whatsapp', label: 'WhatsApp', icon: <WhatsAppIcon />, color: '#16a34a' },
    { key: 'facebook', label: 'Facebook', icon: <FacebookRoundedIcon />, color: '#2563eb' },
    { key: 'instagram', label: 'Instagram', icon: <InstagramIcon />, color: '#ec4899' },
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      PaperProps={{
        sx: {
          borderRadius: 4,
          overflow: 'hidden',
          background: 'linear-gradient(180deg, #f8fbff 0%, #ffffff 100%)',
          boxShadow: '0 28px 80px rgba(15, 23, 42, 0.18)',
          border: '1px solid rgba(37,99,235,0.10)',
          mx: { xs: 1.5, sm: 0 },
        },
      }}
    >
      <DialogTitle sx={{ pb: 1.25 }}>
        <Stack spacing={1}>
          <Typography variant="h5" sx={{ fontWeight: 900, color: '#0f172a' }}>
            Share your workout
          </Typography>
          <Typography variant="body2" sx={{ color: 'rgba(15,23,42,0.65)' }}>
            Open a post fast and share your progress with SlimCal style.
          </Typography>
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ pt: 1 }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip label="SlimCal AI" sx={{ fontWeight: 800, bgcolor: alpha('#2563eb', 0.10), color: '#2563eb' }} />
            <Chip label="#SlimcalAI" sx={{ fontWeight: 800, bgcolor: alpha('#0f172a', 0.06), color: '#0f172a' }} />
            {Number(totalCalories) > 0 ? (
              <Chip label={`${Math.round(Number(totalCalories))} kcal`} sx={{ fontWeight: 800, bgcolor: alpha('#22c55e', 0.12), color: '#15803d' }} />
            ) : null}
          </Stack>

          <TextField
            multiline
            fullWidth
            minRows={5}
            variant="outlined"
            value={builtCaption}
            InputProps={{ readOnly: true }}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 3,
                bgcolor: '#ffffff',
                alignItems: 'flex-start',
              },
            }}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
            <Button
              variant="contained"
              startIcon={<ContentCopyRoundedIcon />}
              onClick={copyCaption}
              sx={{
                flex: 1,
                borderRadius: 999,
                fontWeight: 800,
                py: 1.25,
                boxShadow: 'none',
              }}
            >
              Copy caption
            </Button>
            {canNativeShare ? (
              <Button
                variant="outlined"
                startIcon={<ShareRoundedIcon />}
                onClick={handleNativeShare}
                sx={{ flex: 1, borderRadius: 999, fontWeight: 800, py: 1.25 }}
              >
                Share now
              </Button>
            ) : null}
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr 1fr 1fr' },
              gap: 1.25,
            }}
          >
            {socialActions.map((action) => (
              <Button
                key={action.key}
                variant="outlined"
                onClick={() => openWithPrefill(action.key)}
                sx={{
                  minHeight: 88,
                  borderRadius: 3,
                  px: 1.25,
                  py: 1.25,
                  borderColor: alpha(action.color, 0.22),
                  bgcolor: alpha(action.color, 0.05),
                  textTransform: 'none',
                }}
              >
                <Stack spacing={0.75} alignItems="center" justifyContent="center" sx={{ width: '100%' }}>
                  <Box sx={{ color: action.color, display: 'inline-flex', fontSize: 30, lineHeight: 1 }}>
                    {action.icon}
                  </Box>
                  <Typography sx={{ fontWeight: 800, color: '#0f172a', lineHeight: 1.1, textAlign: 'center', fontSize: { xs: 13, sm: 14 } }}>
                    {action.label}
                  </Typography>
                </Stack>
              </Button>
            ))}
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ fontWeight: 800 }}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export default ShareWorkoutModal;
