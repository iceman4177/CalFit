import React from 'react';
import {
  Box,
  TextField,
  Typography
} from '@mui/material';
import useFirstTimeTip from './hooks/useFirstTimeTip';

export default function SaunaForm({ saunaTime, saunaTemp, setSaunaTime, setSaunaTemp }) {
  const [TimeTip, triggerTimeTip] = useFirstTimeTip('tip_saunaTime', 'Enter minutes in sauna.');
  const [TempTip, triggerTempTip] = useFirstTimeTip('tip_saunaTemp', 'Enter temperature (°F).');

  return (
    <Box sx={{ maxWidth:600, mx:'auto', mt:2 }}>
      <Typography variant="h5" sx={{ mb:2 }}>
        Sauna Session (Optional)
      </Typography>

      <TimeTip />
      <TempTip />

      <TextField
        label="Time in Sauna (min)"
        type="number"
        value={saunaTime}
        onFocus={() => triggerTimeTip()}
        onChange={e=>setSaunaTime(e.target.value)}
        fullWidth sx={{ mb:2 }}
      />
      <TextField
        label="Temperature (°F)"
        type="number"
        value={saunaTemp}
        onFocus={() => triggerTempTip()}
        onChange={e=>setSaunaTemp(e.target.value)}
        fullWidth sx={{ mb:2 }}
      />
    </Box>
  );
}
