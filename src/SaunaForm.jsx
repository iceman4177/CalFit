import React, { useState } from 'react';
import {
  Box,
  TextField,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button
} from '@mui/material';

const SaunaForm = ({ saunaTime, saunaTemp, setSaunaTime, setSaunaTemp }) => {
  const [showTimeHelp, setShowTimeHelp] = useState(false);
  const [showTempHelp, setShowTempHelp] = useState(false);

  const handleDismiss = (key, setter) => {
    localStorage.setItem(key, 'true');
    setter(false);
  };

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto', mt: 2 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Sauna Session (Optional)
      </Typography>

      <TextField
        label="Time in Sauna (minutes)"
        type="number"
        value={saunaTime}
        onFocus={() => {
          if (!localStorage.getItem('hasSeenSaunaTimeHelp')) {
            setShowTimeHelp(true);
          }
        }}
        onChange={(e) => setSaunaTime(e.target.value)}
        fullWidth
        sx={{ mb: 2 }}
      />

      <TextField
        label="Temperature (°F)"
        type="number"
        value={saunaTemp}
        onFocus={() => {
          if (!localStorage.getItem('hasSeenSaunaTempHelp')) {
            setShowTempHelp(true);
          }
        }}
        onChange={(e) => setSaunaTemp(e.target.value)}
        fullWidth
        sx={{ mb: 2 }}
      />

      <Dialog open={showTimeHelp} onClose={() => handleDismiss('hasSeenSaunaTimeHelp', setShowTimeHelp)}>
        <DialogTitle>Sauna Time</DialogTitle>
        <DialogContent>
          Enter how long you spent in the sauna to estimate extra calories burned.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => handleDismiss('hasSeenSaunaTimeHelp', setShowTimeHelp)}>Got it</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={showTempHelp} onClose={() => handleDismiss('hasSeenSaunaTempHelp', setShowTempHelp)}>
        <DialogTitle>Sauna Temperature</DialogTitle>
        <DialogContent>
          Higher temperatures burn more calories. Typical saunas range from 150°F to 200°F.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => handleDismiss('hasSeenSaunaTempHelp', setShowTempHelp)}>Got it</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SaunaForm;
