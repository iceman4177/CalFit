import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import {
  Box,
  Button,
  Container,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography
} from '@mui/material';
import useFirstTimeTip from './hooks/useFirstTimeTip';

export default function HealthDataForm({ setUserData }) {
  const history = useHistory();

  // Manual tips + dropdown control
  const [AgeTip, triggerAgeTip] = useFirstTimeTip('tip_age', 'Enter your age to personalize calculations.');
  const [WeightTip, triggerWeightTip] = useFirstTimeTip('tip_weight', 'Enter your weight (lbs).');
  const [FeetTip, triggerFeetTip] = useFirstTimeTip('tip_heightFeet', 'Enter height in feet.');
  const [InchesTip, triggerInchesTip] = useFirstTimeTip('tip_heightInches', 'Enter height in inches.');
  const [ActivityTip, triggerActivityTip] = useFirstTimeTip('tip_activityLevel', 'Select your activity level.');
  const [activityOpen, setActivityOpen] = useState(false);

  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [heightFeet, setHeightFeet] = useState('');
  const [heightInches, setHeightInches] = useState('');
  const [activityLevel, setActivityLevel] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('userData');
    if (saved) {
      const p = JSON.parse(saved);
      setAge(p.age || '');
      setWeight(p.weight || '');
      setHeightFeet(p.height?.feet || '');
      setHeightInches(p.height?.inches || '');
      setActivityLevel(p.activityLevel || '');
    }
  }, []);

  const handleSubmit = e => {
    e.preventDefault();
    const data = {
      age,
      weight,
      height: { feet: heightFeet, inches: heightInches },
      activityLevel
    };
    localStorage.setItem('userData', JSON.stringify(data));
    setUserData(data);
    localStorage.setItem('hasCompletedHealthData', 'true');
    history.push('/');
  };

  return (
    <Container maxWidth="sm">
      <AgeTip />
      <WeightTip />
      <FeetTip />
      <InchesTip />
      <ActivityTip />

      <Paper elevation={3} sx={{ p: 4, mt: 4, borderRadius: 2 }}>
        <Typography variant="h4" align="center" gutterBottom>
          Enter Your Health Info
        </Typography>
        <form onSubmit={handleSubmit} autoComplete="off">
          <Box sx={{ mb: 2 }}>
            <TextField
              label="Age"
              type="number"
              value={age}
              onFocus={() => triggerAgeTip()}
              onChange={e => setAge(e.target.value)}
              fullWidth required
            />
          </Box>
          <Box sx={{ mb: 2 }}>
            <TextField
              label="Weight (lbs)"
              type="number"
              value={weight}
              onFocus={() => triggerWeightTip()}
              onChange={e => setWeight(e.target.value)}
              fullWidth required
            />
          </Box>
          <Box sx={{ display:'flex', gap:2, mb:2 }}>
            <TextField
              label="Height (feet)"
              type="number"
              value={heightFeet}
              onFocus={() => triggerFeetTip()}
              onChange={e => setHeightFeet(e.target.value)}
              fullWidth required
            />
            <TextField
              label="Height (inches)"
              type="number"
              value={heightInches}
              onFocus={() => triggerInchesTip()}
              onChange={e => setHeightInches(e.target.value)}
              fullWidth required
            />
          </Box>
          <Box sx={{ mb: 3 }}>
            <Select
              open={activityOpen}
              onOpen={() => triggerActivityTip(() => setActivityOpen(true))}
              onClose={() => setActivityOpen(false)}
              value={activityLevel}
              onChange={e => setActivityLevel(e.target.value)}
              fullWidth displayEmpty required
            >
              <MenuItem value="" disabled>Select Activity Level</MenuItem>
              <MenuItem value="sedentary">Sedentary</MenuItem>
              <MenuItem value="light">Light Exercise</MenuItem>
              <MenuItem value="moderate">Moderate Exercise</MenuItem>
              <MenuItem value="intense">Intense Exercise</MenuItem>
            </Select>
          </Box>
          <Button variant="contained" fullWidth type="submit">
            Save &amp; Continue
          </Button>
        </form>
      </Paper>
    </Container>
  );
}
