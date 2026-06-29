// src/lib/theme.ts
// ═══════════════════════════════════════════════════════════════════
//  Theme (dark / light). The app is DARK by default — :root in app.css
//  defines the dark palette. Light mode is opt-in via a
//  `data-theme="light"` attribute on <html> which overrides the surface
//  / text / border / status tokens. The choice persists in localStorage
//  and is applied pre-render by a tiny inline script in index.html (so
//  there's no dark-to-light flash on load).
// ═══════════════════════════════════════════════════════════════════

export type ThemeName = 'dark' | 'light';

const STORAGE_KEY = 'msos_theme';

/** The persisted theme, defaulting to dark (the app's original look). */
export function getStoredTheme(): ThemeName {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Apply a theme to the document (attribute + native control scheme +
 *  the PWA status-bar color). Pure DOM side effect; safe to call repeatedly. */
export function applyTheme(theme: ThemeName): void {
  if (typeof document === 'undefined') return;
  try {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f3f4f6' : '#0B0B0B');
  } catch {
    /* SSR / restricted env — no-op */
  }
}

/** Persist + apply a theme. */
export function setTheme(theme: ThemeName): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode / disabled storage — still apply for this session */
  }
  applyTheme(theme);
}
