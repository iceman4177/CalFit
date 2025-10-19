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
  DialogActions,
  Fab
} from '@mui/material';
import CampaignIcon      from '@mui/icons-material/Campaign';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import RestaurantIcon    from '@mui/icons-material/Restaurant';
import MoreVertIcon      from '@mui/icons-material/MoreVert';
import HistoryIcon       from '@mui/icons-material/History';
import DashboardIcon     from '@mui/icons-material/Dashboard';
import EmojiEventsIcon   from '@mui/icons-material/EmojiEvents';
import ListIcon          from '@mui/icons-material/List';
import AssessmentIcon    from '@mui/icons-material/Assessment';
import InfoIcon          from '@mui/icons-material/Info';
import ChatIcon          from '@mui/icons-material/Chat';

import ProLandingPage from './ProLandingPage';
import ProSuccess     from './ProSuccess';
import AuthCallback   from './AuthCallback';

import useDailyNotification from './hooks/useDailyNotification';
import useVariableRewards    from './hooks/useVariableRewards';
import useMealReminders      from './hooks/useMealReminders';
import useInAppMealPrompt    from './hooks/useInAppMealPrompt';
import useFirstTimeTip       from './hooks/useFirstTimeTip';
import useReferral           from './hooks/useReferral';

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
import ReferralDashboard from './components/ReferralDashboard';
import { logPageView }   from './analytics';

import { useEntitlements } from './context/EntitlementsContext.jsx';
import { supabase }        from './lib/supabaseClient';

// Streak helpers
import {
  shouldShowAmbassadorOnce,
  markAmbassadorShown,
  getStreak,
  updateStreak,
  hydrateStreakOnStartup,
} from './utils/streak';

const routeTips = {
  '/edit-info':    'Welcome to Slimcal.ai! Enter your health info to get started.',
  '/workout':      'This is your Workout page: log exercises & calories burned.',
  '/meals':        'Track your meals here: search foods or add calories manually.',
  '/history':      'View your past workouts & meals at a glance.',
  '/dashboard':    'Dashboard: see trends and invite friends below.',
  '/achievements': 'Achievements: hit milestones to unlock badges!',
  '/calorie-log':  'Calorie Log: detailed daily breakdown of intake vs burn.',
  '/summary':      'Summary: quick overview of today’s net calories.',
  '/recap':        'Daily Recap: your AI coach summarizes your progress!',
  '/waitlist':     'Join our waitlist for early access to new features!',
  '/preferences':  'Customize when you get meal reminders each day.'
};

function PageTracker() {
  const location = useLocation();
  useEffect(() => {
    logPageView(location.pathname + location.search);
  }, [location]);
  return null;
}

function getOrCreateClientId() {
  let cid = localStorage.getItem('clientId');
  if (!cid) {
    cid = crypto?.randomUUID?.() || String(Date.now());
    localStorage.setItem('clientId', cid);
  }
  return cid;
}

async function waitForSupabaseUser(maxMs = 10000, stepMs = 250) {
  const start = Date.now();
  for (;;) {
    const { data, error } = await supabase.auth.getUser();
    if (data?.user && !error) return data.user;
    if (Date.now() - start > maxMs) return null;
    // eslint-disable-next-line no-await-loops/no-await-in-loop
    await new Promise(r => setTimeout(r, stepMs));
  }
}

// --- NEW: identity sender ---------------------------------------------
function parseUtm(search) {
  const params = new URLSearchParams(search || '');
  return {
    utm_source: params.get('utm_source'),
    utm_medium: params.get('utm_medium'),
    utm_campaign: params.get('utm_campaign'),
  };
}

