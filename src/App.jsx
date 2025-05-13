// src/App.jsx
import React, { useState, useEffect } from 'react';
import {
  Route,
  Switch,
  NavLink,
  useLocation,
  useHistory
} from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Button,
  Stack,
  Tooltip,
  Menu,
  MenuItem
} from '@mui/material';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import HistoryIcon from '@mui/icons-material/History';
import DashboardIcon from '@mui/icons-material/Dashboard';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import ListIcon from '@mui/icons-material/List';
import AssessmentIcon from '@mui/icons-material/Assessment';
import InfoIcon from '@mui/icons-material/Info';
import ChatIcon from '@mui/icons-material/Chat';

import useFirstTimeTip from './hooks/useFirstTimeTip';
import HealthDataForm from './HealthDataForm';
import WorkoutPage from './WorkoutPage';
import WorkoutHistory from './WorkoutHistory';
import ProgressDashboard from './ProgressDashboard';
import Achievements from './Achievements';
import MealTracker from './MealTracker';
import CalorieHistory from './CalorieHistory';
import CalorieSummary from './CalorieSummary';
import NetCalorieBanner from './NetCalorieBanner';
import DailyRecapCoach from './DailyRecapCoach';
import { logPageView } from './analytics';

// Tip text for each route
const routeTips = {
  '/':             'Welcome to Slimcal.ai! First, enter your health info so everything can be personalized.',
  '/workout':      'This is your Workout page: add exercises, calculate & log calories burned.',
  '/meals':        'On the Meals page, search foods or enter calories manually to track intake.',
  '/history':      'Here’s your History: review past workouts & meals at a glance.',
  '/dashboard':    'Dashboard shows your total workouts & calories burned over time.',
  '/achievements': 'Achievements page: hit milestones to unlock badges!',
  '/calorie-log':  'Calorie Log gives you a detailed daily breakdown of intake vs. burn.',
  '/summary':      'Summary page: quick overview of today’s net calories.',
  '/recap':        'Meet your AI Coach: get a friendly recap of today’s workouts & meals!'
};

function PageTracker() {
  const location = useLocation();
  useEffect(() => {
    logPageView(location.pathname + location.search);
  }, [location]);
  return null;
}

export default function App() {
  const history = useHistory();
  const location = useLocation();

  // Only auto‐trigger if there’s a non‐empty tip
  const message = routeTips[location.pathname] || '';
  const [PageTip] = useFirstTimeTip(
    `hasSeenPageTip_${location.pathname}`,
    message,
    { auto: Boolean(message) }
  );

  const [userData, setUserDataState] = useState(null);
  const [burnedCalories, setBurnedCalories] = useState(0);
  const [consumedCalories, setConsumedCalories] = useState(0);
  const [showHealthForm, setShowHealthForm] = useState(false);

  const [moreAnchor, setMoreAnchor] = useState(null);
  const openMore = e => setMoreAnchor(e.currentTarget);
  const closeMore = () => setMoreAnchor(null);

  const setUserData = data => {
    localStorage.setItem('userData', JSON.stringify(data));
    setUserDataState(data);
  };

  const refreshCalories = () => {
    const today = new Date().toLocaleDateString('en-US');
    const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    setBurnedCalories(
      workouts
        .filter(w => w.date === today)
        .reduce((sum, w) => sum + w.totalCalories, 0)
    );
    const meals = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    const todayMeals = meals.find(m => m.date === today);
    setConsumedCalories(
      todayMeals
        ? todayMeals.meals.reduce((sum, m) => sum + m.calories, 0)
        : 0
    );
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

  const handleUpdateBurned = refreshCalories;
  const handleUpdateConsumed = refreshCalories;

  const navBar = (
    <Box sx={{ textAlign: 'center', mb: 3 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={{ xs: 1, sm: 2 }}
        justifyContent="center"
      >
        <Tooltip title="Log Workout">
          <Button
            component={NavLink}
            to="/workout"
            variant="contained"
            color="primary"
            startIcon={<FitnessCenterIcon />}
            sx={{ px: 2 }}
          >
            Workout
          </Button>
        </Tooltip>
        <Tooltip title="Log Meal">
          <Button
            component={NavLink}
            to="/meals"
            variant="contained"
            color="secondary"
            startIcon={<RestaurantIcon />}
            sx={{ px: 2 }}
          >
            Meals
          </Button>
        </Tooltip>
        <Tooltip title="More options">
          <Button
            onClick={openMore}
            variant="outlined"
            startIcon={<MoreVertIcon />}
            sx={{ px: 2 }}
          >
            More
          </Button>
        </Tooltip>
      </Stack>
      <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={closeMore}>
        <MenuItem component={NavLink} to="/history" onClick={closeMore}>
          <HistoryIcon fontSize="small" /> History
        </MenuItem>
        <MenuItem component={NavLink} to="/dashboard" onClick={closeMore}>
          <DashboardIcon fontSize="small" /> Dashboard
        </MenuItem>
        <MenuItem component={NavLink} to="/achievements" onClick={closeMore}>
          <EmojiEventsIcon fontSize="small" /> Achievements
        </MenuItem>
        <MenuItem component={NavLink} to="/calorie-log" onClick={closeMore}>
          <ListIcon fontSize="small" /> Calorie Log
        </MenuItem>
        <MenuItem component={NavLink} to="/summary" onClick={closeMore}>
          <AssessmentIcon fontSize="small" /> Summary
        </MenuItem>
        <MenuItem component={NavLink} to="/recap" onClick={closeMore}>
          <ChatIcon fontSize="small" /> Daily Recap
        </MenuItem>
        <MenuItem component={NavLink} to="/edit-info" onClick={closeMore}>
          <InfoIcon fontSize="small" /> Edit Info
        </MenuItem>
      </Menu>
    </Box>
  );

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <PageTracker />
      {message && <PageTip />}

      <Box sx={{ textAlign: 'center', mb: 2 }}>
        <Typography variant="h2" color="primary">
          Slimcal.ai
        </Typography>
        <Typography variant="body1" color="textSecondary">
          Track your workouts, meals, and calories all in one place.
        </Typography>
      </Box>

      {/* Pass dailyGoal into the banner */}
      <NetCalorieBanner
        burned={burnedCalories}
        consumed={consumedCalories}
        goal={userData?.dailyGoal}
      />

      {navBar}

      <Switch>
        <Route
          path="/edit-info"
          render={() => (
            <HealthDataForm
              setUserData={data => {
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
            <CalorieSummary burned={burnedCalories} consumed={consumedCalories} />
          )}
        />
        <Route path="/recap" component={DailyRecapCoach} />
        <Route
          exact
          path="/"
          render={() =>
            showHealthForm ? (
              <HealthDataForm
                setUserData={data => {
                  setUserData(data);
                  setShowHealthForm(false);
                  history.push('/');
                }}
              />
            ) : null
          }
        />
      </Switch>
    </Container>
  );
}
