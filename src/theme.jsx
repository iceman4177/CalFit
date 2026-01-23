// src/theme.jsx
import { createTheme, responsiveFontSizes } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';

// Slimcal palette (match Daily Evaluation vibes)
// - Primary = Slimcal Green (main CTAs)
// - Secondary = Slimcal Yellow (scores / verdict / highlights)
// - Info = keep a clean blue for nav / links
const SLIMCAL_GREEN  = '#22C55E'; // TW green-500
const SLIMCAL_YELLOW = '#FACC15'; // TW yellow-400
const SLIMCAL_BLUE   = '#2563EB'; // TW blue-600

let theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: SLIMCAL_GREEN,
      light: '#4ADE80', // green-400
      dark: '#16A34A',  // green-600
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: SLIMCAL_YELLOW,
      light: '#FDE047', // yellow-300
      dark: '#EAB308',  // yellow-500
      contrastText: '#0F172A', // slate-900 for legibility on yellow
    },
    success: { main: SLIMCAL_GREEN },
    warning: { main: SLIMCAL_YELLOW },
    error:   { main: '#EF4444' },
    info:    { main: SLIMCAL_BLUE },
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
    button: { textTransform: 'none', fontWeight: 800, letterSpacing: 0 },
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
          // Swap the old blue glow for a green->yellow glow like Eval
          background:
            `linear-gradient(180deg, ${alpha(SLIMCAL_GREEN, 0.06)} 0%, rgba(255,255,255,0) 18%),` +
            `radial-gradient(900px 380px at 20% 0%, ${alpha(SLIMCAL_YELLOW, 0.10)} 0%, rgba(255,255,255,0) 55%),` +
            `${t.palette.background.default}`,
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
          // Yellow buttons need a more subtle shadow + keep contrast crisp
          color: theme.palette.secondary.contrastText,
          '&:hover': {
            boxShadow: `0 6px 16px ${alpha(theme.palette.secondary.main, 0.22)}`,
          },
        }),
        outlinedSecondary: ({ theme }) => ({
          color: theme.palette.secondary.dark,
          borderColor: alpha(theme.palette.secondary.dark, 0.35),
          '&:hover': {
            borderColor: alpha(theme.palette.secondary.dark, 0.6),
            backgroundColor: alpha(theme.palette.secondary.main, 0.12),
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
          fontWeight: 800,
        }),
        filledSecondary: ({ theme }) => ({
          // Yellow chips need legible text
          color: theme.palette.secondary.contrastText,
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
  },
});

// Responsive type scaling
theme = responsiveFontSizes(theme);

export default theme;
