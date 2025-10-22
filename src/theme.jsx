// src/theme.jsx
import { createTheme, responsiveFontSizes } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';

let theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#2563EB',       // Accessible blue (TW blue-600)
      light: '#4F83F1',
      dark: '#1E4FCC',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: '#F43F5E',       // Rose (assertive accent)
      light: '#F77A8F',
      dark: '#C12D47',
      contrastText: '#FFFFFF',
    },
    success: { main: '#10B981' },
    warning: { main: '#F59E0B' },
    error:   { main: '#EF4444' },
    info:    { main: '#0EA5E9' },
    background: {
      default: '#F8FAFC',    // Soft slate-50
      paper:   '#FFFFFF',
    },
    text: {
      primary: '#0F172A',    // slate-900
      secondary: '#334155',  // slate-700
      disabled: '#94A3B8',   // slate-400
    },
    divider: alpha('#0F172A', 0.08),
  },

  shape: {
    borderRadius: 14,        // Rounded but not bubbly
  },

  spacing: 8,                // 8pt baseline grid

  typography: {
    fontFamily: "'Roboto', system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
    h1: { fontSize: '2.25rem', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }, // 36px
    h2: { fontSize: '1.875rem', fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.2 }, // 30px
    h3: { fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.25 },                            // 24px
    h4: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.3 },                             // 20px
    h5: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.35 },                           // 18px
    h6: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 },                                // 16px
    subtitle1: { fontSize: '1rem', fontWeight: 500, color: '#334155' },
    subtitle2: { fontSize: '0.9rem', fontWeight: 500, color: '#475569' },
    body1: { fontSize: '1rem', lineHeight: 1.6 },
    body2: { fontSize: '0.95rem', lineHeight: 1.55, color: '#334155' },
    button: { textTransform: 'none', fontWeight: 700, letterSpacing: 0 },
    overline: { textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.08em' },
    caption: { color: '#64748B' },
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
          background:
            `linear-gradient(180deg, ${alpha('#2563EB', 0.04)} 0%, rgba(255,255,255,0) 22%), ${t.palette.background.default}`,
        },
        body: {
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        },
        // Subtle, nice scrollbars
        '*::-webkit-scrollbar': { width: 10, height: 10 },
        '*::-webkit-scrollbar-thumb': {
          backgroundColor: alpha('#0F172A', 0.15),
          borderRadius: 999,
          border: '2px solid transparent',
          backgroundClip: 'content-box',
        },
        '*::-webkit-scrollbar-thumb:hover': {
          backgroundColor: alpha('#0F172A', 0.25),
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
        containedSecondary: ({ theme }) => ({
          '&:hover': {
            boxShadow: `0 6px 16px ${alpha(theme.palette.secondary.main, 0.2)}`,
          },
        }),
      },
    },

    // Cards: soft shadow, clean padding
    MuiCard: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: theme.shape.borderRadius + 2,
          boxShadow: `0 8px 24px ${alpha('#0F172A', 0.06)}`,
          border: `1px solid ${alpha('#0F172A', 0.06)}`,
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
          boxShadow: `0 6px 20px ${alpha('#0F172A', 0.08)}`,
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
          boxShadow: `0 6px 20px ${alpha('#0F172A', 0.06)}`,
          borderBottom: `1px solid ${alpha('#0F172A', 0.06)}`,
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
          borderColor: alpha('#0F172A', 0.18),
        }),
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: ({ theme }) => ({
          color: alpha('#0F172A', 0.7),
          '&.Mui-focused': { color: theme.palette.primary.main },
        }),
      },
    },

    // Chips / Pills used for filters
    MuiChip: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: theme.shape.borderRadius,
        }),
      },
    },

    // Dividers lighter & elegant
    MuiDivider: {
      styleOverrides: {
        root: {
          backgroundColor: alpha('#0F172A', 0.08),
        },
      },
    },

    // Container defaults
    MuiContainer: {
      defaultProps: { maxWidth: 'lg' },
    },

    // Tooltips nicer rounding
    MuiTooltip: {
      styleOverrides: {
        tooltip: ({ theme }) => ({
          borderRadius: theme.shape.borderRadius,
          padding: theme.spacing(1),
          fontSize: 12.5,
        }),
      },
    },

    // Tabs / Tab for nav polish (if you use them)
    MuiTab: {
      styleOverrides: {
        root: ({ theme }) => ({
          textTransform: 'none',
          fontWeight: 600,
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
  },
});

// Responsive type scaling
theme = responsiveFontSizes(theme);

export default theme;
