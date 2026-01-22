// src/components/BottomNav.jsx
import React from 'react';
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

const tabs = [
  { label: 'Evaluate', value: '/', icon: <HomeIcon /> },
  { label: 'Coach', value: '/coach', icon: <ChatIcon /> },
  { label: 'Workout', value: '/workout', icon: <FitnessCenterIcon /> },
  { label: 'Meals', value: '/meals', icon: <RestaurantIcon /> },
  { label: 'History', value: '/history', icon: <HistoryIcon /> },
  { label: 'Dashboard', value: '/dashboard', icon: <DashboardIcon /> },
];

function pickActiveTab(pathname) {
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
      }}
    >
      <BottomNavigation value={current} onChange={handleChange} showLabels>
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
