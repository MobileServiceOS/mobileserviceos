// src/lib/native.ts
// ═══════════════════════════════════════════════════════════════════
//  Capacitor native bridge. EVERY function here is a no-op on the web
//  PWA (guarded by Capacitor.isNativePlatform()), so the existing web
//  app is completely unaffected. The plugins are dynamically imported
//  only inside the native guard, so their code never enters the web
//  bundle's startup path.
// ═══════════════════════════════════════════════════════════════════

import { Capacitor } from '@capacitor/core';
import { getStoredTheme } from '@/lib/theme';

/** True only inside the iOS/Android Capacitor shell. */
export const isNative = (): boolean => Capacitor.isNativePlatform();

let pushRequested = false;

/**
 * One-time native bootstrap: theme-matched status bar + dismiss the splash
 * once the web app is interactive. Returns immediately on the web.
 */
export async function initNative(): Promise<void> {
  if (!isNative()) return;
  await syncStatusBarToTheme();
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();
  } catch { /* config fallback hides it */ }
}

/**
 * Apply the status-bar style to match the current theme: light theme → dark
 * content; dark theme (default) → light content. Called on boot and whenever
 * the user flips the theme so the bar stays legible.
 */
export async function syncStatusBarToTheme(): Promise<void> {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: getStoredTheme() === 'light' ? Style.Light : Style.Dark });
  } catch { /* status bar not critical */ }
}

/**
 * Request push-notification permission AFTER onboarding — never on a cold
 * first launch. Idempotent (fires once) and denial-safe: a declined or
 * dismissed prompt just returns and the app keeps working normally. On grant
 * it registers with APNs.
 */
export async function requestPushPermissionAfterOnboarding(): Promise<void> {
  if (!isNative() || pushRequested) return;
  pushRequested = true;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return; // declined — app continues unaffected
    await PushNotifications.register();
  } catch (e) {
    // A push failure must never break the app.
    // eslint-disable-next-line no-console
    console.warn('[native] push setup skipped:', e);
  }
}
