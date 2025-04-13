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
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';

function HealthDataForm({ setUserData }) {
  const history = useHistory();

  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [heightFeet, setHeightFeet] = useState('');
  const [heightInches, setHeightInches] = useState('');
  const [activityLevel, setActivityLevel] = useState('');

  const [showAgeHelp, setShowAgeHelp] = useState(false);
  const [showWeightHelp, setShowWeightHelp] = useState(false);
  const [showHeightHelp, setShowHeightHelp] = useState(false);
  const [showActivityHelp, setShowActivityHelp] = useState(false);

  useEffect(() => {
    const savedData = localStorage.getItem('userData');
    if (savedData) {
      const parsed = JSON.parse(savedData);
      setAge(parsed.age || '');
      setWeight(parsed.weight || '');
      setHeightFeet(parsed.height?.feet || '');
      setHeightInches(parsed.height?.inches || '');
      setActivityLevel(parsed.activityLevel || '');
    }
  }, []);

  const handleDismiss = (key, setter) => {
    localStorage.setItem(key, 'true');
    setter(false);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const userData = {
      age,
      weight,
      height: { feet: heightFeet, inches: heightInches },
      activityLevel
    };
    localStorage.setItem('userData', JSON.stringify(userData));
    setUserData(userData);
    localStorage.removeItem('workoutFinished');
    history.push('/workout');
  };

  return (
    <Container maxWidth="sm">
      <Paper elevation={3} sx={{ p: 4, mt: 4, borderRadius: 2 }}>
        <Typography variant="h4" color="primary" align="center" gutterBottom>
          Enter Your Health Information
        </Typography>

        <form onSubmit={handleSubmit} autoComplete="off">
          <Box sx={{ mb: 2 }}>
            <TextField
              label="Age"
              type="number"
              fullWidth
              variant="outlined"
              autoComplete="off"
              value={age}
              onFocus={() => {
                if (!localStorage.getItem('hasSeenAgeHelp')) setShowAgeHelp(true);
              }}
              onChange={(e) => setAge(e.target.value)}
              required
            />
          </Box>

          <Box sx={{ mb: 2 }}>
            <TextField
              label="Weight (lbs)"
              type="number"
              fullWidth
              variant="outlined"
              autoComplete="off"
              value={weight}
              onFocus={() => {
                if (!localStorage.getItem('hasSeenWeightHelp')) setShowWeightHelp(true);
              }}
              onChange={(e) => setWeight(e.target.value)}
              required
            />
          </Box>

          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <TextField
              label="Height (feet)"
              type="number"
              variant="outlined"
              fullWidth
              autoComplete="off"
              value={heightFeet}
              onFocus={() => {
                if (!localStorage.getItem('hasSeenHeightHelp')) setShowHeightHelp(true);
              }}
              onChange={(e) => setHeightFeet(e.target.value)}
              required
            />
            <TextField
              label="Height (inches)"
              type="number"
              variant="outlined"
              fullWidth
              autoComplete="off"
              value={heightInches}
              onFocus={() => {
                if (!localStorage.getItem('hasSeenHeightHelp')) setShowHeightHelp(true);
              }}
              onChange={(e) => setHeightInches(e.target.value)}
              required
            />
          </Box>

          <Box sx={{ mb: 3 }}>
            <Select
              value={activityLevel}
              onFocus={() => {
                if (!localStorage.getItem('hasSeenActivityHelp')) setShowActivityHelp(true);
              }}
              onChange={(e) => setActivityLevel(e.target.value)}
              displayEmpty
              fullWidth
              variant="outlined"
              required
            >
              <MenuItem value="" disabled>Select Activity Level</MenuItem>
              <MenuItem value="sedentary">Sedentary</MenuItem>
              <MenuItem value="light">Light Exercise</MenuItem>
              <MenuItem value="moderate">Moderate Exercise</MenuItem>
              <MenuItem value="intense">Intense Exercise</MenuItem>
            </Select>
          </Box>

          <Button variant="contained" color="primary" fullWidth type="submit">
            Save Health Data
          </Button>
        </form>
      </Paper>

      {/* Helper Popups */}
      <Dialog open={showAgeHelp} onClose={() => handleDismiss('hasSeenAgeHelp', setShowAgeHelp)}>
        <DialogTitle>Why Age Matters</DialogTitle>
        <DialogContent>Your age helps us estimate your calorie burn more accurately.</DialogContent>
        <DialogActions>
          <Button onClick={() => handleDismiss('hasSeenAgeHelp', setShowAgeHelp)}>Got it</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={showWeightHelp} onClose={() => handleDismiss('hasSeenWeightHelp', setShowWeightHelp)}>
        <DialogTitle>Enter Your Weight</DialogTitle>
        <DialogContent>We use your weight to personalize your calorie estimates for workouts and sauna use.</DialogContent>
        <DialogActions>
          <Button onClick={() => handleDismiss('hasSeenWeightHelp', setShowWeightHelp)}>Got it</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={showHeightHelp} onClose={() => handleDismiss('hasSeenHeightHelp', setShowHeightHelp)}>
        <DialogTitle>Height Input</DialogTitle>
        <DialogContent>Helps fine-tune your metrics for future features like BMI or visual progress tracking.</DialogContent>
        <DialogActions>
          <Button onClick={() => handleDismiss('hasSeenHeightHelp', setShowHeightHelp)}>Got it</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={showActivityHelp} onClose={() => handleDismiss('hasSeenActivityHelp', setShowActivityHelp)}>
        <DialogTitle>Pick Activity Level</DialogTitle>
        <DialogContent>This sets your default calorie burn assumptions and will evolve as you track workouts.</DialogContent>
        <DialogActions>
          <Button onClick={() => handleDismiss('hasSeenActivityHelp', setShowActivityHelp)}>Got it</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default HealthDataForm;
