// src/App.jsx
import React, { useState, useEffect, useRef } from 'react';
import {
  Route,
  Switch,
  Redirect,
  NavLink,
  useLocation,
  useHistory
} from 'react-router-dom';
import { Container,
  Box,
  Typography,
  Button,
  Stack,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Fab,
  Snackbar,
  Alert,
  Badge,
  Chip } from '@mui/material';
import CampaignIcon      from '@mui/icons-material/Campaign';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import RestaurantIcon    from '@mui/icons-material/Restaurant';
import MoreVertIcon      from '@mui/icons-material/MoreVert';
import EmojiEventsIcon   from '@mui/icons-material/EmojiEvents';
import ListIcon          from '@mui/icons-material/List';
import AssessmentIcon    from '@mui/icons-material/Assessment';
import InfoIcon          from '@mui/icons-material/Info';
import ChatIcon          from '@mui/icons-material/Chat';

import ProLandingPage from './ProLandingPage';
import ProSuccess     from './ProSuccess';
import AuthCallback   from './AuthCallback';

import useVariableRewards    from './hooks/useVariableRewards';

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
import DailyEvaluationHome from './DailyEvaluationHome'; // ✅ NEW (Acquisition home)
import StreakBanner      from './components/StreakBanner';
import SocialProofBanner from './components/SocialProofBanner';
import WaitlistSignup    from './components/WaitlistSignup';

import UpgradeModal      from './components/UpgradeModal';
import AmbassadorModal   from './components/AmbassadorModal';
import ReferralDashboard from './components/ReferralDashboard';
import { logPageView }   from './analytics';

import { useEntitlements } from './context/EntitlementsContext.jsx';
import { supabase }        from './lib/supabaseClient';

import { attachSyncListeners } from './lib/sync';

import Header from './components/Header';
import BottomNav from './components/BottomNav';

import {
  shouldShowAmbassadorOnce,
  markAmbassadorShown,
  getStreak,
  updateStreak,
  hydrateStreakOnStartup,
} from './utils/streak';

const routeTips = {
  '/':            'Daily Evaluation: swipe cards for verdict → stakes → diagnosis → insight.',
  '/coach':        'Recap Coach (retention): your Daily Recap + Quests + XP live here. Log meals/workouts then come back.',
  '/edit-info':    'Welcome to Slimcal.ai! Enter your health info to get started.',
  '/workout':      'This is your Workout page: log exercises & calories burned.',
  '/meals':        'Track your meals here: search foods or add calories manually.',
  '/history':      'View your past workouts & meals at a glance.',
  '/dashboard':    'Dashboard: see trends and invite friends below.',
  '/achievements': 'Achievements: hit milestones to unlock badges!',
  '/calorie-log':  'Calorie Log: detailed daily breakdown of intake vs burn.',
  '/summary':      'Summary: quick overview of today’s net calories.',
  '/recap':        'Coach (legacy route): redirects to Coach tab.',
  '/waitlist':     'Join our waitlist for early access to new features!',

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
    await new Promise(r => setTimeout(r, stepMs));
  }
}

function parseUtm(search) {
  const params = new URLSearchParams(search || '');
  return {
    utm_source: params.get('utm_source'),
    utm_medium: params.get('utm_medium'),
    utm_campaign: params.get('utm_campaign'),
  };
}

