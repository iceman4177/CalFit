// src/Achievements.jsx

import React, { useEffect, useState } from 'react';
import { Container, Typography, Grid, Card, CardContent, Chip, Box } from '@mui/material';

const staticAchievements = [
  {
    id: 'first_workout',
    name: 'First Workout',
    description: 'Logged your first workout session!',
    condition: (history) => history.length >= 1,
    icon: '🏆'
  },
  {
    id: 'five_workouts',
    name: '5 Workouts Logged',
    description: 'Logged 5 workout sessions!',
    condition: (history) => history.length >= 5,
    icon: '🎖️'
  },
  {
    id: 'ten_workouts',
    name: '10 Workouts Logged',
    description: 'Logged 10 workout sessions!',
    condition: (history) => history.length >= 10,
    icon: '🥇'
  },
  {
    id: '5000_calories',
    name: '5,000 Calories Burned',
    description: 'Burned 5,000 calories in total!',
    condition: (history) =>
      history.reduce((sum, session) => sum + session.totalCalories, 0) >= 5000,
    icon: '🔥'
  },
  {
    id: '10000_calories',
    name: '10,000 Calories Burned',
    description: 'Burned 10,000 calories in total!',
    condition: (history) =>
      history.reduce((sum, session) => sum + session.totalCalories, 0) >= 10000,
    icon: '💪'
  }
];

export default function Achievements() {
  const [workoutHistory, setWorkoutHistory] = useState([]);
  const [earnedStatic, setEarnedStatic] = useState([]);
  const [randomBadges, setRandomBadges] = useState([]);

  useEffect(() => {
    // load workout history
    const savedHistory = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    setWorkoutHistory(savedHistory);

    // determine which static achievements are unlocked
    const unlockedStatic = staticAchievements.filter(ach =>
      ach.condition(savedHistory)
    );
    setEarnedStatic(unlockedStatic);

    // load any random “lucky drop” badges
    const rnd = JSON.parse(localStorage.getItem('randomBadges') || '[]');
    setRandomBadges(rnd);
  }, []);

  // merge static + random badges
  const allBadges = [
    ...earnedStatic.map(b => ({ ...b, random: false })),
    ...randomBadges.map(b => ({ ...b, random: true }))
  ];

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h3" align="center" gutterBottom>
        Achievements
      </Typography>

      {allBadges.length === 0 ? (
        <Box textAlign="center" mt={4}>
          <Typography variant="body1">
            No achievements yet. Start logging workouts or meals!
          </Typography>
        </Box>
      ) : (
        <Grid container spacing={2}>
          {allBadges.map(badge => (
            <Grid item xs={12} sm={6} md={4} key={badge.id}>
              <Card
                sx={{
                  position: 'relative',
                  opacity: 1,
                  backgroundColor: '#f9f9f9'
                }}
              >
                <CardContent sx={{ textAlign: 'center', py: 3 }}>
                  <Typography variant="h4">
                    {badge.icon}
                  </Typography>
                  <Typography variant="h6" gutterBottom>
                    {badge.name}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    {badge.description}
                  </Typography>
                  {badge.random && (
                    <Chip
                      label="🎉 Lucky Drop"
                      size="small"
                      sx={{ mt: 1 }}
                    />
                  )}
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Container>
  );
}
