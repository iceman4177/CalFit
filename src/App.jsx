// src/App.jsx
import React, { useState, useEffect } from 'react';
import {
  Route,
  Switch,
  Link,
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

import HealthDataForm from './HealthDataForm';
import WorkoutPage from './WorkoutPage';
import WorkoutHistory from './WorkoutHistory';
import ProgressDashboard from './ProgressDashboard';
import Achievements from './Achievements';
import MealTracker from './MealTracker';
import CalorieHistory from './CalorieHistory';
import CalorieSummary from './CalorieSummary';
import NetCalorieBanner from './NetCalorieBanner';
import { logPageView } from './analytics';

function PageTracker() {
  const location = useLocation();
  useEffect(() => logPageView(location.pathname + location.search), [location]);
  return null;
}

export default function App() {
  const history = useHistory();
  const location = useLocation();

  const [userData, setUserDataState] = useState(null);
  const [burnedCalories, setBurnedCalories] = useState(0);
  const [consumedCalories, setConsumedCalories] = useState(0);
  const [showHealthForm, setShowHealthForm] = useState(false);

  // “More” menu anchor
  const [moreAnchor, setMoreAnchor] = useState(null);
  const openMore = e => setMoreAnchor(e.currentTarget);
  const closeMore = () => setMoreAnchor(null);

  const moreLinks = [
    { to: '/history',      label: 'History',      icon: <HistoryIcon fontSize="small" /> },
    { to: '/dashboard',    label: 'Dashboard',    icon: <DashboardIcon fontSize="small" /> },
    { to: '/achievements', label: 'Achievements', icon: <EmojiEventsIcon fontSize="small" /> },
    { to: '/calorie-log',  label: 'Calorie Log',  icon: <ListIcon fontSize="small" /> },
    { to: '/summary',      label: 'Summary',      icon: <AssessmentIcon fontSize="small" /> },
    { to: '/edit-info',    label: 'Edit Info',    icon: <InfoIcon fontSize="small" /> }
  ];

  const setUserData = data => {
    localStorage.setItem('userData', JSON.stringify(data));
    setUserDataState(data);
  };

  const refreshCalories = () => {
    const today = new Date().toLocaleDateString('en-US');
    const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const burnedSum = workouts
      .filter(w => w.date === today)
      .reduce((sum, w) => sum + w.totalCalories, 0);
    setBurnedCalories(burnedSum);

    const meals = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    const todayMeals = meals.find(m => m.date === today);
    const consumedSum = todayMeals
      ? todayMeals.meals.reduce((sum, m) => sum + m.calories, 0)
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

  // Primary nav always visible under banner
  const navBar = (
    <Box sx={{ textAlign: 'center', mb: 3 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={{ xs: 1, sm: 2 }}
        justifyContent="center"
      >
        <Tooltip title="Log Workout">
          <Button
            component={Link}
            to="/workout"
            variant="contained"
            color="primary"
            startIcon={<FitnessCenterIcon />}
            sx={{ whiteSpace: 'nowrap', px: 2 }}
          >Workout</Button>
        </Tooltip>
        <Tooltip title="Log Meal">
          <Button
            component={Link}
            to="/meals"
            variant="contained"
            color="secondary"
            startIcon={<RestaurantIcon />}
            sx={{ whiteSpace: 'nowrap', px: 2 }}
          >Meals</Button>
        </Tooltip>
        <Tooltip title="More options">
          <Button
            onClick={openMore}
            variant="outlined"
            startIcon={<MoreVertIcon />}
            sx={{ whiteSpace: 'nowrap', px: 2 }}
          >More</Button>
        </Tooltip>
      </Stack>
      <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={closeMore}>
        {moreLinks.map(({ to, label, icon }) => (
          <MenuItem
            key={to}
            component={NavLink}
            to={to}
            exact
            onClick={closeMore}
            sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
          >
            {icon}
            {label}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <PageTracker />

      {/* Header + Banner */}
      <Box sx={{ textAlign: 'center', mb: 2 }}>
        <Typography variant="h2" color="primary">Slimcal.ai</Typography>
        <Typography variant="body1" color="textSecondary">Track your workouts, meals, and calories all in one place.</Typography>
      </Box>
      <NetCalorieBanner burned={burnedCalories} consumed={consumedCalories} />

      {/* Unified Nav Bar */}
      {navBar}

      {/* Routes */}
      <Switch>
        <Route path="/edit-info" render={() => (
          <HealthDataForm
            setUserData={data => { setUserData(data); setShowHealthForm(false); history.push('/'); }}
          />
        )} />
        <Route path="/workout" render={() => (
          <WorkoutPage userData={userData} onWorkoutLogged={handleUpdateBurned} />
        )} />
        <Route path="/meals" render={() => (
          <MealTracker onMealUpdate={handleUpdateConsumed} />
        )} />
        <Route path="/history" render={() => (
          <WorkoutHistory onHistoryChange={refreshCalories} />
        )} />
        <Route path="/dashboard" component={ProgressDashboard} />
        <Route path="/achievements" component={Achievements} />
        <Route path="/calorie-log" component={CalorieHistory} />
        <Route path="/summary" render={() => (
          <CalorieSummary burned={burnedCalories} consumed={consumedCalories} />
        )} />
        <Route exact path="/" render={() => (
          showHealthForm ? (
            <HealthDataForm
              setUserData={data => { setUserData(data); setShowHealthForm(false); history.push('/'); }}
            />
          ) : null
        )} />
      </Switch>
    </Container>
  );
}
