// src/lib/googleConnect.ts
// ═══════════════════════════════════════════════════════════════════
//  Client kickoff for the Google (Search Console + Business Profile)
//  OAuth connect flow. Calls the googleOAuthStart callable to get a
//  signed consent URL, then redirects the browser to Google. The
//  callback function stores the token and bounces back to the app with
//  ?google_connected=1 (or ?google_error=…).
// ═══════════════════════════════════════════════════════════════════

import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';

function fns() {
  const f = getFunctions();
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  if (
    env.DEV && typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
    env.VITE_USE_FIREBASE_EMULATOR === '1'
  ) {
    try { connectFunctionsEmulator(f, '127.0.0.1', 5001); } catch { /* already connected */ }
  }
  return f;
}

/**
 * Begin connecting Google. Resolves the signed consent URL then redirects
 * the browser. Throws on failure (e.g. 'failed-precondition' when the
 * GOOGLE_OAUTH_* secrets aren't set on the function yet) so the caller can
 * surface a message.
 */
export async function startGoogleConnect(businessId: string): Promise<void> {
  const call = httpsCallable<{ businessId: string }, { url: string }>(fns(), 'googleOAuthStart');
  const res = await call({ businessId });
  const url = res.data?.url;
  if (!url) throw new Error('No consent URL returned');
  window.location.href = url;
}
