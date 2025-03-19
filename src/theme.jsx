import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'light', // Can later be switched to 'dark'
    primary: {
      main: '#007bff', // Blue
    },
    secondary: {
      main: '#ff4081', // Pink
    },
    background: {
      default: '#f4f6f8', // Light gray
    },
  },
  typography: {
    fontFamily: "'Roboto', sans-serif",
    h1: { fontSize: '2rem', fontWeight: 700 },
    h2: { fontSize: '1.5rem', fontWeight: 600 },
    h3: { fontSize: '1.2rem', fontWeight: 500 },
  },
});

export default theme;
