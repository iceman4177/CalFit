// src/components/SuggestedWorkoutCard.jsx

import React, { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  Typography,
  Button,
  List,
  ListItem,
  Divider
} from '@mui/material';
import { recommendWorkout } from '../utils/workoutRecommender';

export default function SuggestedWorkoutCard({ userData, onAccept }) {
  const [workout, setWorkout] = useState(null);

  // On mount or whenever userData changes, fetch a suggestion
  useEffect(() => {
    const suggestions = recommendWorkout(userData);
    if (suggestions && suggestions.length > 0) {
      setWorkout(suggestions[0]);
    }
  }, [userData]);

  const handleRefresh = () => {
    const suggestions = recommendWorkout(userData);
    if (suggestions && suggestions.length > 0) {
      setWorkout(suggestions[0]);
    }
  };

  if (!workout) return null;

  return (
    <Card sx={{ mb: 4 }}>
      <CardContent>
        <Typography variant="h5">Suggested Workout</Typography>
        <Typography variant="subtitle1" gutterBottom>
          {workout.name}
        </Typography>
        <List dense>
          {workout.exercises.map((ex, i) => (
            <ListItem key={i} sx={{ pl: 0 }}>
              • {ex.exerciseName} — {ex.sets}×{ex.reps}
            </ListItem>
          ))}
        </List>
        <Divider sx={{ my: 2 }} />
        <Button variant="outlined" onClick={handleRefresh}>
          Refresh
        </Button>{' '}
        <Button
          variant="contained"
          onClick={() => {
            if (typeof onAccept === 'function') {
              onAccept(workout);
            }
          }}
        >
          Accept Workout
        </Button>
      </CardContent>
    </Card>
  );
}
