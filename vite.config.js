import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
 server: {
  port: 5173, // or 5174 if that's what you're using
  proxy: {
    '/api': 'http://localhost:8787'
  }
},

  preview: {
    port: 5173,  // Ensure the preview server uses the same port
  },

  resolve: {
    alias: {
      // Force Vite to resolve react-router-dom from node_modules
      'react-router-dom': path.resolve(__dirname, 'node_modules/react-router-dom'),
    },
  },

  optimizeDeps: {
    // Ensure react-router-dom is bundled correctly
    include: ['react-router-dom'],
  },

  build: {
    sourcemap: true
  },

  plugins: [sentryVitePlugin({
    org: "calfit",
    project: "javascript-react"
  })]
});