// src/components/BottomNav.jsx
import React, { useMemo, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import Paper from '@mui/material/Paper';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';

import HomeIcon from '@mui/icons-material/Home';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import EventNoteIcon from '@mui/icons-material/EventNote';
import PsychologyAltIcon from '@mui/icons-material/PsychologyAlt';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import DashboardIcon from '@mui/icons-material/Dashboard';

const tabs = [
  { label: 'Home', value: '/home', route: '/', icon: <HomeIcon /> },
  { label: 'Log', value: '/log', route: null, icon: <AddCircleOutlineIcon /> },
  { label: 'Plan', value: '/plan', route: '/daily-checklist', icon: <EventNoteIcon /> },
  { label: 'Coach', value: '/coach', route: '/coach', icon: <PsychologyAltIcon /> },
  { label: 'Scan', value: '/scan', route: '/body-scan/session', icon: <CenterFocusStrongIcon /> },
];

function pickActiveTab(pathname) {
  if (pathname === '/' || pathname.startsWith('/?')) return '/home';
  if (pathname === '/meals' || pathname.startsWith('/meals/')) return '/log';
  if (pathname === '/workout' || pathname.startsWith('/workout/')) return '/log';
  if (pathname === '/daily-checklist' || pathname.startsWith('/daily-checklist/')) return '/plan';
  if (pathname === '/daily-eval' || pathname.startsWith('/daily-eval/')) return '/plan';
  if (pathname === '/verdict' || pathname.startsWith('/verdict/')) return '/coach';
  if (pathname === '/coach' || pathname.startsWith('/coach/')) return '/coach';
  if (pathname === '/body-scan' || pathname.startsWith('/body-scan/')) return '/scan';
  return '/home';
}

export default function BottomNav() {
  const history = useHistory();
  const location = useLocation();
  const current = useMemo(() => pickActiveTab(location.pathname), [location.pathname]);
  const [logAnchorEl, setLogAnchorEl] = useState(null);

  const openLogMenu = (target) => setLogAnchorEl(target);
  const closeLogMenu = () => setLogAnchorEl(null);

  const goTo = (route) => {
    closeLogMenu();
    if (route && route !== location.pathname) history.push(route);
  };

  const handleChange = (event, newValue) => {
    const selected = tabs.find((tab) => tab.value === newValue);
    if (!selected) return;

    if (selected.value === '/log') {
      openLogMenu(event?.currentTarget || event?.target || null);
      return;
    }

    if (selected.route && selected.route !== location.pathname) {
      history.push(selected.route);
    }
  };

  return (
    <>
      <Paper
        elevation={3}
        sx={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          display: { xs: 'block', md: 'none' },
          zIndex: (theme) => theme.zIndex.appBar,
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
            minHeight: 66,
            '& .MuiBottomNavigationAction-root': {
              minWidth: 0,
              paddingLeft: 0.25,
              paddingRight: 0.25,
              paddingTop: 0.5,
              paddingBottom: 0.75,
              flex: 1,
              minHeight: 66,
            },
            '& .MuiBottomNavigationAction-label': {
              fontSize: '0.68rem',
              whiteSpace: 'nowrap',
              mt: 0.15,
              fontWeight: 700,
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

      <Menu
        anchorEl={logAnchorEl}
        open={Boolean(logAnchorEl)}
        onClose={closeLogMenu}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        PaperProps={{
          elevation: 6,
          sx: {
            mb: 1,
            borderRadius: 3,
            minWidth: 170,
            overflow: 'hidden',
          },
        }}
      >
        <MenuItem onClick={() => goTo('/workout')}>
          <ListItemIcon>
            <FitnessCenterIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Workout" />
        </MenuItem>
        <MenuItem onClick={() => goTo('/meals')}>
          <ListItemIcon>
            <RestaurantIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Meals" />
        </MenuItem>
        <MenuItem onClick={() => goTo('/dashboard')}>
          <ListItemIcon>
            <DashboardIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Dashboard" />
        </MenuItem>
      </Menu>
    </>
  );
}
