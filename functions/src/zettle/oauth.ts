// functions/src/zettle/oauth.ts
// ═══════════════════════════════════════════════════════════════════
//  Zettle OAuth — merchant connect flow (authorization code + PKCE).
//
//  connectZettle (callable, owner/admin)
//    → returns the Zettle authorize URL; stashes PKCE verifier + state
//      in the private path.
//  zettleOAuthCallback (HTTPS)
//    → Zettle redirects here with code+state; we exchange for tokens,
//      store them encrypted, create the PurchaseCreated webhook
//      subscription (stores signingKey), index org→business, and flip
//      settings.zettleConnected.
//
//  Ships DORMANT (ZETTLE_ENABLED).
// ═══════════════════════════════════════════════════════════════════

import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { createHash, randomBytes } from 'crypto';
import { ZETTLE_ENABLED, ZETTLE_SECRETS } from '../lib/zettleEnabled';
import {
  buildAuthorizeUrl, exchangeAuthCode, createPurchaseWebhook, getUserInfo, getTokenFromApiKey,
} from '../lib/zettleClient';
import { storeTokens, storeApiKeyConnection, loadPrivate } from './tokens';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function redirectUri(): string {
  return process.env.ZETTLE_REDIRECT_URI || '';
}

function webhookUrl(): string {
  return process.env.ZETTLE_WEBHOOK_URL
    || 'https://us-central1-mobile-service-os.cloudfunctions.net/zettleWebhook';
}

export const connectZettle = onCall<{ businessId: string }, Promise<{ authorizeUrl: string }>>(
  { secrets: ZETTLE_SECRETS },
  async (req) => {
    const uid = req.auth?.uid;
    const businessId = req.data?.businessId ?? '';
    if (!uid) throw new HttpsError('unauthenticated', 'sign-in required');
    if (!businessId) throw new HttpsError('invalid-argument', 'businessId required');
    if (!ZETTLE_ENABLED) throw new HttpsError('failed-precondition', 'Zettle integration not configured');

    const db = admin.firestore();
    const role = (await db.doc(`businesses/${businessId}/members/${uid}`).get()).get('role');
    const isConventionOwner = uid === businessId;
    if (!isConventionOwner && role !== 'owner' && role !== 'admin') {
      throw new HttpsError('permission-denied', 'owner or admin only');
    }

    const codeVerifier = b64url(randomBytes(32));
    const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest());
    const state = `${businessId}.${b64url(randomBytes(16))}`;

    await db.doc(`zettleSecure/${businessId}/private/tokens`).set({
      pendingAuth: { state, codeVerifier, createdAtMs: Date.now() },
    }, { merge: true });

    return { authorizeUrl: buildAuthorizeUrl({ redirectUri: redirectUri(), state, codeChallenge }) };
  },
);

/**
 * connectZettleApiKey (callable, owner/admin) — Path A "own organization"
 * connect. The owner pastes the Zettle API key they generated for their own
 * account; we exchange it for an access token (JWT-bearer assertion grant),
 * store the key + token encrypted, register the real-time webhook
 * (best-effort), and flip settings.zettleConnected. No merchant redirect.
 * Downstream import / matching / auto-pay are identical to the OAuth path.
 */
export const connectZettleApiKey = onCall<
  { businessId: string; apiKey: string },
  Promise<{ ok: boolean; accountName: string; webhook: boolean }>
