// src/lib/legalRoute.ts
// ═══════════════════════════════════════════════════════════════════
//  Resolve the legal-doc page from the URL. Two forms are accepted:
//    • query:      ?legal=privacy | ?legal=terms   (shareable in-app)
//    • clean path: /privacy | /terms               (App Store / email)
//
//  Clean paths matter for App Store submission — Apple's Privacy Policy
//  URL field wants a stable https://app.mobileserviceos.app/privacy that
//  resolves WITHOUT login. On GitHub Pages the 404 fallback preserves the
//  path (see public/404.html → index.html restore), so by the time the app
//  boots, location.pathname is '/privacy' and this picks it up.
//
//  Pure (takes pathname + search) so it's unit-testable without a DOM.
// ═══════════════════════════════════════════════════════════════════

export type LegalTab = 'privacy' | 'terms';

export function legalTabFromLocation(pathname: string, search: string): LegalTab | null {
  try {
    const q = new URLSearchParams(search || '').get('legal');
    if (q === 'privacy' || q === 'terms') return q;
    const path = (pathname || '').replace(/\/+$/, '').toLowerCase();
    if (path === '/privacy') return 'privacy';
    if (path === '/terms') return 'terms';
    return null;
  } catch {
    return null;
  }
}
