// WorkoutHistory.jsx
import React, { useState, useEffect } from 'react';
import {
  Container,
  Typography,
  Box,
  Button,
  List,
  ListItem,
  ListItemText,
  Divider
} from '@mui/material';
import { useHistory } from 'react-router-dom';

const WorkoutHistory = ({ onHistoryChange }) => {
  const [workoutHistory, setWorkoutHistory] = useState([]);
  const historyNav = useHistory();

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    setWorkoutHistory(saved);
  }, []);

  const handleClearHistory = () => {
    localStorage.removeItem('workoutHistory');
    setWorkoutHistory([]);
    onHistoryChange();
  };

  const handleDeleteWorkout = (index) => {
    const updated = workoutHistory.filter((_, i) => i !== index);
    setWorkoutHistory(updated);
    localStorage.setItem('workoutHistory', JSON.stringify(updated));
    onHistoryChange();
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" align="center" gutterBottom>
        Workout History
      </Typography>

      {workoutHistory.length === 0 ? (
        <Typography align="center" color="textSecondary">
          No past workouts recorded.
        </Typography>
      ) : (
        <List>
          {workoutHistory.map((w, idx) => (
            <Box key={idx}>
              <ListItem
                secondaryAction={
                  <Button
                    variant="outlined"
                    color="error"
                    onClick={() => handleDeleteWorkout(idx)}
                  >
                    Delete
                  </Button>
                }
              >
                <ListItemText
                  primary={`Workout on ${w.date}`}
                  secondary={
                    <>
                      <Typography variant="body2">
                        Total Calories Burned: {w.totalCalories.toFixed(2)}
                      </Typography>
                      <Typography variant="body2">Exercises:</Typography>
                      <ul>
                        {w.exercises.map((ex, i) => (
                          <li key={i}>
                            {ex.name} – {ex.sets}×{ex.reps} ({ex.calories.toFixed(2)} cals)
                          </li>
                        ))}
                      </ul>
                    </>
                  }
                />
              </ListItem>
              <Divider />
            </Box>
          ))}
        </List>
      )}

      {workoutHistory.length > 0 && (
        <Box sx={{ textAlign: 'center', mt: 3 }}>
          <Button
            variant="contained"
            color="secondary"
            onClick={handleClearHistory}
          >
            Clear History
          </Button>
        </Box>
      )}

      <Box sx={{ textAlign: 'center', mt: 3 }}>
        <Button
          variant="contained"
          color="primary"
          onClick={() => historyNav.push('/workout')}
        >
          Back to Workout
        </Button>
      </Box>
    </Container>
  );
};

export default WorkoutHistory;
