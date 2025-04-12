import React from 'react';
import { Box, TextField, Typography, Tooltip } from '@mui/material';

const SaunaForm = ({ saunaTime, saunaTemp, setSaunaTime, setSaunaTemp }) => {
  return (
    <Box sx={{ maxWidth: 600, mx: 'auto', mt: 2 }}>
      <Typography variant="h5" sx={{ mb: 2 }}>
        Sauna Session (Optional)
      </Typography>

      <Tooltip title="Enter total time spent in the sauna (in minutes)">
        <TextField
          label="Time in Sauna (minutes)"
          type="number"
          value={saunaTime}
          onChange={(e) => setSaunaTime(e.target.value)}
          fullWidth
          sx={{ mb: 2 }}
        />
      </Tooltip>

      <Tooltip title="Temperature of the sauna in Fahrenheit">
        <TextField
          label="Temperature (°F)"
          type="number"
          value={saunaTemp}
          onChange={(e) => setSaunaTemp(e.target.value)}
          fullWidth
          sx={{ mb: 2 }}
        />
      </Tooltip>
    </Box>
  );
};

export default SaunaForm;
