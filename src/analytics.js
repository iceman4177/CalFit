// src/analytics.js
import ReactGA from 'react-ga4';

// Replace 'G-XXXXXXXXXX' with your actual GA4 Measurement ID
export function initGA() {
  ReactGA.initialize('G-0PBM0SW18X');
}

// Log a page view event to GA4
export function logPageView(page) {
  ReactGA.send({ hitType: 'pageview', page });
}
