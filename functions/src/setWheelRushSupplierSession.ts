import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import {
  extractCookieHeaderFromCurl,
  curlTargetsUsAutoForce,
  parseCookieHeaderString,
  isLikelyAuthenticatedUsAutoForce,
  StoredSessionEnvelope,
} from './suppliers/cookieParsers';
import { writeNewSession, SUPPLIER_FIELD_KEYS } from './suppliers/sessionStore';
import { verifyUsAutoForceSession } from './suppliers/usAutoForceConnector';

// ─────────────────────────────────────────────────────────────────────
//  setWheelRushSupplierSession — owner submits a cURL string copied
//  from their browser DevTools after a manual login. We extract the
//  Cookie header, sanity-check it, and write a new version of the
//  supplier's session secret in Secret Manager.
//
//  verifyWheelRushSupplierSession — second export, exposed from the
//  same file for cohesion. Checks whether the latest stored session
//  still authenticates against the supplier portal.
//
//  Both share the Phase 1 auth gate: Firebase Auth + Wheel Rush
//  businessId match + owner/admin role.
//
//  Critical privacy notes:
//    - The raw cURL string is parsed in memory only; never persisted.
//    - We log the cookie COUNT and the supplier name. Never any cookie
//      name or value.
//    - HttpsError messages are deliberately generic. Internal-state
//      details go to console.log (which redacts) only.
// ─────────────────────────────────────────────────────────────────────

const WHEEL_RUSH_COMPANY_ID = defineSecret('WHEEL_RUSH_COMPANY_ID');

interface SetSessionRequest {
  supplier: 'U.S. AutoForce';
  curl: string;
}

interface SetSessionResponse {
  ok: true;
  cookieCount: number;
  savedAt: string;
}

interface VerifyRequest {
  supplier: 'U.S. AutoForce';
}

interface VerifyResponse {
  supplier: 'U.S. AutoForce';
  status: 'valid' | 'expired' | 'missing';
  checkedAt: string;
}

function logSafe(fn: string, event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ fn, event, ts: Date.now(), ...data }));
}

// Shared gate helper. Throws HttpsError on any reject. Returns the
// caller's uid + businessId on success.
async function enforceGates(
  request: CallableRequest<unknown>,
  fn: string
): Promise<{ uid: string; businessId: string }> {
  if (!request.auth) {
    logSafe(fn, 'reject-unauth');
    throw new HttpsError('unauthenticated', 'Sign in required');
  }
  const uid = request.auth.uid;

  // Wheel Rush businessId match (sourced from secret, never in code)
  let businessId: string | undefined;
  try {
    const userDoc = await admin.firestore().doc(`users/${uid}`).get();
    businessId = userDoc.data()?.businessId as string | undefined;
  } catch {
    logSafe(fn, 'reject-user-read-failed', { uid });
    throw new HttpsError('internal', 'Lookup failed');
  }
  const wheelRushId = WHEEL_RUSH_COMPANY_ID.value();
  if (!businessId || businessId !== wheelRushId) {
    logSafe(fn, 'reject-not-wheel-rush', { uid });
    throw new HttpsError('permission-denied', 'Feature not available');
  }

  // Owner/admin role check (members doc with legacy uid===bid fallback)
  let role: string | undefined;
  try {
    const memberDoc = await admin.firestore()
      .doc(`businesses/${businessId}/members/${uid}`).get();
    role = memberDoc.exists
      ? (memberDoc.data()?.role as string | undefined)
      : (uid === businessId ? 'owner' : undefined);
  } catch {
    logSafe(fn, 'reject-member-read-failed', { uid });
    throw new HttpsError('internal', 'Lookup failed');
  }
  if (role !== 'owner' && role !== 'admin') {
    logSafe(fn, 'reject-role', { uid, role: role ?? 'none' });
    throw new HttpsError('permission-denied', 'Owner or admin only');
  }

  return { uid, businessId };
}

