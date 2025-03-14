import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  server: {
    port: 5173,  // Ensure the port is consistent with Replit's forwarding
    hmr: false,  // Disable Hot Module Replacement to prevent continuous reloading
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
});
