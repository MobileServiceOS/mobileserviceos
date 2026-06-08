// functions/src/googleOAuth.ts
// ═══════════════════════════════════════════════════════════════════
//  Google OAuth connect flow for Search Console + Business Profile.
//
//  Flow:
//    1. Client (owner/admin) calls `googleOAuthStart` → returns the
//       Google consent URL with a SIGNED state (businessId+uid+exp,
//       HMAC-SHA256). The client redirects the browser there.
//    2. Google redirects to `googleOAuthCallback` with code + state.
//       We verify the state signature, exchange the code for tokens,
//       store the REFRESH TOKEN in integrations_private/google (admin-
//       only; never client-readable) and a status doc in
//       integrations/google (client-readable, no secrets), then redirect
//       back to the app.
//
//  Data sync (pulling reviews / impressions) is a SEPARATE step — Search
//  Console works once connected; Business Profile review data needs
//  Google to approve the project for Business Profile API access first.
//
//  Required secrets (firebase functions:secrets:set …):
//    GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
//    GOOGLE_OAUTH_STATE_SECRET (any long random string).
//  Optional env: GOOGLE_OAUTH_REDIRECT_URI (defaults to the gen-2 alias
//    URL below — must EXACTLY match the redirect URI on the OAuth client).
// ═══════════════════════════════════════════════════════════════════

import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import * as crypto from 'crypto';

const GOOGLE_OAUTH_CLIENT_ID = defineSecret('GOOGLE_OAUTH_CLIENT_ID');
const GOOGLE_OAUTH_CLIENT_SECRET = defineSecret('GOOGLE_OAUTH_CLIENT_SECRET');
const GOOGLE_OAUTH_STATE_SECRET = defineSecret('GOOGLE_OAUTH_STATE_SECRET');

const APP_URL = 'https://app.mobileserviceos.app';

// Stable gen-2 alias URL. Override with GOOGLE_OAUTH_REDIRECT_URI if the
// deployed function reports a different URL. This MUST exactly match the
// "Authorized redirect URI" on the Google OAuth client.
function redirectUri(): string {
  return (
    process.env.GOOGLE_OAUTH_REDIRECT_URI ||
    'https://us-central1-mobile-service-os.cloudfunctions.net/googleOAuthCallback'
  );
}

const SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly', // Search Console (no special approval)
  'https://www.googleapis.com/auth/business.manage',     // Business Profile (needs API approval to read reviews)
].join(' ');

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function signState(payload: object, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}
function verifyState(state: string, secret: string): { businessId: string; uid: string; exp: number } | null {
  const [body, sig] = (state || '').split('.');
  if (!body || !sig) return null;
  const expected = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(unb64url(body).toString('utf8'));
    if (typeof data.exp !== 'number' || Date.now() > data.exp) return null;
    if (typeof data.businessId !== 'string' || typeof data.uid !== 'string') return null;
    return data;
  } catch { return null; }
}

async function assertOwnerAdmin(businessId: string, uid: string): Promise<void> {
  if (uid === businessId) return; // convention owner
  const db = admin.firestore();
  const root = await db.doc(`businesses/${businessId}`).get();
  if (root.exists && root.data()?.ownerUid === uid) return;
  const m = await db.doc(`businesses/${businessId}/members/${uid}`).get();
  const role = m.exists ? m.data()?.role : null;
  if (role === 'owner' || role === 'admin') return;
  throw new HttpsError('permission-denied', 'owner or admin only');
}

/** Step 1 — owner/admin requests the Google consent URL (signed state). */
export const googleOAuthStart = onCall<{ businessId: string }>(
  { secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_STATE_SECRET] },
  async (req) => {
    const uid = req.auth?.uid;
    const businessId = req.data?.businessId;
    if (!uid) throw new HttpsError('unauthenticated', 'sign-in required');
    if (!businessId) throw new HttpsError('invalid-argument', 'businessId required');
    await assertOwnerAdmin(businessId, uid);

    const clientId = GOOGLE_OAUTH_CLIENT_ID.value();
    if (!clientId) throw new HttpsError('failed-precondition', 'Google OAuth not configured (missing client id)');

    const state = signState(
      { businessId, uid, exp: Date.now() + 10 * 60 * 1000 },
      GOOGLE_OAUTH_STATE_SECRET.value(),
    );
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    }).toString();
    return { url };
  },
);

/** Step 2 — Google redirects here; verify, exchange, store, bounce back. */
export const googleOAuthCallback = onRequest(
  { secrets: [GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_STATE_SECRET], cors: false },
  async (req, res) => {
    const fail = (msg: string) => res.redirect(`${APP_URL}/?google_error=${encodeURIComponent(msg)}`);
    try {
      if (req.query.error) return fail(String(req.query.error));
      const code = String(req.query.code || '');
      const state = String(req.query.state || '');
      if (!code || !state) return fail('missing_code_or_state');

      const verified = verifyState(state, GOOGLE_OAUTH_STATE_SECRET.value());
      if (!verified) return fail('invalid_or_expired_state');
      const { businessId, uid } = verified;

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_OAUTH_CLIENT_ID.value(),
          client_secret: GOOGLE_OAUTH_CLIENT_SECRET.value(),
          redirect_uri: redirectUri(),
          grant_type: 'authorization_code',
        }).toString(),
      });
      const tok = (await tokenRes.json()) as {
        refresh_token?: string; access_token?: string; scope?: string; error?: string;
      };
      if (!tokenRes.ok || !tok.refresh_token) {
        return fail(tok.error || 'token_exchange_failed');
      }

      const db = admin.firestore();
      // Secret refresh token — admin-only doc, never client-readable.
      await db.doc(`businesses/${businessId}/integrations_private/google`).set({
        refreshToken: tok.refresh_token,
        scope: tok.scope || SCOPES,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      // Client-readable status (no secrets).
      await db.doc(`businesses/${businessId}/integrations/google`).set({
        status: 'connected',
        scope: tok.scope || SCOPES,
        connectedAt: admin.firestore.FieldValue.serverTimestamp(),
        connectedByUid: uid,
        lastSyncAt: null,
      }, { merge: true });

      return res.redirect(`${APP_URL}/?google_connected=1`);
    } catch {
      return fail('callback_error');
    }
  },
);