async function sendIdentity({
  user,
  path,
  isProActive,
  planStatus
}) {
  try {
    const clientId = getOrCreateClientId();
    const { utm_source, utm_medium, utm_campaign } = parseUtm(window.location.search);
    const payload = {
      user_id: user?.id || null,
      email: user?.email || null,
      full_name: user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? null,
      client_id: clientId,
      last_path: path || '/',
      is_pro: !!isProActive,
      plan_status: planStatus || null,
      source: 'web',
      utm_source,
      utm_medium,
      utm_campaign,
      referrer: document.referrer || null,
      user_agent: navigator.userAgent || null,
    };

    await fetch('/api/identify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error('[identify] failed', err);
  }
}
// ----------------------------------------------------------------------

export default function App() {
  const history      = useHistory();
  const location     = useLocation();
  const promptedRef  = useRef(false);
  const autoRunRef   = useRef(false);

  useReferral();

  // Auth state
  const [authUser, setAuthUser] = useState(null);
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (mounted) setAuthUser(data?.user ?? null);
      } catch {
        if (mounted) setAuthUser(null);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null);
    });

    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const { isProActive, status } = useEntitlements();
  const trialActive = status === 'trialing';

  const [userData, setUserDataState] = useState(null);

  useDailyNotification({
    hour:   19,
    minute: 0,
    title:  'Slimcal.ai Reminder',
    body:   '⏰ Don’t forget to log today’s workout & meals!'
  });

  const workoutsCount = JSON.parse(localStorage.getItem('workoutHistory') || '[]').length;
  const mealsCount    = JSON.parse(localStorage.getItem('mealHistory')   || '[]')
    .reduce((sum, e) => sum + (e.meals?.length || 0), 0);
  useVariableRewards({ workoutsCount, mealsCount });
  useMealReminders();

  const missedMeals = useInAppMealPrompt() || [];
  const [promptOpen, setPromptOpen] = useState(false);
  useEffect(() => {
    if (
      localStorage.getItem('hasCompletedHealthData') === 'true' &&
      !promptedRef.current &&
      missedMeals.length > 0 &&
      location.pathname !== '/meals' &&
      !trialActive
    ) {
      promptedRef.current = true;
      setPromptOpen(true);
    }
  }, [missedMeals, location.pathname, trialActive]);

  const handleClosePrompt = () => setPromptOpen(false);
  const handleGoToMeals   = () => { setPromptOpen(false); history.push('/meals'); };

  const [burnedCalories, setBurnedCalories]     = useState(0);
  const [consumedCalories, setConsumedCalories] = useState(0);

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeDefaults, setUpgradeDefaults] = useState({ plan: 'monthly', autopay: false });

  const [ambassadorOpen, setAmbassadorOpen] = useState(false);

  const [moreAnchor, setMoreAnchor] = useState(null);
  const openMore  = e => setMoreAnchor(e.currentTarget);
  const closeMore = () => setMoreAnchor(null);

  const setUserData = data => {
    const prev = JSON.parse(localStorage.getItem('userData') || '{}');
    const next = { ...prev, ...data, isPremium: isProActive };
    localStorage.setItem('userData', JSON.stringify(next));
    setUserDataState(next);
  };

  // Streak state for banner + modal
  const [streak, setStreak] = useState(() => getStreak());

  // Boot: hydrate streak safely (no increments), preload userData, refresh calories
  useEffect(() => {
    hydrateStreakOnStartup();
    const saved = JSON.parse(localStorage.getItem('userData') || '{}');
    const normalized = { ...saved, isPremium: isProActive };
    setUserDataState(normalized);
    localStorage.setItem('userData', JSON.stringify(normalized));
    refreshCalories();

    if (!saved.age && location.pathname === '/') {
      history.replace('/edit-info');
    }

    // Initialize live streak value after hydration
    setStreak(getStreak());
  }, [isProActive, location.pathname, history]);

  // Live: respond to streak updates (from real actions)
  useEffect(() => {
    const onStreakUpdate = () => {
      setStreak(getStreak());
      if (shouldShowAmbassadorOnce(30)) {
        setAmbassadorOpen(true);
      }
    };
    window.addEventListener('slimcal:streak:update', onStreakUpdate);
    return () => window.removeEventListener('slimcal:streak:update', onStreakUpdate);
  }, []);

  // Optional: react to explicit ambassador:ready events
  useEffect(() => {
    const onAmbassadorReady = () => setAmbassadorOpen(true);
    window.addEventListener('slimcal:ambassador:ready', onAmbassadorReady);
    return () => window.removeEventListener('slimcal:ambassador:ready', onAmbassadorReady);
  }, []);

  // ❌ REMOVED: Global OAuth code exchange in App.jsx (handled solely by /auth/callback)
  // This prevents race conditions where App clears the URL or runs exchange twice.

  // Auto-checkout
  useEffect(() => {
    if (isProActive || autoRunRef.current) return;

    const raw = localStorage.getItem('upgradeIntent');
    if (!raw) return;

    let intent = {};
    try { intent = JSON.parse(raw) || {}; } catch { intent = {}; }

    const desiredPlan = intent.plan === 'annual' ? 'annual' : 'monthly';
    const autopay = Boolean(intent.autopay);

    setUpgradeDefaults({ plan: desiredPlan, autopay });
    setUpgradeOpen(true);

    if (!autopay) return;

    autoRunRef.current = true;
    (async () => {
      const supaUser = await waitForSupabaseUser(10000, 250);
      if (!supaUser) return;

      try {
        const clientId = getOrCreateClientId();

        const resp = await fetch('/api/create-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: supaUser.id,
            email: supaUser.email || null,
            period: desiredPlan,
            client_reference_id: clientId,
            success_path: `/pro-success?cid=${encodeURIComponent(clientId)}`,
            cancel_path: `/`,
          }),
        });

        const json = await resp.json().catch(() => ({}));
        if (!resp.ok || !json?.url) return;
        window.location.assign(json.url);
      } catch (err) {
        console.error('[AutoCheckout] error', err);
      } finally {
        localStorage.removeItem('upgradeIntent');
      }
    })();
  }, [isProActive]);

  function refreshCalories() {
    const today    = new Date().toLocaleDateString('en-US');
    const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
    const meals    = JSON.parse(localStorage.getItem('mealHistory')   || '[]');
    const todayRec = meals.find(m => m.date === today);

    setBurnedCalories(
      workouts.filter(w => w.date === today)
              .reduce((sum,w) => sum + w.totalCalories, 0)
    );
    setConsumedCalories(
      todayRec ? todayRec.meals.reduce((sum,m) => sum + m.calories, 0) : 0
    );
  }

  const message = routeTips[location.pathname] || '';
  const [PageTip] = useFirstTimeTip(
    `hasSeenPageTip_${location.pathname}`,
    message,
    { auto: Boolean(message) }
  );

  const navBar = (
    <Box sx={{ textAlign: 'center', mb: 3 }}>
      <Stack direction={{ xs:'column', sm:'row' }} spacing={2} justifyContent="center">
        <Tooltip title="Log Workout">
          <Button component={NavLink} to="/workout" variant="contained" color="primary" startIcon={<FitnessCenterIcon />}>
            WORKOUT
          </Button>
        </Tooltip>
        <Tooltip title="Log Meal">
          <Button component={NavLink} to="/meals" variant="contained" color="secondary" startIcon={<RestaurantIcon />}>
            MEALS
          </Button>
        </Tooltip>
        <Tooltip title="Invite Friends">
          <Button onClick={() => setInviteOpen(true)} variant="outlined" startIcon={<CampaignIcon />}>
            INVITE
          </Button>
        </Tooltip>
        <Tooltip title="More options">
          <Button onClick={openMore} variant="outlined" startIcon={<MoreVertIcon />}>
            MORE
          </Button>
        </Tooltip>
      </Stack>
      <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={closeMore}>
        <MenuItem component={NavLink} to="/history"      onClick={closeMore}><HistoryIcon fontSize="small"/> History</MenuItem>
        <MenuItem component={NavLink} to="/dashboard"    onClick={closeMore}><DashboardIcon fontSize="small"/> Dashboard</MenuItem>
        <MenuItem component={NavLink} to="/achievements" onClick={closeMore}><EmojiEventsIcon fontSize="small"/> Achievements</MenuItem>
        <MenuItem component={NavLink} to="/calorie-log"  onClick={closeMore}><ListIcon fontSize="small"/> Calorie Log</MenuItem>
        <MenuItem component={NavLink} to="/summary"      onClick={closeMore}><AssessmentIcon fontSize="small"/> Summary</MenuItem>
        <MenuItem component={NavLink} to="/recap"        onClick={closeMore}><ChatIcon fontSize="small"/> Daily Recap</MenuItem>
        <MenuItem component={NavLink} to="/waitlist"     onClick={closeMore}><InfoIcon fontSize="small"/> Waitlist</MenuItem>
        <MenuItem component={NavLink} to="/preferences"  onClick={closeMore}><InfoIcon fontSize="small"/> Preferences</MenuItem>
        <MenuItem component={NavLink} to="/edit-info"    onClick={closeMore}><InfoIcon fontSize="small"/> Edit Info</MenuItem>
      </Menu>
    </Box>
  );

  const [inviteOpen, setInviteOpen] = useState(false);

  // Local pro flag for immediate UI after /pro-success
  const [localPro, setLocalPro] = useState(localStorage.getItem('isPro') === 'true');
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'isPro') setLocalPro(e.newValue === 'true');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const showTryPro = !(isProActive || localPro);

  // --- call /api/identify on auth/route/plan changes + heartbeat ---
  const lastIdentRef = useRef({ path: null, ts: 0 });
  useEffect(() => {
    if (!authUser) return;
    const now = Date.now();
    const path = location.pathname || '/';

    // Throttle duplicate calls (e.g., rapid route changes)
    const tooSoon = (now - lastIdentRef.current.ts) < 2000 && lastIdentRef.current.path === path;
    if (!tooSoon) {
      sendIdentity({ user: authUser, path, isProActive, planStatus: status });
      lastIdentRef.current = { path, ts: now };
    }
  }, [authUser?.id, location.pathname, isProActive, status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!authUser) return;
    const onFocus = () => sendIdentity({ user: authUser, path: location.pathname, isProActive, planStatus: status });
    window.addEventListener('focus', onFocus);
    const iv = setInterval(onFocus, 60_000); // heartbeat every 60s
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(iv);
    };
  }, [authUser?.id, location.pathname, isProActive, status]);
  // ----------------------------------------------------------------------

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

      <AmbassadorModal
        open={ambassadorOpen}
        onClose={() => {
          // One-time flag so it never shows again unless user resets it
          markAmbassadorShown();
          setAmbassadorOpen(false);
        }}
        user={authUser}
        streak={streak}
      />

      <Box sx={{ textAlign: 'center', mb: 2 }}>
        <Typography variant="h2" color="primary">Slimcal.ai</Typography>
        <Typography variant="body1" color="textSecondary">
          Track your workouts, meals, and calories all in one place.
        </Typography>

        {!authUser && (
          <Button
            variant="contained"
            sx={{ mt: 2, mr: 1 }}
            onClick={() =>
              supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: `${window.location.origin}/auth/callback` },
              })
            }
          >
            LOGIN
          </Button>
        )}

        {showTryPro && (
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            onClick={() => setUpgradeOpen(true)}
          >
            TRY PRO FREE
          </Button>
        )}

        {authUser && (
          <Typography variant="body2" sx={{ mt: 1 }}>
            Signed in as {authUser.email}{' '}
            <Button
              size="small"
              onClick={async () => { await supabase.auth.signOut(); }}
            >
              SIGN OUT
            </Button>
          </Typography>
        )}
      </Box>

      <NetCalorieBanner burned={burnedCalories} consumed={consumedCalories} />
      {/* Pass live streak explicitly so banner shows the same number as the modal gate */}
      <StreakBanner streak={streak} />
      <SocialProofBanner />
      {navBar}

      <Switch>
        <Route path="/auth/callback" component={AuthCallback} />
        <Route path="/pro" component={ProLandingPage} />
        <Route path="/pro-success" component={ProSuccess} />

        <Route path="/edit-info" render={() =>
          <HealthDataForm setUserData={data => {
            const prev = JSON.parse(localStorage.getItem('userData') || '{}');
            const next = { ...prev, ...data, isPremium: isProActive || localPro };
            localStorage.setItem('userData', JSON.stringify(next));
            setUserDataState(next);
            history.push('/');
          }} />
        }/>
        <Route path="/workout" render={() =>
          <WorkoutPage
            userData={userData}
            onWorkoutLogged={() => {
              // Recompute banners
              const today = new Date().toLocaleDateString('en-US');
              const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
              const meals    = JSON.parse(localStorage.getItem('mealHistory')   || '[]');
              const todayRec = meals.find(m => m.date === today);
              setBurnedCalories(workouts.filter(w => w.date === today).reduce((s,w)=>s+w.totalCalories,0));
              setConsumedCalories(todayRec ? todayRec.meals.reduce((s,m)=>s+m.calories,0) : 0);

              // Streak also updates inside WorkoutPage on Log Workout; keeping this is okay if you prefer redundancy:
              updateStreak();
            }}
          />
        }/>
        <Route path="/meals" render={() =>
          <MealTracker
            onMealUpdate={() => {
              // Recompute banners only (no streak update on mount)
              const today = new Date().toLocaleDateString('en-US');
              const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
              const meals    = JSON.parse(localStorage.getItem('mealHistory')   || '[]');
              const todayRec = meals.find(m => m.date === today);
              setBurnedCalories(workouts.filter(w => w.date === today).reduce((s,w)=>s+w.totalCalories,0));
              setConsumedCalories(todayRec ? todayRec.meals.reduce((s,m)=>s+m.calories,0) : 0);
            }}
          />
        }/>
        <Route path="/history" component={WorkoutHistory} />
        <Route path="/dashboard" component={ProgressDashboard} />
        <Route path="/achievements" component={Achievements} />
        <Route path="/calorie-log"  component={CalorieHistory} />
        <Route path="/summary"      component={CalorieSummary} />
        <Route path="/recap"        render={() => <DailyRecapCoach userData={{ ...userData, isPremium: isProActive || localPro }} />} />
        <Route path="/waitlist"     component={WaitlistSignup} />
        <Route path="/preferences"  component={AlertPreferences} />
        <Route exact path="/"       render={() => null} />
      </Switch>

      <Dialog open={inviteOpen} onClose={() => setInviteOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Invite Friends</DialogTitle>
        <DialogContent><ReferralDashboard /></DialogContent>
        <DialogActions><Button onClick={() => setInviteOpen(false)}>Close</Button></DialogActions>
      </Dialog>

      <Fab color="primary" onClick={() => setInviteOpen(true)} sx={{ position:'fixed', bottom:16, right:16 }}>
        <CampaignIcon />
      </Fab>

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        title="Start your 7-Day Free Pro Trial"
        description="Unlimited AI recaps, custom goals, meal suggestions & more—on us!"
        defaultPlan={upgradeDefaults.plan}
        autoCheckoutOnOpen={upgradeDefaults.autopay}
      />
    </Container>
  );
}
