// src/theme.jsx
import { createTheme, responsiveFontSizes } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';

// Slimcal.ai Brand Palette (system-first)
const SLIMCAL_BLUE = '#2563EB';
const SLIMCAL_BLUE_HOVER = '#1D4ED8';

const SLIMCAL_GREEN = '#22C55E';
const SLIMCAL_GREEN_SOFT = '#86EFAC';

const SLIMCAL_RED = '#EF4444';

// Neutral system (premium feel)
const BG_DEFAULT = '#F8FAFC';
const SURFACE = '#FFFFFF';
const DIVIDER = '#E5E7EB';

const TEXT_PRIMARY = '#111827';
const TEXT_SECONDARY = '#6B7280';
const TEXT_MUTED = '#9CA3AF';

let theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: SLIMCAL_BLUE,         // Trust / Structure
      light: '#4F83F1',
      dark: SLIMCAL_BLUE_HOVER,
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: SLIMCAL_GREEN,        // Fitness success / dopamine
      light: SLIMCAL_GREEN_SOFT,
      dark: '#16A34A',
      contrastText: '#FFFFFF',
    },
    success: { main: SLIMCAL_GREEN },
    warning: { main: '#F59E0B' }, // keep as traditional warning if needed
    error:   { main: SLIMCAL_RED },
    info:    { main: SLIMCAL_BLUE }, // keep info aligned with brand trust
    background: {
      default: BG_DEFAULT,
      paper: SURFACE,
    },
    text: {
      primary: TEXT_PRIMARY,
      secondary: TEXT_SECONDARY,
      disabled: TEXT_MUTED,
    },
    divider: DIVIDER,
  },

  shape: {
    borderRadius: 14,
  },

  spacing: 8,

  typography: {
    fontFamily: "'Roboto', system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
    h1: { fontSize: '2.25rem', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 },
    h2: { fontSize: '1.875rem', fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.2 },
    h3: { fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.25 },
    h4: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.3 },
    h5: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.35 },
    h6: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 },
    subtitle1: { fontSize: '1rem', fontWeight: 500, color: TEXT_SECONDARY },
    subtitle2: { fontSize: '0.9rem', fontWeight: 500, color: alpha(TEXT_PRIMARY, 0.65) },
    body1: { fontSize: '1rem', lineHeight: 1.6 },
    body2: { fontSize: '0.95rem', lineHeight: 1.55, color: TEXT_SECONDARY },
    button: { textTransform: 'none', fontWeight: 800, letterSpacing: 0 },
    overline: { textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.08em' },
    caption: { color: alpha(TEXT_PRIMARY, 0.55) },
  },

  transitions: {
    duration: {
      shortest: 100,
      shorter: 150,
      short: 200,
      standard: 250,
      complex: 300,
      enteringScreen: 200,
      leavingScreen: 150,
    },
  },

  components: {
    MuiCssBaseline: {
      styleOverrides: (t) => ({
        'html, body, #root': {
          height: '100%',
          // Blue trust glow (subtle) — keep premium, not loud
          background:
            `linear-gradient(180deg, ${alpha(SLIMCAL_BLUE, 0.05)} 0%, rgba(255,255,255,0) 22%), ${t.palette.background.default}`,
        },
        body: {
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        },
        '*::-webkit-scrollbar': { width: 10, height: 10 },
        '*::-webkit-scrollbar-thumb': {
          backgroundColor: alpha(TEXT_PRIMARY, 0.15),
          borderRadius: 999,
          border: '2px solid transparent',
          backgroundClip: 'content-box',
        },
        '*::-webkit-scrollbar-thumb:hover': {
          backgroundColor: alpha(TEXT_PRIMARY, 0.25),
        },
      }),
    },

    // Buttons: bold, rounded, subtle elevation + hover lift
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: theme.shape.borderRadius,
          paddingInline: theme.spacing(2.25),
          paddingBlock: theme.spacing(1.125),
          boxShadow: 'none',
          transition: theme.transitions.create(['transform', 'box-shadow', 'background-color'], {
            duration: theme.transitions.duration.short,
          }),
          '&:hover': {
            transform: 'translateY(-1px)',
            boxShadow: `0 6px 16px ${alpha(theme.palette.primary.main, 0.18)}`,
          },
          '&:active': { transform: 'translateY(0)' },
        }),

        // Make Primary (blue) hover use your exact hover blue
        containedPrimary: ({ theme }) => ({
          '&:hover': {
            backgroundColor: SLIMCAL_BLUE_HOVER,
            boxShadow: `0 6px 16px ${alpha(SLIMCAL_BLUE, 0.22)}`,
          },
        }),

        // Secondary (green) hover uses green shadow (success feel)
        containedSecondary: ({ theme }) => ({
          '&:hover': {
            boxShadow: `0 6px 16px ${alpha(theme.palette.secondary.main, 0.20)}`,
          },
        }),
      },
    },

    // Cards: soft shadow, clean padding
    MuiCard: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: theme.shape.borderRadius + 2,
          boxShadow: `0 8px 24px ${alpha(TEXT_PRIMARY, 0.06)}`,
          border: `1px solid ${alpha(TEXT_PRIMARY, 0.06)}`,
        }),
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: { padding: 20, '&:last-child': { paddingBottom: 20 } },
      },
    },

    // Paper (dialogs, menus) with consistent rounding & border
    MuiPaper: {
      styleOverrides: {
        rounded: ({ theme }) => ({
          borderRadius: theme.shape.borderRadius + 2,
        }),
        elevation1: {
          boxShadow: `0 6px 20px ${alpha(TEXT_PRIMARY, 0.08)}`,
        },
      },
    },

    // AppBar: translucent with blur
    MuiAppBar: {
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: alpha('#FFFFFF', 0.7),
          backdropFilter: 'blur(8px)',
          color: theme.palette.text.primary,
          boxShadow: `0 6px 20px ${alpha(TEXT_PRIMARY, 0.06)}`,
          borderBottom: `1px solid ${alpha(TEXT_PRIMARY, 0.06)}`,
        }),
      },
    },
    MuiToolbar: {
      styleOverrides: {
        root: { minHeight: 64, '@media (max-width:600px)': { minHeight: 56 } },
      },
    },

    // Inputs: clearer focus and rounded fields
    MuiTextField: {
      defaultProps: { size: 'medium' },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: theme.shape.borderRadius,
        }),
        notchedOutline: ({ theme }) => ({
          borderColor: alpha(TEXT_PRIMARY, 0.18),
        }),
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: ({ theme }) => ({
          color: alpha(TEXT_PRIMARY, 0.7),
          '&.Mui-focused': { color: theme.palette.primary.main },
        }),
      },
    },

    // Chips / Pills used for filters
    MuiChip: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: theme.shape.borderRadius,
          fontWeight: 800,
        }),
      },
    },

    // Dividers lighter & elegant
    MuiDivider: {
      styleOverrides: {
        root: {
          backgroundColor: DIVIDER,
        },
      },
    },

    MuiContainer: {
      defaultProps: { maxWidth: 'lg' },
    },

    MuiTooltip: {
      styleOverrides: {
        tooltip: ({ theme }) => ({
          borderRadius: theme.shape.borderRadius,
          padding: theme.spacing(1),
          fontSize: 12.5,
        }),
      },
    },

    // Tabs / Tab for nav polish
    MuiTab: {
      styleOverrides: {
        root: ({ theme }) => ({
          textTransform: 'none',
          fontWeight: 700,
          borderRadius: theme.shape.borderRadius,
          minHeight: 44,
          paddingInline: theme.spacing(1.5),
        }),
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: ({ theme }) => ({
          height: 3,
          borderRadius: 3,
          backgroundColor: theme.palette.primary.main,
        }),
      },
    },

    // Progress: default blue (trust). Components can opt-in to green for “winning”.
    MuiLinearProgress: {
      styleOverrides: {
        root: ({ theme }) => ({
          height: 10,
          borderRadius: 999,
          backgroundColor: alpha(TEXT_PRIMARY, 0.08),
        }),
        bar: ({ theme }) => ({
          borderRadius: 999,
          backgroundColor: theme.palette.primary.main,
        }),
      },
    },
  },
});

// Responsive type scaling
theme = responsiveFontSizes(theme);

export default theme;
