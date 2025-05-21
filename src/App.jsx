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
import StreakBanner from './components/StreakBanner';
import UpgradeModal from './components/UpgradeModal';
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
  const history  = useHistory();
  const location = useLocation();

  // first-time tips
  const message = routeTips[location.pathname] || '';
  const [PageTip] = useFirstTimeTip(
    `hasSeenPageTip_${location.pathname}`,
    message,
    { auto: Boolean(message) }
  );

  // user data & premium
  const [userData, setUserDataState] = useState(null);
  const [isPremium, setIsPremium]     = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // calories
  const [burnedCalories, setBurnedCalories]     = useState(0);
  const [consumedCalories, setConsumedCalories] = useState(0);
  const [showHealthForm, setShowHealthForm]     = useState(false);

  // “More” menu anchor
  const [moreAnchor, setMoreAnchor] = useState(null);
  const openMore  = e => setMoreAnchor(e.currentTarget);
  const closeMore = () => setMoreAnchor(null);

  // Persisted setter merges premium flag
  const setUserData = data => {
    const prev = JSON.parse(localStorage.getItem('userData') || '{}');
    const next = { ...prev, ...data, isPremium };
    localStorage.setItem('userData', JSON.stringify(next));
    setUserDataState(next);
  };

  // Load userData + premium + calories on mount
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem('userData') || '{}');
    setUserDataState(saved);
    setIsPremium(saved.isPremium || false);
    setShowHealthForm(!saved.age);   // or your health‑data check
    refreshCalories();
  }, []);

  // Stripe success → grant Pro
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('checkout') === 'success') {
      setIsPremium(true);
      const updated = { ...(userData || {}), isPremium: true };
      localStorage.setItem('userData', JSON.stringify(updated));
      setUserDataState(updated);
      history.replace(location.pathname);
    }
  }, [location.search]);

  // Dev shortcut: visit /dev/grantPro to toggle Pro
  useEffect(() => {
    if (location.pathname === '/dev/grantPro') {
      setIsPremium(true);
      const prev    = JSON.parse(localStorage.getItem('userData') || '{}');
      const updated = { ...prev, isPremium: true };
      localStorage.setItem('userData', JSON.stringify(updated));
      setUserDataState(updated);
      history.replace('/');
    }
  }, [location.pathname]);

  const refreshCalories = () => {
    const today = new Date().toLocaleDateString('en-US');
    const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    setBurnedCalories(
      workouts.filter(w => w.date === today)
              .reduce((sum, w) => sum + w.totalCalories, 0)
    );
    const meals = JSON.parse(localStorage.getItem('mealHistory') || '[]');
    const todayMeals = meals.find(m => m.date === today);
    setConsumedCalories(
      todayMeals ? todayMeals.meals.reduce((sum,m) => sum + m.calories, 0) : 0
    );
  };
  const handleUpdateBurned   = refreshCalories;
  const handleUpdateConsumed = refreshCalories;

  // Navigation bar
  const navBar = (
    <Box sx={{ textAlign: 'center', mb: 3 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={{ xs: 1, sm: 2 }}
        justifyContent="center"
      >
        <Tooltip title="Log Workout">
          <Button
            component={NavLink} to="/workout"
            variant="contained" color="primary"
            startIcon={<FitnessCenterIcon />} sx={{ px: 2 }}
          >Workout</Button>
        </Tooltip>
        <Tooltip title="Log Meal">
          <Button
            component={NavLink} to="/meals"
            variant="contained" color="secondary"
            startIcon={<RestaurantIcon />} sx={{ px: 2 }}
          >Meals</Button>
        </Tooltip>
        <Tooltip title="More options">
          <Button
            onClick={openMore}
            variant="outlined"
            startIcon={<MoreVertIcon />}
            sx={{ px: 2 }}
          >More</Button>
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

        {!isPremium && (
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            onClick={() => setUpgradeOpen(true)}
          >
            Try Pro Free
          </Button>
        )}
      </Box>

      <NetCalorieBanner burned={burnedCalories} consumed={consumedCalories} />
      <StreakBanner />
      {navBar}

      <Switch>
        <Route
          path="/edit-info"
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
        <Route
          path="/workout"
          render={() =>
            <WorkoutPage userData={userData} onWorkoutLogged={handleUpdateBurned} />
          }
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
        <Route
          path="/recap"
          render={() => (
            <DailyRecapCoach userData={{ ...userData, isPremium }} />
          )}
        />
        <Route exact path="/" render={() => null} />
      </Switch>

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
      />
    </Container>
  );
}
