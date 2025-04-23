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

function HealthDataForm({ setUserData }) {
  const history = useHistory();

  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [heightFeet, setHeightFeet] = useState('');
  const [heightInches, setHeightInches] = useState('');
  const [activityLevel, setActivityLevel] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('userData');
    if (saved) {
      const parsed = JSON.parse(saved);
      setAge(parsed.age || '');
      setWeight(parsed.weight || '');
      setHeightFeet(parsed.height?.feet || '');
      setHeightInches(parsed.height?.inches || '');
      setActivityLevel(parsed.activityLevel || '');
    }
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    const userData = {
      age,
      weight,
      height: { feet: heightFeet, inches: heightInches },
      activityLevel
    };
    localStorage.setItem('userData', JSON.stringify(userData));
    setUserData(userData);

    // Set a first-time flag so this form isn't shown again
    localStorage.setItem('hasCompletedHealthData', 'true');

    history.push('/');
  };

  return (
    <Container maxWidth="sm">
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
              onChange={(e) => setAge(e.target.value)}
              fullWidth
              required
            />
          </Box>
          <Box sx={{ mb: 2 }}>
            <TextField
              label="Weight (lbs)"
              type="number"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              fullWidth
              required
            />
          </Box>
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <TextField
              label="Height (feet)"
              type="number"
              value={heightFeet}
              onChange={(e) => setHeightFeet(e.target.value)}
              fullWidth
              required
            />
            <TextField
              label="Height (inches)"
              type="number"
              value={heightInches}
              onChange={(e) => setHeightInches(e.target.value)}
              fullWidth
              required
            />
          </Box>
          <Box sx={{ mb: 3 }}>
            <Select
              value={activityLevel}
              onChange={(e) => setActivityLevel(e.target.value)}
              fullWidth
              displayEmpty
              required
            >
              <MenuItem value="" disabled>Select Activity Level</MenuItem>
              <MenuItem value="sedentary">Sedentary</MenuItem>
              <MenuItem value="light">Light Exercise</MenuItem>
              <MenuItem value="moderate">Moderate Exercise</MenuItem>
              <MenuItem value="intense">Intense Exercise</MenuItem>
            </Select>
          </Box>
          <Button variant="contained" fullWidth type="submit">
            Save & Continue
          </Button>
        </form>
      </Paper>
    </Container>
  );
}

export default HealthDataForm;
