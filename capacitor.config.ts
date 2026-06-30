import type { CapacitorConfig } from '@capacitor/cli';

// Capacitor configuration for the iOS (and future Android) native wrapper.
// The web app is unchanged — `webDir: 'dist'` is the same Vite build that
// ships to GitHub Pages; `npx cap sync` copies it into the native project.
const config: CapacitorConfig = {
  appId: 'app.mobileserviceos',
  appName: 'Mobile Service OS',
  webDir: 'dist',

  // ── Live reload (DEVELOPMENT ONLY) ────────────────────────────────
  // Opt in with CAP_LIVE_RELOAD=1 before `npx cap sync` to point the native
  // shell at the deployed site so you can iterate without rebuilding the
  // bundle. PRODUCTION / App Store builds MUST ship the bundled dist/ (no
  // server.url) — a binary that only loads a remote URL risks App Review
  // guideline 4.2 ("minimum functionality"). So this is gated off by default.
  ...(process.env.CAP_LIVE_RELOAD
    ? { server: { url: 'https://app.mobileserviceos.app', cleartext: false } }
    : {}),

  plugins: {
    SplashScreen: {
      // MSOS navy background with the app icon; brief, no spinner.
      launchShowDuration: 1200,
      launchAutoHide: false, // we hide it from JS once the app is interactive
      backgroundColor: '#16263F', // MSOS navy
      showSpinner: false,
      iosSpinnerStyle: 'small',
      splashImmersive: false,
    },
    PushNotifications: {
      // Show banners/badges/sounds while the app is foregrounded too.
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
