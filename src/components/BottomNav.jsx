// src/components/BottomNav.jsx
import * as React from 'react';
import { Paper, BottomNavigation, BottomNavigationAction } from '@mui/material';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import RestaurantMenuRoundedIcon from '@mui/icons-material/RestaurantMenuRounded';
import FitnessCenterRoundedIcon from '@mui/icons-material/FitnessCenterRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import WorkspacePremiumRoundedIcon from '@mui/icons-material/WorkspacePremiumRounded';
import { useNavigate, useLocation } from 'react-router-dom';

const MAP = [
  { to: '/',        icon: <HomeRoundedIcon />,            label: 'Home' },
  { to: '/meals',   icon: <RestaurantMenuRoundedIcon />,  label: 'Meals' },
  { to: '/workout', icon: <FitnessCenterRoundedIcon />,   label: 'Workout' },
  { to: '/history', icon: <HistoryRoundedIcon />,         label: 'History' },
  { to: '/upgrade', icon: <WorkspacePremiumRoundedIcon />,label: 'Pro' },
];

export default function BottomNav() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const value = MAP.findIndex(x => (x.to === '/' ? pathname === '/' : pathname.startsWith(x.to)));

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'fixed',
        bottom: 12,
        left: 12,
        right: 12,
        display: { xs: 'block', md: 'none' },
        borderRadius: 3,
        zIndex: (t) => t.zIndex.appBar, // stay above content
      }}
    >
      <BottomNavigation
        showLabels
        value={value === -1 ? 0 : value}
        onChange={(e, idx) => nav(MAP[idx].to)}
      >
        {MAP.map(x => (
          <BottomNavigationAction key={x.to} label={x.label} icon={x.icon} />
        ))}
      </BottomNavigation>
    </Paper>
  );
}
