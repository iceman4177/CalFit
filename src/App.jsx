// src/App.jsx
import React, { useState, useEffect } from 'react';
import {
  Route,
  Switch,
  Link,
  useLocation,
  useHistory
} from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Button,
  Stack
} from '@mui/material';
import HealthDataForm from './HealthDataForm';
import WorkoutPage from './WorkoutPage';
import WorkoutHistory from './WorkoutHistory';
import ProgressDashboard from './ProgressDashboard';
import Achievements from './Achievements';
import MealTracker from './MealTracker';
import CalorieHistory from './CalorieHistory';
import CalorieSummary from './CalorieSummary';    // ← import updated
import NetCalorieBanner from './NetCalorieBanner';
import { logPageView } from './analytics';

function PageTracker() {
  const location = useLocation();
  useEffect(() => {
    logPageView(location.pathname + location.search);
  }, [location]);
  return null;
}

function App() {
  const history = useHistory();
  const [userData, setUserDataState] = useState(null);
  const [burnedCalories, setBurnedCalories] = useState(0);
  const [consumedCalories, setConsumedCalories] = useState(0);
  const [showHealthForm, setShowHealthForm] = useState(false);

  const setUserData = (data) => {
    localStorage.setItem('userData', JSON.stringify(data));
    setUserDataState(data);
  };

  const refreshCalories = () => {
    const today = new Date().toLocaleDateString('en-US');

    const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const burnedSum = workouts
      .filter((w) => w.date === today)
      .reduce((sum, w) => sum + w.totalCalories, 0);
    setBurnedCalories(burnedSum);

    const meals = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    const todayMeals = meals.find((m) => m.date === today);
    const consumedSum = todayMeals
      ? todayMeals.meals.reduce((sum, meal) => sum + meal.calories, 0)
      : 0;
    setConsumedCalories(consumedSum);
  };

  useEffect(() => {
    const saved = localStorage.getItem('userData');
    if (saved) {
      setUserDataState(JSON.parse(saved));
      setShowHealthForm(false);
    } else {
      setShowHealthForm(true);
    }
    refreshCalories();
  }, []);

  const handleUpdateBurned = () => refreshCalories();
  const handleUpdateConsumed = () => refreshCalories();

  const handleEditInfo = () => {
    setShowHealthForm(true);
    history.push('/edit-info');
  };

  const renderRoot = () =>
    showHealthForm ? (
      <HealthDataForm
        setUserData={(data) => {
          setUserData(data);
          setShowHealthForm(false);
          history.push('/');
        }}
      />
    ) : (
      <Box sx={{ textAlign: 'center', mt: 4 }}>
        <Typography variant="h5">What would you like to do today?</Typography>
        <Stack direction="row" spacing={2} justifyContent="center" sx={{ mt: 2 }}>
          <Button variant="contained" color="primary" component={Link} to="/workout">
            Log Workout
          </Button>
          <Button variant="outlined" color="secondary" component={Link} to="/meals">
            Log Meal
          </Button>
        </Stack>
      </Box>
    );

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <PageTracker />

      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <Typography variant="h2" color="primary">Slimcal.ai</Typography>
        <Typography variant="body1" color="textSecondary">
          Track your workouts, meals, and calories all in one place.
        </Typography>
        <Stack direction="row" spacing={2} justifyContent="center" sx={{ mt: 2, flexWrap: 'wrap' }}>
          <Button variant="contained" component={Link} to="/workout">Log Workout</Button>
          <Button variant="outlined" component={Link} to="/history">History</Button>
          <Button variant="outlined" component={Link} to="/dashboard">Dashboard</Button>
          <Button variant="outlined" component={Link} to="/achievements">Achievements</Button>
          <Button variant="outlined" component={Link} to="/meals">Meals</Button>
          <Button variant="outlined" component={Link} to="/calorie-log">Calorie Log</Button>
          <Button variant="outlined" component={Link} to="/summary">Summary</Button>
          <Button variant="text" color="secondary" onClick={handleEditInfo}>Edit Info</Button>
        </Stack>
      </Box>

      <NetCalorieBanner burned={burnedCalories} consumed={consumedCalories} />

      <Switch>
        <Route
          path="/edit-info"
          render={() => (
            <HealthDataForm
              setUserData={(data) => {
                setUserData(data);
                setShowHealthForm(false);
                history.push('/');
              }}
            />
          )}
        />
        <Route
          path="/workout"
          render={() => (
            <WorkoutPage userData={userData} onWorkoutLogged={handleUpdateBurned} />
          )}
        />
        <Route
          path="/meals"
          render={() => <MealTracker onMealUpdate={handleUpdateConsumed} />}
        />
        <Route
          path="/history"
          render={() => <WorkoutHistory onHistoryChange={refreshCalories} />}
        />
        <Route path="/dashboard" component={ProgressDashboard} />
        <Route path="/achievements" component={Achievements} />
        <Route path="/calorie-log" component={CalorieHistory} />
        <Route
          path="/summary"
          render={() => (
            <CalorieSummary
              burned={burnedCalories}
              consumed={consumedCalories}
            />
          )}
        />
        <Route exact path="/" render={renderRoot} />
      </Switch>
    </Container>
  );
}

export default App;
