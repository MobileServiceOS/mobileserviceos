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
      // launchAutoHide MUST stay true: the native splash hides on its own
      // after launchShowDuration so it can never trap the app if the JS hide
      // path is delayed/unavailable. initNative() also calls SplashScreen.hide()
      // for a snappier dismiss on success — belt and suspenders.
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#16263F', // MSOS navy
      showSpinner: false,
      splashImmersive: false,
    },
    PushNotifications: {
      // Show banners/badges/sounds while the app is foregrounded too.
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