async function sendIdentity({ user, path, isProActive, planStatus }) {
  try {
    if (!user) return;
    const clientId = getOrCreateClientId();
    const { utm_source, utm_medium, utm_campaign } = parseUtm(window.location.search);
    const payload = {
      user_id: user.id,
      email: user.email || null,
      full_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
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
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[identify] failed', err);
  }
}

const HEARTBEAT_KEY = 'slimcal:lastHeartbeatTs';
const LAST_HB_EMAIL_KEY = 'slimcal:lastHeartbeatEmail';
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

function rememberHeartbeatEmail(email) {
  if (email) localStorage.setItem(LAST_HB_EMAIL_KEY, email);
}
function lastHeartbeatEmail() {
  return localStorage.getItem(LAST_HB_EMAIL_KEY) || '';
}

async function sendHeartbeat({ id, email, provider, display_name, last_client }) {
  try {
    const res = await fetch('/api/users/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, email, provider, display_name, last_client }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function shouldHeartbeat() {
  const last = Number(localStorage.getItem(HEARTBEAT_KEY) || 0);
  return Date.now() - last > TWELVE_HOURS_MS;
}

async function heartbeatNow(session) {
  if (!session?.user?.email) return;
  const id = session.user.id;
  const email = session.user.email;
  const provider = session.user.app_metadata?.provider || 'unknown';
  const display_name = session.user.user_metadata?.full_name || session.user.user_metadata?.name || '';
  const last_client = 'web:slimcal-ai';

  const res = await sendHeartbeat({ id, email, provider, display_name, last_client });
  if (res?.ok) {
    localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
    rememberHeartbeatEmail(email);
  }
}

// ---- LOCAL-FIRST OFFLINE SAFETY HELPERS --------------------------------
function normalizeLocalData() {
  const clientId = getOrCreateClientId();

  const wh = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
  const whNorm = wh.map(w => ({
    ...w,
    clientId: w.clientId || clientId,
    localId: w.localId || `w_${clientId}_${w.createdAt ? Date.parse(w.createdAt) : Date.now()}`,
    createdAt: w.createdAt || new Date().toISOString(),
    uploaded: typeof w.uploaded === 'boolean' ? w.uploaded : false,
  }));
  localStorage.setItem('workoutHistory', JSON.stringify(whNorm));

  const mh = JSON.parse(localStorage.getItem('mealHistory') || '[]');
  const mhNorm = mh.map(day => ({
    ...day,
    clientId: day.clientId || clientId,
    localId: day.localId || `m_${clientId}_${day.date || Date.now()}`,
    createdAt: day.createdAt || new Date().toISOString(),
    uploaded: typeof day.uploaded === 'boolean' ? day.uploaded : false,
  }));
  localStorage.setItem('mealHistory', JSON.stringify(mhNorm));
}

function dedupLocalWorkouts() {
  const wh = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
  if (!Array.isArray(wh) || wh.length === 0) return;

  const map = new Map();
  for (const w of wh) {
    const kcal = Math.round(Number(w.totalCalories) || 0);
    const key = [w.date, w.name, kcal].join('|');
    const prev = map.get(key);
    if (!prev || new Date(w.createdAt || 0) > new Date(prev.createdAt || 0)) {
      map.set(key, w);
    }
  }
  const dedup = Array.from(map.values());
  if (dedup.length !== wh.length) {
    localStorage.setItem('workoutHistory', JSON.stringify(dedup));
  }
}

function recomputeTodayBanners(setBurned, setConsumed) {
  const today = new Date().toLocaleDateString('en-US');
  const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
  const meals    = JSON.parse(localStorage.getItem('mealHistory')   || '[]');
  const todayRec = meals.find(m => m.date === today);

  setBurned(
    workouts.filter(w => w.date === today)
      .reduce((sum,w) => sum + (Number(w.totalCalories) || 0), 0)
  );
  setConsumed(todayRec ? todayRec.meals.reduce((s,m) => s + (Number(m.calories) || 0), 0) : 0);
}
// -----------------------------------------------------------------------

// ---- Health form "show once" helpers ----------------------------------
function getHealthSeenKeyForUser(userId) {
  return userId ? `slimcal:healthFormSeen:user:${userId}:v1` : 'slimcal:healthFormSeen:anon:v1';
}
function hasSeenHealthForm(userId) {
  try {
    const key = getHealthSeenKeyForUser(userId);
    return localStorage.getItem(key) === 'true';
  } catch (e) {
    return false;
  }
}
function markHealthFormSeen(userId) {
  try {
    const key = getHealthSeenKeyForUser(userId);
    localStorage.setItem(key, 'true');
  } catch (e) {}
}
function hasHealthDataLocal(saved) {
  try {
    const hasCompleted = localStorage.getItem('hasCompletedHealthData') === 'true';
    if (hasCompleted) return true;
    const age = saved?.age;
    return !!age;
  } catch (e) {
    return !!saved?.age;
  }
}
// -----------------------------------------------------------------------

export default function App() {
  const history      = useHistory();
  const location     = useLocation();
  const promptedRef  = useRef(false);

  useReferral();

  // Auth state
  const [authUser, setAuthUser] = useState(null);
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (mounted) setAuthUser(data?.user ?? null);
      } catch (e) {
        if (mounted) setAuthUser(null);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const user = session?.user ?? null;
      setAuthUser(user);

      // Auto-open Upgrade after OAuth if we set the flag pre-login
      if (user && localStorage.getItem('slimcal:openUpgradeAfterLogin') === '1') {
        localStorage.removeItem('slimcal:openUpgradeAfterLogin');
        window.dispatchEvent(new CustomEvent('slimcal:open-upgrade'));
      }

      const email = user?.email || '';
      if (email) {
        const prev = lastHeartbeatEmail();
        if (prev !== email) {
          await heartbeatNow(session);
          return;
        }
      }
      if (session && shouldHeartbeat()) {
        await heartbeatNow(session);
      }
    });

    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  useEffect(() => {
    attachSyncListeners();
  }, []);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  /* ---------------- Entitlements (context) ---------------- */
  const { isProActive, status, entitlements } = useEntitlements();
  const trialActive = status === 'trialing';

  // Ambassador badge detection (robust to Set/Array/object)
  const hasAmbassadorBadge = React.useMemo(() => {
    if (!entitlements) return false;
    if (typeof entitlements.has === 'function') return entitlements.has('ambassador_badge');
    if (Array.isArray(entitlements)) return entitlements.includes('ambassador_badge');
    if (typeof entitlements === 'object') return Boolean(entitlements['ambassador_badge']);
    return false;
  }, [entitlements]);

  /* --------------- Server-truth Pro check (includes trial eligibility) --------------- */
  const [proCheck, setProCheck] = useState({
    loading: false,
    isPro: false,
    status: null,
    trialEligible: true,
  });

  useEffect(() => {
    let abort = false;

    const fetchPro = async () => {
      if (!authUser?.id) {
        if (!abort) {
          setProCheck({ loading: false, isPro: false, status: null, trialEligible: true });
          try { localStorage.setItem('isPro', 'false'); } catch (e) {}
        }
        return;
      }
      if (!abort) setProCheck(s => ({ ...s, loading: true }));

      try {
        const res = await fetch(`/api/me/pro-status?user_id=${encodeURIComponent(authUser.id)}`, { credentials: 'same-origin' });
        const json = await res.json().catch(() => ({}));
        if (abort) return;

        const active = !!(json?.isProActive ?? json?.isPro);
        const trialEligible = (typeof json?.trial_eligible === 'boolean') ? json.trial_eligible : true;

        setProCheck({
          loading: false,
          isPro: active,
          status: json?.status || null,
          trialEligible,
        });

        try { localStorage.setItem('isPro', active ? 'true' : 'false'); } catch (e) {}
      } catch (e) {
        if (!abort) setProCheck(s => ({ ...s, loading: false }));
      }
    };

    fetchPro();
    const onFocus = () => fetchPro();
    const iv = setInterval(fetchPro, 5 * 60 * 1000);

    window.addEventListener('slimcal:pro:refresh', fetchPro);
    window.addEventListener('focus', onFocus);

    return () => {
      abort = true;
      clearInterval(iv);
      window.removeEventListener('slimcal:pro:refresh', fetchPro);
      window.removeEventListener('focus', onFocus);
    };
  }, [authUser?.id]);

  const [userData, setUserDataState] = useState(null);

  const workoutsCount = JSON.parse(localStorage.getItem('workoutHistory') || '[]').length;
  const mealsCount    = JSON.parse(localStorage.getItem('mealHistory')   || '[]')
    .reduce((sum, e) => sum + (e.meals?.length || 0), 0);
  useVariableRewards({ workoutsCount, mealsCount });

  const missedMeals = []; // meal prompts disabled
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

  const [streak, setStreak] = useState(() => getStreak());

  useEffect(() => {
    hydrateStreakOnStartup();

    const saved = JSON.parse(localStorage.getItem('userData') || '{}');

    // If logged in and local health is missing, try to rehydrate from Supabase user metadata
    const metaHealth =
      authUser?.user_metadata?.slimcal_health_v1 ||
      authUser?.user_metadata?.healthData ||
      null;

    let merged = saved;

    if (!saved?.age && metaHealth && typeof metaHealth === 'object') {
      merged = { ...saved, ...metaHealth };
      try {
        localStorage.setItem('userData', JSON.stringify(merged));
        localStorage.setItem('hasCompletedHealthData', 'true');
      } catch (e) {}
    }

    const normalized = { ...merged, isPremium: isProActive };
    setUserDataState(normalized);
    localStorage.setItem('userData', JSON.stringify(normalized));
    refreshCalories();

    // ---- Show Health form only once per anon device OR once per user ----
    const userId = authUser?.id || null;
    const hasHealth = hasHealthDataLocal(merged);
    const hasSeen = hasSeenHealthForm(userId);

    // Only redirect from Acquisition Home (Daily Evaluation). Never loop.
    if (location.pathname === '/' && !hasHealth && !hasSeen) {
      markHealthFormSeen(userId);
      history.replace('/edit-info');
    }

    setStreak(getStreak());
  }, [isProActive, location.pathname, history, authUser?.id]);

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

  useEffect(() => {
    const onAmbassadorReady = () => setAmbassadorOpen(true);
    window.addEventListener('slimcal:ambassador:ready', onAmbassadorReady);
    return () => window.removeEventListener('slimcal:ambassador:ready', onAmbassadorReady);
  }, []);

  const lastIdentRef = useRef({ path: null, ts: 0 });
  useEffect(() => {
    if (!authUser) return;
    const now = Date.now();
    const path = location.pathname || '/';

    const tooSoon =
      (now - lastIdentRef.current.ts) < 2000 &&
      lastIdentRef.current.path === path;

    if (!tooSoon) {
      sendIdentity({ user: authUser, path, isProActive: proCheck.isPro || isProActive, planStatus: status });
      lastIdentRef.current = { path, ts: now };
    }
  }, [authUser?.id, location.pathname, isProActive, status, proCheck.isPro]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!authUser) return;
    const onFocus = () =>
      sendIdentity({ user: authUser, path: location.pathname, isProActive: proCheck.isPro || isProActive, planStatus: status });
    window.addEventListener('focus', onFocus);
    const iv = setInterval(onFocus, 60_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(iv);
    };
  }, [authUser?.id, location.pathname, isProActive, status, proCheck.isPro ]);

  useEffect(() => {
    let visHandler;

    (async () => {
      const { data } = await supabase.auth.getSession();
      const session = data?.session || null;

      if (session?.user?.email) {
        const email = session.user.email;
        const prev  = lastHeartbeatEmail();

        if (email && prev !== email) {
          await heartbeatNow(session);
        } else if (shouldHeartbeat()) {
          await heartbeatNow(session);
        }
      }
    })();

    visHandler = async () => {
      if (document.visibilityState !== 'visible') return;
      const { data } = await supabase.auth.getSession();
      const session = data?.session || null;
      if (!session?.user?.email) return;

      if (shouldHeartbeat()) {
        await heartbeatNow(session);
      }
    };

    document.addEventListener('visibilitychange', visHandler);
    return () => {
      document.removeEventListener('visibilitychange', visHandler);
    };
  }, []);

  useEffect(() => {
    const run = () => {
      normalizeLocalData();
      dedupLocalWorkouts();
      recomputeTodayBanners(setBurnedCalories, setConsumedCalories);
    };
    run();

    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    const onOnline = () => { run(); setNetSnack({ open: true, type: 'online' }); };
    const onOffline = () => setNetSnack({ open: true, type: 'offline' });

    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const [netSnack, setNetSnack] = useState({ open: false, type: 'online' });
  const closeNetSnack = () => setNetSnack(s => ({ ...s, open: false }));

  async function refreshCalories() {
    // Single source of truth for banner workout calories:
    // For signed-in users, sum today's rows from Supabase `workouts` (by local_day).
    // If the network is unavailable, fall back to localStorage histories.
    const _now = new Date();
    const pad2 = (n) => String(n).padStart(2, '0');
    const todayISO = `${_now.getFullYear()}-${pad2(_now.getMonth()+1)}-${pad2(_now.getDate())}`;

    const readJSON = (key, fallback) => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) {
        return fallback;
      }
    };

    const uid = authUser?.id || null;

    const dayISOFromAny = (v) => {
      if (!v) return null;
      const s = String(v);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const dt = new Date(s);
      if (!Number.isNaN(dt.getTime())) {
        return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).toISOString().slice(0, 10);
      }
      return null;
    };

    // ----- local fallbacks (guests + offline) -----
    const whLocal = (() => {
      if (uid) {
        const scoped = readJSON(`workoutHistory:${uid}`, []);
        return Array.isArray(scoped) ? scoped : [];
      }
      const legacy = readJSON('workoutHistory', []);
      return Array.isArray(legacy) ? legacy : [];
    })();

    const mhLocal = (() => {
      if (uid) {
        const scoped = readJSON(`mealHistory:${uid}`, []);
        return Array.isArray(scoped) ? scoped : [];
      }
      const legacy = readJSON('mealHistory', []);
      return Array.isArray(legacy) ? legacy : [];
    })();

    const burnedLocal = whLocal
      .filter((w) => {
        const day = dayISOFromAny(
          w.local_day || w.__local_day || w.day || w.date || w.started_at || w.createdAt || w.created_at
        );
        return day === todayISO;
      })
      .reduce((s, w) => s + (Number(w.totalCalories ?? w.total_calories ?? w.calories ?? 0) || 0), 0);

    const eatenLocal = mhLocal
      .filter((m) => {
        const day = dayISOFromAny(m.local_day || m.__local_day || m.day || m.date || m.eaten_at || m.created_at);
        return day === todayISO;
      })
      .reduce((s, m) => s + (Number(m.totalCalories ?? m.total_calories ?? m.calories ?? 0) || 0), 0);

    let burned = burnedLocal;
    let eaten = eatenLocal;
    setBurnedCalories(burned);
    setConsumedCalories(eaten);
  }

  const message = routeTips[location.pathname] || '';
  const [PageTip] = useFirstTimeTip(
    `hasSeenPageTip_${location.pathname}`,
    message,
    { auto: Boolean(message) }
  );

  // ===== Coach hint state (pulsing "AI" badge) =====
  const [showCoachHint, setShowCoachHint] = useState(() => {
    try { return localStorage.getItem('slimcal:coachHintSeen') !== '1'; } catch (e) { return true; }
  });
  useEffect(() => {
    if (location.pathname === '/coach' && showCoachHint) {
      try { localStorage.setItem('slimcal:coachHintSeen', '1'); } catch (e) {}
      setShowCoachHint(false);
    }
  }, [location.pathname, showCoachHint]);

  // === Quick Actions (Acquisition-forward) ===
  const navBar = (
    <Box sx={{ textAlign: 'center', mb: 3 }}>
      <Stack direction={{ xs:'column', sm:'row' }} spacing={2} justifyContent="center">
        {/* ✅ New hero quick action: Evaluate */}
        
          <Button component={NavLink} to="/" variant="outlined" startIcon={<AssessmentIcon />}>
            EVALUATE
          </Button>
        

        
          <Button component={NavLink} to="/workout" variant="contained" color="primary" startIcon={<FitnessCenterIcon />}>
            WORKOUT
          </Button>
        

        
          <Button component={NavLink} to="/meals" variant="contained" color="secondary" startIcon={<RestaurantIcon />}>
            MEALS
          </Button>
        

        
          <Button onClick={() => setInviteOpen(true)} variant="outlined" startIcon={<CampaignIcon />}>
            INVITE
          </Button>
        

        
          <Button onClick={openMore} variant="outlined" startIcon={<MoreVertIcon />}>
            MORE
          </Button>
        
      </Stack>

      <Menu anchorEl={moreAnchor} open={Boolean(moreAnchor)} onClose={closeMore}>
        <MenuItem component={NavLink} to="/achievements" onClick={closeMore}>
          <EmojiEventsIcon fontSize="small"/> Achievements
        </MenuItem>
        <MenuItem component={NavLink} to="/calorie-log" onClick={closeMore}>
          <ListIcon fontSize="small"/> Calorie Log
        </MenuItem>
        <MenuItem component={NavLink} to="/summary" onClick={closeMore}>
          <AssessmentIcon fontSize="small"/> Summary
        </MenuItem>
        <MenuItem component={NavLink} to="/waitlist" onClick={closeMore}>
          <InfoIcon fontSize="small"/> Waitlist
        </MenuItem><MenuItem component={NavLink} to="/edit-info" onClick={closeMore}>
          <InfoIcon fontSize="small"/> Edit Info
        </MenuItem>

        {/* ✅ Retention: Recap Coach lives in More now */}
        <MenuItem
          component={NavLink}
          to="/coach"
          onClick={() => {
            closeMore();
            if (showCoachHint) {
              try { localStorage.setItem('slimcal:coachHintSeen', '1'); } catch (e) {}
              setShowCoachHint(false);
            }
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <ChatIcon fontSize="small" />
            Recap Coach
            <Chip
              label="AI"
              size="small"
              color="primary"
              sx={{ height: 18, borderRadius: '8px', fontWeight: 800, ml: 0.5 }}
            />
            {showCoachHint && (
              <Chip
                label="NEW"
                size="small"
                color="warning"
                sx={{ height: 18, borderRadius: '8px', fontWeight: 800, ml: 0.5 }}
              />
            )}
          </span>
        </MenuItem>
      </Menu>
    </Box>
  );

  const [inviteOpen, setInviteOpen] = useState(false);

  const [localPro, setLocalPro] = useState(localStorage.getItem('isPro') === 'true');
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'isPro') setLocalPro(e.newValue === 'true');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // ---- CTA logic (fixed): always show upgrade path when logged in and not Pro
  const effectiveIsPro = (proCheck.isPro || isProActive || localPro);
  const showLoggedInCta = !!authUser && !proCheck.loading && !effectiveIsPro;
  const loggedInCtaLabel = proCheck.trialEligible ? "TRY PRO FREE" : "UPGRADE TO PRO";

  useEffect(() => {
    const openUpgradeHandler = () => setUpgradeOpen(true);
    const openSigninHandler = () => {
      supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
    };
    window.addEventListener('slimcal:open-upgrade', openUpgradeHandler);
    window.addEventListener('slimcal:open-signin', openSigninHandler);
    return () => {
      window.removeEventListener('slimcal:open-upgrade', openUpgradeHandler);
      window.removeEventListener('slimcal:open-signin', openSigninHandler);
    };
  }, []);

  const startOAuth = (withUpgradeFlag = false) => {
    if (withUpgradeFlag) {
      localStorage.setItem('slimcal:openUpgradeAfterLogin', '1');
    }
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  return (
    <>
      <Header logoSrc="/slimcal-logo.svg" showBeta={false} />

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
            <Stack direction="row" spacing={1} justifyContent="center" sx={{ mt: 2 }}>
              <Button variant="contained" onClick={() => startOAuth(false)}>
                LOGIN
              </Button>
              <Button variant="outlined" onClick={() => startOAuth(true)}>
                TRY PRO FREE
              </Button>
            </Stack>
          )}

          {showLoggedInCta && (
            <Button
              variant="contained"
              sx={{ mt: 2 }}
              onClick={() => setUpgradeOpen(true)}
            >
              {loggedInCtaLabel}
            </Button>
          )}

          {authUser && (
            <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="body2">
                Signed in as {authUser.email}
              </Typography>
              {hasAmbassadorBadge && (
                <Chip
                  label="Ambassador"
                  color="warning"
                  size="small"
                  sx={{ fontWeight: 600 }}
                />
              )}
              <Button size="small" onClick={async () => { await supabase.auth.signOut(); }}>
                SIGN OUT
              </Button>
            </Box>
          )}
        </Box>

        <NetCalorieBanner burned={burnedCalories} consumed={consumedCalories} />
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
              const next = { ...prev, ...data, isPremium: (proCheck.isPro || isProActive || localPro) };
              localStorage.setItem('userData', JSON.stringify(next));
              setUserDataState(next);
              history.push('/');
            }} />
          }/>
          <Route path="/workout" render={() =>
            <WorkoutPage
              userData={userData}
              onWorkoutLogged={() => {
                const today = new Date().toLocaleDateString('en-US');
                const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
                const meals    = JSON.parse(localStorage.getItem('mealHistory')   || '[]');
                const todayRec = meals.find(m => m.date === today);
                setBurnedCalories(workouts.filter(w => w.date === today).reduce((s,w)=>s+(Number(w.totalCalories)||0),0));
                setConsumedCalories(todayRec ? todayRec.meals.reduce((s,m)=>s+(Number(m.calories)||0),0) : 0);

                normalizeLocalData();
                dedupLocalWorkouts();
                updateStreak();
              }}
            />
          }/>
          <Route path="/meals" render={() =>
            <MealTracker
              onMealUpdate={() => {
                const today = new Date().toLocaleDateString('en-US');
                const workouts = JSON.parse(localStorage.getItem('workoutHistory') || '[]');
                const meals    = JSON.parse(localStorage.getItem('mealHistory')   || '[]');
                const todayRec = meals.find(m => m.date === today);
                setBurnedCalories(workouts.filter(w => w.date === today).reduce((s,w)=>s+(Number(w.totalCalories)||0),0));
                setConsumedCalories(todayRec ? todayRec.meals.reduce((s,m)=>s+(Number(m.calories)||0),0) : 0);

                normalizeLocalData();
              }}
            />
          }/>
          <Route path="/history" component={WorkoutHistory} />
          <Route path="/dashboard" component={ProgressDashboard} />
          <Route path="/achievements" component={Achievements} />
          <Route path="/calorie-log"  component={CalorieHistory} />
          <Route path="/summary"      component={CalorieSummary} />

          {/* ✅ Legacy recap route now redirects to Coach (retention) */}
          <Route path="/recap" render={() => <Redirect to="/coach" />} />

          <Route path="/waitlist"     component={WaitlistSignup} />

          {/* ✅ NEW: Acquisition home is Daily Evaluation */}
          <Route exact path="/" component={DailyEvaluationHome} />

          {/* ✅ Retention side: Recap Coach */}
          <Route
            path="/coach"
            render={() => (
              <DailyRecapCoach
                userData={{ ...userData, isPremium: (proCheck.isPro || isProActive || localPro) }}
              />
            )}
          />
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
          trialEligible={!!proCheck.trialEligible}
          title={proCheck.trialEligible ? "Start your 7-Day Free Pro Trial" : "Upgrade to Pro"}
          description={
            proCheck.trialEligible
              ? "Unlimited AI recaps, custom goals, meal suggestions & more—on us!"
              : "Your trial was already used. Upgrade to Pro to unlock unlimited AI recaps, meals, workouts, and premium insights."
          }
          defaultPlan={upgradeDefaults.plan}
          autoCheckoutOnOpen={upgradeDefaults.autopay}
        />

        <Snackbar open={netSnack.open} autoHideDuration={2800} onClose={closeNetSnack} anchorOrigin={{ vertical:'bottom', horizontal:'center' }}>
          {netSnack.type === 'online'
            ? <Alert onClose={closeNetSnack} severity="success" variant="filled">Back online. Your local data is safe.</Alert>
            : <Alert onClose={closeNetSnack} severity="warning" variant="filled">You’re offline. Entries are saved locally.</Alert>}
        </Snackbar>
      </Container>

      <Box sx={{ height: { xs: 80, md: 0 } }} />
      <BottomNav />
    </>
  );
}
