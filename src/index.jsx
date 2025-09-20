import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from './theme';
import './App.css';
import { BrowserRouter } from 'react-router-dom';
import { UserDataProvider } from './UserDataContext';
import { EntitlementsProvider } from './context/EntitlementsContext.jsx';  // ✅ make sure this path is correct
import { initGA } from './analytics';

initGA();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <EntitlementsProvider>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <UserDataProvider>
          <App />
        </UserDataProvider>
      </BrowserRouter>
    </ThemeProvider>
  </EntitlementsProvider>
);
