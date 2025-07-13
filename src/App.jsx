// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
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
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
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

import useDailyNotification from './hooks/useDailyNotification';
import useVariableRewards    from './hooks/useVariableRewards';
import useMealReminders      from './hooks/useMealReminders';
import useInAppMealPrompt    from './hooks/useInAppMealPrompt';
import useFirstTimeTip       from './hooks/useFirstTimeTip';

import HealthDataForm    from './HealthDataForm';
import WorkoutPage       from './WorkoutPage';
import WorkoutHistory    from './WorkoutHistory';
import ProgressDashboard from './ProgressDashboard';
import Achievements      from './Achievements';
import MealTracker       from './MealTracker';
import CalorieHistory    from './CalorieHistory';
import CalorieSummary    from './CalorieSummary';
import NetCalorieBanner  from './NetCalorieBanner';
import DailyRecapCoach   from './DailyRecapCoach';
import StreakBanner      from './components/StreakBanner';
import SocialProofBanner from './components/SocialProofBanner';
import WaitlistSignup    from './components/WaitlistSignup';
import AlertPreferences  from './components/AlertPreferences';
import UpgradeModal      from './components/UpgradeModal';
import AmbassadorModal   from './components/AmbassadorModal';
import { logPageView }   from './analytics';

const routeTips = {
  '/edit-info':    'Welcome to Slimcal.ai! First, enter your health info so everything can be personalized.',
  '/workout':      'This is your Workout page: add exercises, calculate & log calories burned.',
  '/meals':        'On the Meals page, search foods or enter calories manually to track intake.',
  '/history':      'Here’s your History: review past workouts & meals at a glance.',
  '/dashboard':    'Dashboard shows your total workouts & calories burned over time.',
  '/achievements': 'Achievements page: hit milestones to unlock badges!',
  '/calorie-log':  'Calorie Log gives you a detailed daily breakdown of intake vs. burn.',
  '/summary':      'Summary page: quick overview of today’s net calories.',
  '/recap':        'Meet your AI Coach: get a friendly recap of today’s workouts & meals!',
  '/waitlist':     'Join our waitlist to get early access to upcoming features!',
  '/preferences':  'Customize when you get meal reminders each day.'
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
  const promptedRef = useRef(false);

  // Request notification permission on first load
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Stripe checkout callback
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('subscribed') === '1') {
      const prev = JSON.parse(localStorage.getItem('userData') || '{}');
      const next = { ...prev, isPremium: true };
      localStorage.setItem('userData', JSON.stringify(next));
      setIsPremium(true);
      window.history.replaceState({}, '', location.pathname);
    }
  }, [location.search]);

  // Daily push notification at 19:00
  useDailyNotification({
    hour:   19,
    minute: 0,
    title:  'Slimcal.ai Reminder',
    body:   '⏰ Don’t forget to log today’s workout & meals!'
  });

  // Variable rewards & browser-based meal reminders
  const workoutsCount = JSON.parse(localStorage.getItem('workoutHistory') || '[]').length;
  const mealsCount    = JSON.parse(localStorage.getItem('mealHistory')   || '[]')
    .reduce((sum, e) => sum + (e.meals?.length || 0), 0);
  useVariableRewards({ workoutsCount, mealsCount });
  useMealReminders();

  // In-app meal reminder prompt (only once, and only post-onboarding)
  const missedMeals = useInAppMealPrompt();
  const [promptOpen, setPromptOpen] = useState(false);
  useEffect(() => {
    if (
      localStorage.getItem('hasCompletedHealthData') === 'true' &&
      !promptedRef.current &&
      missedMeals.length > 0 &&
      location.pathname !== '/meals'
    ) {
      promptedRef.current = true;
      setPromptOpen(true);
    }
  }, [missedMeals, location.pathname]);
  const handleClosePrompt = () => setPromptOpen(false);
  const handleGoToMeals   = () => { setPromptOpen(false); history.push('/meals'); };

  // User & premium state
  const [userData,         setUserDataState]    = useState(null);
  const [isPremium,        setIsPremium]        = useState(false);
  const [burnedCalories,   setBurnedCalories]   = useState(0);
  const [consumedCalories, setConsumedCalories] = useState(0);
  const [upgradeOpen,      setUpgradeOpen]      = useState(false);
  const [ambassadorOpen,   setAmbassadorOpen]   = useState(false);

  // “More” menu
  const [moreAnchor, setMoreAnchor] = useState(null);
  const openMore  = e => setMoreAnchor(e.currentTarget);
  const closeMore = () => setMoreAnchor(null);

  // Persist helper
  const setUserData = data => {
    const prev = JSON.parse(localStorage.getItem('userData') || '{}');
    const next = { ...prev, ...data, isPremium };
    localStorage.setItem('userData', JSON.stringify(next));
    setUserDataState(next);
  };

  // On-mount load & streak
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem('userData') || '{}');
    setUserDataState(saved);
    setIsPremium(!!saved.isPremium);
    refreshCalories();

    if (!saved.age && location.pathname === '/') {
      history.replace('/edit-info');
    }

    const streak = parseInt(localStorage.getItem('streakCount') || '0', 10);
    if (streak >= 30 && !localStorage.getItem('hasSeenAmbassadorInvite')) {
      setAmbassadorOpen(true);
      localStorage.setItem('hasSeenAmbassadorInvite', 'true');
    }
  }, []);

  // Recalculate today's totals
  function refreshCalories() {
    const today     = new Date().toLocaleDateString('en-US');
    const workouts  = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const meals     = JSON.parse(localStorage.getItem('mealHistory')   || '[]');
    const todayMeals = meals.find(m => m.date === today);

    setBurnedCalories(
      workouts.filter(w => w.date === today)
              .reduce((sum, w) => sum + w.totalCalories, 0)
    );
    setConsumedCalories(
      todayMeals ? todayMeals.meals.reduce((sum, m) => sum + m.calories, 0) : 0
    );
  }

  // Page-tip
  const message = routeTips[location.pathname] || '';
  const [PageTip] = useFirstTimeTip(
    `hasSeenPageTip_${location.pathname}`,
    message,
    { auto: Boolean(message) }
  );

  const navBar = (
    <Box sx={{ textAlign:'center', mb:3 }}>
      <Stack direction={{ xs:'column', sm:'row' }} spacing={2} justifyContent="center">
        <Tooltip title="Log Workout">
          <Button component={NavLink} to="/workout" variant="contained" color="primary" startIcon={<FitnessCenterIcon />}>
            Workout
          </Button>
        </Tooltip>
        <Tooltip title="Log Meal">
          <Button component={NavLink} to="/meals" variant="contained" color="secondary" startIcon={<RestaurantIcon />}>
            Meals
          </Button>
        </Tooltip>
        <Tooltip title="More options">
          <Button onClick={openMore} variant="outlined" startIcon={<MoreVertIcon />}>
            More
          </Button>
        </Tooltip>
      </Stack>
      <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={closeMore}>
        <MenuItem component={NavLink} to="/history" onClick={closeMore}><HistoryIcon fontSize="small"/> History</MenuItem>
        <MenuItem component={NavLink} to="/dashboard" onClick={closeMore}><DashboardIcon fontSize="small"/> Dashboard</MenuItem>
        <MenuItem component={NavLink} to="/achievements" onClick={closeMore}><EmojiEventsIcon fontSize="small"/> Achievements</MenuItem>
        <MenuItem component={NavLink} to="/calorie-log" onClick={closeMore}><ListIcon fontSize="small"/> Calorie Log</MenuItem>
        <MenuItem component={NavLink} to="/summary" onClick={closeMore}><AssessmentIcon fontSize="small"/> Summary</MenuItem>
        <MenuItem component={NavLink} to="/recap" onClick={closeMore}><ChatIcon fontSize="small"/> Daily Recap</MenuItem>
        <MenuItem component={NavLink} to="/waitlist" onClick={closeMore}><InfoIcon fontSize="small"/> Join Waitlist</MenuItem>
        <MenuItem component={NavLink} to="/preferences" onClick={closeMore}><InfoIcon fontSize="small"/> Alert Preferences</MenuItem>
        <MenuItem component={NavLink} to="/edit-info" onClick={closeMore}><InfoIcon fontSize="small"/> Edit Info</MenuItem>
      </Menu>
    </Box>
  );

  return (
    <Container maxWidth="md" sx={{ py:4 }}>
      <PageTracker />
      {message && <PageTip />}

      <Dialog open={promptOpen} onClose={handleClosePrompt}>
        <DialogTitle>Meal Reminder</DialogTitle>
        <DialogContent>
          {missedMeals.map(meal => (
            <Typography key={meal}>🍽 Don’t forget to log your <strong>{meal}</strong>!</Typography>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleGoToMeals}>Ok</Button>
        </DialogActions>
      </Dialog>

      <AmbassadorModal open={ambassadorOpen} onClose={() => setAmbassadorOpen(false)} />

      <Box sx={{ textAlign:'center', mb:2 }}>
        <Typography variant="h2" color="primary">Slimcal.ai</Typography>
        <Typography variant="body1" color="textSecondary">
          Track your workouts, meals, and calories all in one place.
        </Typography>
        {!isPremium && (
          <Button variant="contained" sx={{ mt:2 }} onClick={() => setUpgradeOpen(true)}>
            Try Pro Free
          </Button>
        )}
      </Box>

      <NetCalorieBanner burned={burnedCalories} consumed={consumedCalories}/>
      <StreakBanner/>
      <SocialProofBanner/>
      {navBar}

      <Switch>
        <Route path="/edit-info" render={() =>
          <HealthDataForm
            setUserData={data => { setUserData(data); history.push('/'); }}
          />
        }/>
        <Route path="/workout" render={() =>
          <WorkoutPage userData={userData} onWorkoutLogged={refreshCalories}/>
        }/>
        <Route path="/meals"   render={() => <MealTracker   onMealUpdate={refreshCalories}/>} />
        <Route path="/history" render={() => <WorkoutHistory onHistoryChange={refreshCalories}/>} />
        <Route path="/dashboard"    component={ProgressDashboard}/>
        <Route path="/achievements" component={Achievements}/>
        <Route path="/calorie-log"  component={CalorieHistory}/>
        <Route path="/summary"      render={() => <CalorieSummary burned={burnedCalories} consumed={consumedCalories}/>}/>
        <Route path="/recap"        render={() => <DailyRecapCoach userData={{ ...userData, isPremium }}/>}/>
        <Route path="/waitlist"     component={WaitlistSignup}/>
        <Route path="/preferences"  component={AlertPreferences}/>
        <Route exact path="/"       render={() => null}/>
      </Switch>

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        title="Start your 7-Day Free Pro Trial"
        description="Unlimited AI recaps, custom goals, meal suggestions & more—on us!"
      />
    </Container>
  );
}
