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
  Tooltip
} from '@mui/material';

function HealthDataForm({ setUserData }) {
  const history = useHistory();

  const [age, setAge] = useState('');
  const [weight, setWeight] = useState('');
  const [heightFeet, setHeightFeet] = useState('');
  const [heightInches, setHeightInches] = useState('');
  const [activityLevel, setActivityLevel] = useState('');

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

        <form onSubmit={handleSubmit}>
          <Box sx={{ mb: 2 }}>
            <Tooltip title="Your age helps us estimate calories burned">
              <TextField
                label="Age"
                type="number"
                fullWidth
                variant="outlined"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                required
              />
            </Tooltip>
          </Box>

          <Box sx={{ mb: 2 }}>
            <Tooltip title="Used to calculate calories burned">
              <TextField
                label="Weight (lbs)"
                type="number"
                fullWidth
                variant="outlined"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                required
              />
            </Tooltip>
          </Box>

          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <Tooltip title="Height in feet">
              <TextField
                label="Height (feet)"
                type="number"
                variant="outlined"
                fullWidth
                value={heightFeet}
                onChange={(e) => setHeightFeet(e.target.value)}
                required
              />
            </Tooltip>
            <Tooltip title="Additional inches">
              <TextField
                label="Height (inches)"
                type="number"
                variant="outlined"
                fullWidth
                value={heightInches}
                onChange={(e) => setHeightInches(e.target.value)}
                required
              />
            </Tooltip>
          </Box>

          <Box sx={{ mb: 3 }}>
            <Tooltip title="General level of physical activity during the week">
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
            </Tooltip>
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
