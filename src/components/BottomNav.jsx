// src/components/BottomNav.jsx
import React from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import Paper from '@mui/material/Paper';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';

import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import HomeIcon from '@mui/icons-material/Home';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import HistoryIcon from '@mui/icons-material/History';

const tabs = [
  { label: 'Home', value: '/', icon: <HomeIcon /> },
  { label: 'Meals', value: '/meals', icon: <RestaurantIcon /> },
  { label: 'Workout', value: '/workout', icon: <FitnessCenterIcon /> },
  { label: 'History', value: '/history', icon: <HistoryIcon /> },
  { label: 'Scan', value: '/body-scan', icon: <CenterFocusStrongIcon /> },
  { label: 'Verdict', value: '/verdict', icon: <FactCheckIcon /> },
];

function pickActiveTab(pathname) {
  if (pathname === '/body-scan' || pathname.startsWith('/body-scan/')) return '/body-scan';

  if (pathname === '/verdict' || pathname.startsWith('/verdict/')) return '/verdict';

  // Prefer the longest matching route (avoids "/" matching everything).
  const exact = tabs.find(t => pathname === t.value);
  if (exact) return exact.value;

  const candidates = tabs
    .filter(t => t.value !== '/' && pathname.startsWith(t.value))
    .sort((a, b) => b.value.length - a.value.length);

  return candidates[0]?.value || '/';
}

export default function BottomNav() {
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
        borderTop: '1px solid rgba(15, 23, 42, 0.08)',
        backdropFilter: 'blur(12px)',
        backgroundColor: 'rgba(255,255,255,0.96)',
        pb: 'env(safe-area-inset-bottom)',
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
          backgroundColor: 'transparent',
          minHeight: 64,
          '& .MuiBottomNavigationAction-root': {
            minWidth: 0,
            paddingLeft: 0.25,
            paddingRight: 0.25,
            paddingTop: 0.5,
            paddingBottom: 0.75,
            flex: 1,
            minHeight: 64,
          },
          '& .MuiBottomNavigationAction-label': {
            fontSize: '0.66rem',
            whiteSpace: 'nowrap',
            mt: 0.15,
          },
          '& .Mui-selected': {
            color: '#2563eb',
            fontWeight: 800,
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