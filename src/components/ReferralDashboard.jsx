// src/components/ReferralDashboard.jsx
import React from 'react';
import { Box, Typography, TextField, Button } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';

export default function ReferralDashboard() {
  const code = localStorage.getItem('referralCode') || '';
  const counts = JSON.parse(localStorage.getItem('referralCounts') || '{}');
  const yourCount = counts[code] || 0;

  const shareUrl = `${window.location.origin}${window.location.pathname}?ref=${code}`;
  const copyToClipboard = () => {
    navigator.clipboard.writeText(shareUrl);
  };

  return (
    <Box sx={{ p: 3, mt: 4, border: '1px solid #ddd', borderRadius: 2 }}>
      <Typography variant="h6" gutterBottom>
        Your Referral Link
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <TextField
          value={shareUrl}
          fullWidth
          InputProps={{ readOnly: true }}
        />
        
          <Button onClick={copyToClipboard} variant="outlined">
            <ContentCopyIcon />
          </Button>
        
      </Box>
      <Typography variant="body1">
        Friends joined: <strong>{yourCount}</strong>
      </Typography>
    </Box>
  );
}
