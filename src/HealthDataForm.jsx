import React, { useState, useEffect } from 'react';
import { useHistory } from 'react-router-dom'; // For React Router v5
import { Box, Button, Container, MenuItem, Paper, Select, TextField, Typography } from '@mui/material';

function HealthDataForm({ setUserData }) {
  const history = useHistory();

  // Local state for health data
  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [heightFeet, setHeightFeet] = useState('');
  const [heightInches, setHeightInches] = useState('');
  const [activityLevel, setActivityLevel] = useState('');

  // On mount, load saved health data from localStorage (if available)
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

  const handleSubmit = (event) => {
    event.preventDefault();
    const userData = {
      age,
      weight,
      height: { feet: heightFeet, inches: heightInches },
      activityLevel,
    };

    // Save to localStorage and update state
    localStorage.setItem('userData', JSON.stringify(userData));
    setUserData(userData);

    // Remove any finished flag from previous sessions
    localStorage.removeItem('workoutFinished');

    // Navigate to the Workout page
    history.push('/workout');
  };

  return (
    <Container maxWidth="sm">
      <Paper elevation={3} sx={{ p: 4, mt: 4, borderRadius: 2 }}>
        <Typography variant="h4" color="primary" align="center" gutterBottom>
          Enter Your Health Information
        </Typography>

        <form onSubmit={handleSubmit}>
          <Box sx={{ mb: 2 }}>
            <TextField
              label="Age"
              type="number"
              fullWidth
              variant="outlined"
              value={age}
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
              value={weight}
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
              value={heightFeet}
              onChange={(e) => setHeightFeet(e.target.value)}
              required
            />
            <TextField
              label="Height (inches)"
              type="number"
              variant="outlined"
              fullWidth
              value={heightInches}
              onChange={(e) => setHeightInches(e.target.value)}
              required
            />
          </Box>

          <Box sx={{ mb: 3 }}>
            <Select
              value={activityLevel}
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
    </Container>
  );
}

export default HealthDataForm;
