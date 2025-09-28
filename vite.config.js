// vite.config.js
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig } from "vite";
import path from "path";

export default defineConfig(({ mode }) => ({
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
  },
  preview: { port: 5173 },

  resolve: {
    alias: {
      "react-router-dom": path.resolve(__dirname, "node_modules/react-router-dom"),
    },
  },

  optimizeDeps: {
    include: ["react-router-dom"],
  },

  build: {
    // IMPORTANT: prevents eval-like dev sourcemaps and dev helpers
    sourcemap: false,
    minify: "esbuild",
    target: "esnext",
    // Ensure a clean static build for Vercel
    assetsInlineLimit: 0,
    cssCodeSplit: true,
  },

  // Only run Sentry plugin for production builds (keeps local dev fast/clean)
  plugins: [
    mode === "production" &&
      sentryVitePlugin({
        org: "calfit",
        project: "javascript-react",
        // (Optional) if you upload sourcemaps to Sentry, keep them OFF in the client bundle
        // and upload from the build artifacts instead.
        // Set SENTRY_AUTH_TOKEN in your CI env for uploads.
      }),
  ].filter(Boolean),
}));
