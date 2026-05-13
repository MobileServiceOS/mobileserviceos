import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Custom domain: https://app.mobileserviceos.app (served at root /)
// Override with VITE_BASE_PATH env var (e.g. '/mobileserviceos/' for the
// legacy project-page URL https://mobileserviceos.github.io/mobileserviceos/)
const base = process.env.VITE_BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          // Vendor chunk pre-grouping for better cache hit rate across
          // deploys. Each entry must be installed in package.json and
          // actually imported somewhere — Vite/Rollup will fail the build
          // with "Could not resolve entry module" if a name here isn't
          // a real installed dependency.
          //
          // Tab-based navigation lives in App.tsx (useState<TabId>) so
          // react-router-dom is intentionally absent — adding it back
          // here without installing the package will break the build.
          react: ['react', 'react-dom'],
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
          pdf: ['jspdf'],
        },
      },
    },
  },
});
