// src/components/BottomNav.jsx
import React, { useEffect, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import Paper from '@mui/material/Paper';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';

import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import HistoryIcon from '@mui/icons-material/History';
import DashboardIcon from '@mui/icons-material/Dashboard';
import HomeIcon from '@mui/icons-material/Home';
import ChatIcon from '@mui/icons-material/Chat';

// Hide Recap Coach from bottom navigation (page remains accessible via direct URL).
const SHOW_COACH_NAV = false;

const tabs = [
  { label: 'Evaluate', value: '/', icon: <HomeIcon /> },
  ...(SHOW_COACH_NAV ? [{ label: 'Coach', value: '/coach', icon: <ChatIcon /> }] : []),
  { label: 'Workout', value: '/workout', icon: <FitnessCenterIcon /> },
  { label: 'Meals', value: '/meals', icon: <RestaurantIcon /> },
  { label: 'History', value: '/history', icon: <HistoryIcon /> },
  { label: 'Dashboard', value: '/dashboard', icon: <DashboardIcon /> },
];

function pickActiveTab(pathname) {
  // If user manually navigates to /coach, keep nav highlighted on Evaluate.
  if (pathname === '/coach' || pathname.startsWith('/coach/')) return '/';

  // Prefer the longest matching route (avoids "/" matching everything).
  const exact = tabs.find(t => pathname === t.value);
  if (exact) return exact.value;

  const candidates = tabs
    .filter(t => t.value !== '/' && pathname.startsWith(t.value))
    .sort((a, b) => b.value.length - a.value.length);

  return candidates[0]?.value || '/';
}

export default function BottomNav() {
  const [navHidden, setNavHidden] = useState(false);

  useEffect(() => {
    const onSet = (e) => {
      const hidden = !!(e && e.detail && e.detail.hidden);
      setNavHidden(hidden);
    };
    window.addEventListener('slimcal:setNavHidden', onSet);
    return () => window.removeEventListener('slimcal:setNavHidden', onSet);
  }, []);

const history = useHistory();
  const location = useLocation();

  const current = pickActiveTab(location.pathname);

  const handleChange = (_e, newValue) => {
    if (newValue && newValue !== location.pathname) {
      history.push(newValue);
    }
  };

  return (
    <Paper
      elevation={3}
      sx={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        display: { xs: 'block', md: 'none' }, // show only on small screens
        zIndex: (theme) => theme.zIndex.appBar, // above content
        width: '100%',
        maxWidth: '100vw',
        boxSizing: 'border-box',
        overflowX: 'hidden',
      }}
    >
      <BottomNavigation
        value={current}
        onChange={handleChange}
        showLabels
        sx={{
          width: '100%',
          maxWidth: '100vw',
          boxSizing: 'border-box',
          overflowX: 'hidden',
          '& .MuiBottomNavigationAction-root': {
            minWidth: 0,
            paddingLeft: 0.5,
            paddingRight: 0.5,
            flex: 1,
          },
          '& .MuiBottomNavigationAction-label': {
            fontSize: '0.7rem',
            whiteSpace: 'nowrap',
          },
        }}
      >
        {tabs.map((t) => (
          <BottomNavigationAction
            key={t.value}
            label={t.label}
            value={t.value}
            icon={t.icon}
          />
        ))}
      </BottomNavigation>
    </Paper>
  );
}
