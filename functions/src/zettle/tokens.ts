// functions/src/zettle/tokens.ts
// ═══════════════════════════════════════════════════════════════════
//  Token storage + refresh for a connected Zettle merchant.
//
//  Tokens live encrypted in the Functions-only private path
//  zettleSecure/{businessId}/private/tokens. getValidAccessToken
//  refreshes the access token on demand when near expiry (no cron).
// ═══════════════════════════════════════════════════════════════════

import type * as admin from 'firebase-admin';
import { encryptToken, decryptToken } from '../lib/zettleCrypto';
import { refreshAccessToken, type ZettleTokens } from '../lib/zettleClient';

type DB = admin.firestore.Firestore;

export interface ZettlePrivateDoc {
  accessTokenEnc?: string;
  refreshTokenEnc?: string;
  expiresAtMs?: number;
  signingKey?: string;
  subscriptionUuid?: string;
  organizationUuid?: string;
  pendingAuth?: { state: string; codeVerifier: string; createdAtMs: number } | null;
}

function privateRef(db: DB, businessId: string) {
  // Top-level (NOT under businesses/) so the member-read wildcard in
  // firestore.rules can't reach these OAuth tokens. See zettleSecure
  // block in firestore.rules.
  return db.doc(`zettleSecure/${businessId}/private/tokens`);
}

export async function loadPrivate(db: DB, businessId: string): Promise<ZettlePrivateDoc | null> {
  const snap = await privateRef(db, businessId).get();
  return snap.exists ? (snap.data() as ZettlePrivateDoc) : null;
}

/** Persist a fresh token set (encrypted) for a business. */
export async function storeTokens(db: DB, businessId: string, tokens: ZettleTokens): Promise<void> {
  await privateRef(db, businessId).set({
    accessTokenEnc: encryptToken(tokens.accessToken),
    refreshTokenEnc: encryptToken(tokens.refreshToken),
    expiresAtMs: tokens.expiresAtMs,
  }, { merge: true });
}

/**
 * Return a currently-valid access token, refreshing if it expires within
 * 2 minutes. Throws if the business has no stored tokens.
 */
export async function getValidAccessToken(db: DB, businessId: string): Promise<string> {
  const priv = await loadPrivate(db, businessId);
  if (!priv?.accessTokenEnc || !priv?.refreshTokenEnc) {
    throw new Error('zettle not connected for business');
  }
  const stillValid = (priv.expiresAtMs ?? 0) > Date.now() + 120_000;
  if (stillValid) return decryptToken(priv.accessTokenEnc);

  const refreshed = await refreshAccessToken(decryptToken(priv.refreshTokenEnc));
  await storeTokens(db, businessId, refreshed);
  return refreshed.accessToken;
}
