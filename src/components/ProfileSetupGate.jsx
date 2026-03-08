import React from 'react';
import { useHistory } from 'react-router-dom';
import { Box, Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material';

export default function ProfileSetupGate({
  title = 'Complete your profile first',
  body = 'Finish your profile so SlimCal can personalize calories, AI insights, and recommendations accurately.',
  ctaLabel = 'Complete Profile',
  secondaryLabel = 'Back Home',
}) {
  const history = useHistory();

  return (
    <Box sx={{ minHeight: 'calc(100vh - 160px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Card sx={{ width: '100%', maxWidth: 560, borderRadius: 4, boxShadow: '0 24px 60px rgba(0,0,0,0.14)' }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack spacing={2}>
            <Chip label="30-second setup" color="primary" sx={{ alignSelf: 'flex-start', fontWeight: 800 }} />
            <Typography variant="h4" sx={{ fontWeight: 1000, letterSpacing: -0.6 }}>
              {title}
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {body}
            </Typography>
            <Box sx={{ p: 2, borderRadius: 3, bgcolor: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.18)' }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                SlimCal uses your age, body stats, activity, and goal to make AI features feel personal instead of generic.
              </Typography>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              <Button variant="contained" size="large" onClick={() => history.push('/edit-info')} sx={{ fontWeight: 900, borderRadius: 999 }}>
                {ctaLabel}
              </Button>
              <Button variant="outlined" size="large" onClick={() => history.push('/')} sx={{ fontWeight: 800, borderRadius: 999 }}>
                {secondaryLabel}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
