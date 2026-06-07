import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

// Stamp dist/sw.js with a unique build id so the service-worker file
// changes on EVERY production build. The custom SW (public/sw.js) keys
// its caches off VERSION and purges anything that doesn't match on
// activate — but only if the browser detects a changed sw.js. A static
// VERSION meant byte-identical sw.js across deploys, so the browser never
// updated the SW and users were pinned to a stale shell / old hashed
// bundle. Replacing __BUILD_ID__ at build time fixes that for good.
function stampServiceWorker() {
  return {
    name: 'stamp-sw-build-id',
    apply: 'build' as const,
    closeBundle() {
      const swPath = path.resolve(__dirname, 'dist/sw.js');
      try {
        const raw = fs.readFileSync(swPath, 'utf8');
        const buildId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        fs.writeFileSync(swPath, raw.split('__BUILD_ID__').join(buildId));
        // eslint-disable-next-line no-console
        console.log(`[stamp-sw] dist/sw.js stamped with build id ${buildId}`);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[stamp-sw] could not stamp dist/sw.js', e);
      }
    },
  };
}

// Asset base path.
//
// The app is served from a CUSTOM DOMAIN root: https://app.mobileserviceos.app
// → assets must resolve at /assets/... (NOT /mobileserviceos/assets/...).
//
// Default base is '/'. The VITE_BASE_PATH env var can still override it
// for a subpath deploy (e.g. a GitHub Pages project URL would set
// '/mobileserviceos/'), but the production custom-domain build uses '/'.
const base = process.env.VITE_BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [react(), stampServiceWorker()],
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
