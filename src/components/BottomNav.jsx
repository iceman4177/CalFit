// src/components/BottomNav.jsx
import React from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import Paper from '@mui/material/Paper';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';

import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import RestaurantIcon    from '@mui/icons-material/Restaurant';
import HistoryIcon       from '@mui/icons-material/History';
import DashboardIcon     from '@mui/icons-material/Dashboard';
import HomeIcon          from '@mui/icons-material/Home';

const tabs = [
  { label: 'Home',     value: '/',          icon: <HomeIcon /> },
  { label: 'Workout',  value: '/workout',   icon: <FitnessCenterIcon /> },
  { label: 'Meals',    value: '/meals',     icon: <RestaurantIcon /> },
  { label: 'History',  value: '/history',   icon: <HistoryIcon /> },
  { label: 'Dashboard',value: '/dashboard', icon: <DashboardIcon /> },
];

export default function BottomNav() {
  const history = useHistory();
  const location = useLocation();

  // pick the active tab based on current pathname
  const current =
    tabs.find(t => location.pathname === t.value)?.value
    // if we're on a nested route like /recap, keep Home selected
    || (tabs.some(t => location.pathname.startsWith(t.value)) ? location.pathname : '/');

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
        {tabs.map(t => (
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