// ────────────── setWheelRushSupplierSession ──────────────
export const setWheelRushSupplierSession = onCall<SetSessionRequest, Promise<SetSessionResponse>>(
  {
    secrets: [WHEEL_RUSH_COMPANY_ID],
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (request) => {
    const FN = 'setWheelRushSupplierSession';
    const { uid } = await enforceGates(request, FN);

    const supplier = request.data?.supplier;
    if (supplier !== 'U.S. AutoForce') {
      throw new HttpsError('invalid-argument', 'Unsupported supplier');
    }
    const curl = String(request.data?.curl ?? '').trim();
    if (!curl) {
      throw new HttpsError('invalid-argument', 'cURL string is empty');
    }
    if (curl.length > 200_000) {
      // Hard upper bound on the input — real cURL strings are <50KB.
      throw new HttpsError('invalid-argument', 'cURL string too large');
    }

    // Sanity check: was this copied from a U.S. AutoForce request?
    if (!curlTargetsUsAutoForce(curl)) {
      logSafe(FN, 'reject-wrong-host', { uid });
      throw new HttpsError(
        'invalid-argument',
        'This cURL is not from shop.usautoforce.com. Make sure you copied from the right tab.'
      );
    }

    // Extract Cookie header
    const cookieHeader = extractCookieHeaderFromCurl(curl);
    if (!cookieHeader) {
      logSafe(FN, 'reject-no-cookie-header', { uid });
      throw new HttpsError(
        'invalid-argument',
        'No Cookie header found in the cURL. Make sure you copied a logged-in request.'
      );
    }

    const cookies = parseCookieHeaderString(cookieHeader);
    if (cookies.length === 0) {
      logSafe(FN, 'reject-no-cookies-parsed', { uid });
      throw new HttpsError('invalid-argument', 'Could not parse any cookies');
    }

    // Confirm the session looks authenticated (presence of an
    // .AspNetCore.Identity.* cookie, not just an anti-forgery token).
    if (!isLikelyAuthenticatedUsAutoForce(cookies)) {
      logSafe(FN, 'reject-not-authenticated', { uid, cookieCount: cookies.length });
      throw new HttpsError(
        'failed-precondition',
        'These cookies do not look authenticated. Log in to the portal first, then copy.'
      );
    }

    const envelope: StoredSessionEnvelope = {
      version: 1,
      supplier: 'U.S. AutoForce',
      cookies,
      savedAt: new Date().toISOString(),
      savedBy: uid,
    };

    try {
      await writeNewSession(
        SUPPLIER_FIELD_KEYS['U.S. AutoForce'],
        envelope
      );
    } catch (err) {
      logSafe(FN, 'session-write-error', { uid });
      throw new HttpsError('internal', 'Could not save session');
    }

    logSafe(FN, 'session-saved', {
      uid,
      supplier,
      cookieCount: cookies.length,
    });

    return {
      ok: true,
      cookieCount: cookies.length,
      savedAt: envelope.savedAt,
    };
  }
);

// ────────────── verifyWheelRushSupplierSession ──────────────
export const verifyWheelRushSupplierSession = onCall<VerifyRequest, Promise<VerifyResponse>>(
  {
    secrets: [WHEEL_RUSH_COMPANY_ID],
    region: 'us-central1',
    timeoutSeconds: 20,
    memory: '256MiB',
  },
  async (request) => {
    const FN = 'verifyWheelRushSupplierSession';
    const { uid } = await enforceGates(request, FN);

    const supplier = request.data?.supplier;
    if (supplier !== 'U.S. AutoForce') {
      throw new HttpsError('invalid-argument', 'Unsupported supplier');
    }

    let status: 'valid' | 'expired' | 'missing';
    try {
      status = await verifyUsAutoForceSession();
    } catch (err) {
      logSafe(FN, 'verify-error', { uid });
      throw new HttpsError('internal', 'Verification failed');
    }

    logSafe(FN, 'verify-result', { uid, supplier, status });
    return { supplier, status, checkedAt: new Date().toISOString() };
  }
);
