import React, { useEffect } from 'react';
import { Container, Typography, Button, Box } from '@mui/material';

export default function ProSuccess() {
  useEffect(() => {
    // Persist the Pro status
    localStorage.setItem('isPro', 'true');
  }, []);

  return (
    <Container maxWidth="sm" sx={{ py: 8, textAlign: 'center' }}>
      <Typography variant="h3" gutterBottom>
        🎉 Welcome to Slimcal Pro!
      </Typography>
      <Typography variant="subtitle1" sx={{ mb: 4 }}>
        Your intelligent fitness journey just level-upped.
      </Typography>
      
      <Button
        variant="contained"
        size="large"
        onClick={() => window.location.href = '/'}
      >
        Go to Dashboard
      </Button>
    </Container>
  );
}
