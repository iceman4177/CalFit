// WorkoutHistory.jsx - Displays past workouts
import React, { useState, useEffect } from 'react';
import { Container, Typography, Box, Button, List, ListItem, ListItemText, Divider } from '@mui/material';
import { useHistory } from 'react-router-dom';

const WorkoutHistory = () => {
  const [workoutHistory, setWorkoutHistory] = useState([]);
  const history = useHistory();

  useEffect(() => {
    const savedHistory = localStorage.getItem('workoutHistory');
    if (savedHistory) {
      setWorkoutHistory(JSON.parse(savedHistory));
    }
  }, []);

  const handleClearHistory = () => {
    localStorage.removeItem('workoutHistory');
    setWorkoutHistory([]);
  };

  const handleDeleteWorkout = (index) => {
    const updatedHistory = workoutHistory.filter((_, i) => i !== index);
    setWorkoutHistory(updatedHistory);
    localStorage.setItem('workoutHistory', JSON.stringify(updatedHistory));
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
          {workoutHistory.map((workout, index) => (
            <Box key={index}>
              <ListItem>
                <ListItemText
                  primary={`Workout on ${workout.date}`}
                  secondary={
                    <>
                      <Typography variant="body2">
                        Total Calories Burned: {workout.totalCalories.toFixed(2)}
                      </Typography>
                      <Typography variant="body2">
                        Exercises:
                      </Typography>
                      <ul>
                        {workout.exercises.map((ex, i) => (
                          <li key={i}>
                            {ex.name} - {ex.sets} sets x {ex.reps} reps ({ex.calories.toFixed(2)} cals)
                          </li>
                        ))}
                      </ul>
                    </>
                  }
                />
                <Button variant="outlined" color="error" onClick={() => handleDeleteWorkout(index)}>
                  Delete
                </Button>
              </ListItem>
              <Divider />
            </Box>
          ))}
        </List>
      )}
      {workoutHistory.length > 0 && (
        <Box sx={{ textAlign: 'center', mt: 3 }}>
          <Button variant="contained" color="secondary" onClick={handleClearHistory}>
            Clear History
          </Button>
        </Box>
      )}
      <Box sx={{ textAlign: 'center', mt: 3 }}>
        <Button variant="contained" color="primary" onClick={() => history.push('/workout')}>
          Back to Workout
        </Button>
      </Box>
    </Container>
  );
};

export default WorkoutHistory;
