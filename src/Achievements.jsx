// Achievements.jsx
import React, { useEffect, useState } from 'react';
import { Container, Typography, Grid, Card, CardContent } from '@mui/material';

const achievementList = [
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

function Achievements() {
  const [workoutHistory, setWorkoutHistory] = useState([]);
  const [unlockedAchievements, setUnlockedAchievements] = useState([]);

  useEffect(() => {
    const savedHistory = localStorage.getItem('workoutHistory');
    const history = savedHistory ? JSON.parse(savedHistory) : [];
    setWorkoutHistory(history);

    const unlocked = achievementList.filter((ach) => ach.condition(history));
    setUnlockedAchievements(unlocked);
  }, []);

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h3" align="center" gutterBottom>
        Achievements
      </Typography>
      {workoutHistory.length === 0 ? (
        <Typography variant="body1" align="center">
          No achievements yet. Start working out!
        </Typography>
      ) : (
        <Grid container spacing={2}>
          {achievementList.map((achievement) => {
            const isUnlocked = unlockedAchievements.some(
              (unlocked) => unlocked.id === achievement.id
            );
            return (
              <Grid item xs={12} sm={6} md={4} key={achievement.id}>
                <Card
                  sx={{
                    opacity: isUnlocked ? 1 : 0.4,
                    backgroundColor: isUnlocked ? '#e0ffe0' : '#f0f0f0'
                  }}
                >
                  <CardContent>
                    <Typography variant="h4" align="center">
                      {achievement.icon}
                    </Typography>
                    <Typography variant="h6" align="center">
                      {achievement.name}
                    </Typography>
                    <Typography variant="body2" align="center">
                      {achievement.description}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}
    </Container>
  );
}

export default Achievements;
