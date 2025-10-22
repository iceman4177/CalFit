// src/components/Header.jsx
import * as React from 'react';
import {
  AppBar,
  Toolbar,
  Box,
  Stack,
  IconButton,
  Button,
  Drawer,
  List,
  ListItemButton,
  ListItemText,
  Divider,
  useMediaQuery,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { useTheme } from '@mui/material/styles';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import logoUrl from '../assets/logo.png';

const NAV = [
  { label: 'Dashboard', to: '/' },
  { label: 'Meals',     to: '/meals' },
  { label: 'Workout',   to: '/workout' },
  { label: 'History',   to: '/history' },
  { label: 'Upgrade',   to: '/upgrade', color: 'secondary' },
];

export default function Header() {
  const theme = useTheme();
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));
  const { pathname } = useLocation();
  const [open, setOpen] = React.useState(false);

  const isActive = (to) => (to === '/' ? pathname === '/' : pathname.startsWith(to));

  return (
    <>
      <AppBar position="sticky" color="default" elevation={0}>
        <Toolbar sx={{ minHeight: { xs: 56, sm: 64 } }}>
          {/* Logo + brand */}
          <Stack
            direction="row"
            alignItems="center"
            component={RouterLink}
            to="/"
            sx={{ textDecoration: 'none', color: 'inherit' }}
          >
            <Box
              component="img"
              src={logoUrl}
              alt="Slimcal.ai"
              sx={{ width: 34, height: 34, borderRadius: 2, mr: 1.25 }}
            />
            <Box
              component="span"
              sx={{ fontWeight: 800, letterSpacing: '-0.02em', fontSize: { xs: 18, sm: 20 } }}
            >
              Slimcal.ai
            </Box>
          </Stack>

          <Box sx={{ flexGrow: 1 }} />

          {/* Desktop nav */}
          {isMdUp ? (
            <Stack direction="row" spacing={1}>
              {NAV.map((item) => (
                <Button
                  key={item.to}
                  component={RouterLink}
                  to={item.to}
                  color={item.color || 'primary'}
                  variant={isActive(item.to) ? 'contained' : 'text'}
                  sx={{ fontWeight: 700, px: 2 }}
                >
                  {item.label}
                </Button>
              ))}
            </Stack>
          ) : (
            <IconButton aria-label="menu" onClick={() => setOpen(true)}>
              <MenuIcon />
            </IconButton>
          )}
        </Toolbar>
      </AppBar>

      {/* Mobile drawer */}
      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        PaperProps={{ sx: { width: 280 } }}
      >
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center' }}>
          <Box component="img" src={logoUrl} alt="Slimcal.ai" sx={{ width: 32, height: 32, borderRadius: 2, mr: 1 }} />
          <Box sx={{ fontWeight: 800 }}>Slimcal.ai</Box>
        </Box>
        <Divider />
        <List sx={{ p: 0 }}>
          {NAV.map((item) => (
            <ListItemButton
              key={item.to}
              component={RouterLink}
              to={item.to}
              selected={isActive(item.to)}
              onClick={() => setOpen(false)}
            >
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
        </List>
      </Drawer>
    </>
  );
}