>(
  { secrets: ZETTLE_SECRETS },
  async (req) => {
    const uid = req.auth?.uid;
    const businessId = req.data?.businessId ?? '';
    const apiKey = (req.data?.apiKey ?? '').trim();
    if (!uid) throw new HttpsError('unauthenticated', 'sign-in required');
    if (!businessId) throw new HttpsError('invalid-argument', 'businessId required');
    if (!apiKey) throw new HttpsError('invalid-argument', 'apiKey required');
    if (!ZETTLE_ENABLED) throw new HttpsError('failed-precondition', 'Zettle integration not configured');

    const db = admin.firestore();
    const role = (await db.doc(`businesses/${businessId}/members/${uid}`).get()).get('role');
    const isConventionOwner = uid === businessId;
    if (!isConventionOwner && role !== 'owner' && role !== 'admin') {
      throw new HttpsError('permission-denied', 'owner or admin only');
    }

    // 1. Exchange the API key for an access token (own-org assertion grant).
    let token: { accessToken: string; expiresAtMs: number };
    try {
      token = await getTokenFromApiKey(apiKey);
    } catch (err) {
      throw new HttpsError('failed-precondition', `Zettle rejected the API key — ${(err as Error).message}`);
    }
    await storeApiKeyConnection(db, businessId, apiKey, token);

    // 2. Org info (best-effort — for the Settings display name).
    const info = await getUserInfo(token.accessToken).catch(() => ({} as Record<string, unknown>));
    const orgInfo = info as { organizationName?: string; organizationUuid?: string; uuid?: string };
    const organizationUuid = orgInfo.organizationUuid || orgInfo.uuid || '';

    // 3. Real-time webhook (best-effort: historical import works without it,
    //    so a webhook failure must not block connecting).
    let webhook = false;
    try {
      const ownerEmail = (await db.doc(`businesses/${businessId}`).get()).get('ownerEmail') || 'owner@example.com';
      const sub = await createPurchaseWebhook(token.accessToken, { webhookUrl: webhookUrl(), contactEmail: ownerEmail });
      await db.doc(`zettleSecure/${businessId}/private/tokens`).set(
        { signingKey: sub.signingKey, subscriptionUuid: sub.uuid, organizationUuid }, { merge: true },
      );
      webhook = true;
    } catch (err) {
      console.warn('[connectZettleApiKey] webhook setup failed — historical import still works', (err as Error).message);
      await db.doc(`zettleSecure/${businessId}/private/tokens`).set({ organizationUuid }, { merge: true });
    }

    if (organizationUuid) {
      await db.doc(`zettleOrgs/${organizationUuid}`).set({ businessId, createdAt: new Date().toISOString() });
    }

    // 4. Flip connected.
    const accountName = orgInfo.organizationName || 'Zettle account';
    await db.doc(`businesses/${businessId}/operational_settings/main`).set({
      zettleConnected: true,
      zettleAccountName: accountName,
      zettleAutoMatchEnabled: true,
    }, { merge: true });

    return { ok: true, accountName, webhook };
  },
);

export const zettleOAuthCallback = onRequest(
  { cors: false, secrets: ZETTLE_SECRETS },
  async (req, res) => {
    const send = (msg: string) =>
      res.status(200).send(`<!doctype html><meta name=viewport content="width=device-width"><body style="font-family:system-ui;padding:24px">${msg}<script>setTimeout(function(){window.close()},2500)</script></body>`);

    if (!ZETTLE_ENABLED) { send('Zettle integration is not configured.'); return; }
    const code = String(req.query.code ?? '');
    const state = String(req.query.state ?? '');
    if (!code || !state || !state.includes('.')) { send('Connection failed: missing code/state.'); return; }

    const businessId = state.split('.')[0];
    try {
      const db = admin.firestore();
      const priv = await loadPrivate(db, businessId);
      if (!priv?.pendingAuth || priv.pendingAuth.state !== state) { send('Connection failed: state mismatch. Please retry.'); return; }

      const tokens = await exchangeAuthCode({ code, codeVerifier: priv.pendingAuth.codeVerifier, redirectUri: redirectUri() });
      await storeTokens(db, businessId, tokens);

      const info = await getUserInfo(tokens.accessToken).catch(() => ({} as { organizationName?: string }));
      const orgInfo = info as { organizationName?: string; organizationUuid?: string; uuid?: string };
      const organizationUuid = orgInfo.organizationUuid || orgInfo.uuid || '';

      const ownerEmail = (await db.doc(`businesses/${businessId}`).get()).get('ownerEmail') || 'owner@example.com';
      const sub = await createPurchaseWebhook(tokens.accessToken, { webhookUrl: webhookUrl(), contactEmail: ownerEmail });

      await db.doc(`zettleSecure/${businessId}/private/tokens`).set({
        signingKey: sub.signingKey,
        subscriptionUuid: sub.uuid,
        organizationUuid,
        pendingAuth: null,
      }, { merge: true });

      if (organizationUuid) {
        await db.doc(`zettleOrgs/${organizationUuid}`).set({ businessId, createdAt: new Date().toISOString() });
      }

      await db.doc(`businesses/${businessId}/operational_settings/main`).set({
        zettleConnected: true,
        zettleAccountName: orgInfo.organizationName || 'Zettle account',
        zettleAutoMatchEnabled: true,
      }, { merge: true });

      send('✅ Zettle connected. You can close this window.');
    } catch (err) {
      console.error('[zettleOAuthCallback] error', (err as Error).message);
      send('Connection failed. Please try again.');
    }
  },
);
