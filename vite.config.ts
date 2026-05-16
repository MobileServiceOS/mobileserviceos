import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// GitHub Pages project path: /mobileserviceos/
// Override with VITE_BASE_PATH env var (e.g. '/' for root domains)
const base = process.env.VITE_BASE_PATH ?? '/mobileserviceos/';

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
          // Group heavy third-party deps into stable, cacheable chunks.
          // IMPORTANT: every package listed here MUST be a real installed
          // dependency. Listing a package that isn't installed (e.g. a
          // router lib the app doesn't use) makes Rollup emit a broken
          // chunk → the browser loads JS that throws on import → React
          // never mounts → the boot watchdog reports "No JavaScript
          // loaded". This app uses a custom tab-state router in App.tsx
          // (useState<TabId>), NOT react-router — so it is NOT listed.
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
          react: ['react', 'react-dom'],
          pdf: ['jspdf'],
        },
      },
    },
  },
});
