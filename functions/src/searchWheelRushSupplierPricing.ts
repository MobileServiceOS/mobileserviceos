import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';
import { normalizeTireSize } from './suppliers/normalizeTireSize';
import { searchSuppliers } from './suppliers/supplierSearchService';
import { consumeRateLimitToken } from './suppliers/rateLimit';
import {
  SearchRequest, SearchResponse, SupplierFilter,
} from './suppliers/supplierTypes';

// ─────────────────────────────────────────────────────────────────────
//  searchWheelRushSupplierPricing
//
//  Private Wheel Rush-only callable. Returns supplier pricing for a
//  given tire size from ATD, Advance Tire, and U.S. AutoForce.
//
//  Phase 1: connectors return mock catalog data. Phase 2 swaps the
//  connector bodies for real supplier portal calls — this entry point
//  does not change.
//
//  Access enforcement (in order, all must pass):
//
//    1. Authenticated   — request.auth set by Firebase Auth.
//    2. Wheel Rush      — users/{uid}.businessId === WHEEL_RUSH_COMPANY_ID
//                         (the businessId is a secret, not in code).
//    3. Owner/admin     — businesses/{bid}/members/{uid}.role in
//                         {owner, admin}. Legacy fallback: uid === bid
//                         is treated as owner (matches the rules-side
//                         legacy convention).
//    4. Rate limit      — token bucket per uid, 5 req/min default.
//
//  Any reject returns a generic message via HttpsError. Internal
//  reasons (which check failed, which supplier errored, etc.) are
//  logged server-side via console.log but never surfaced to the
//  client.
// ─────────────────────────────────────────────────────────────────────

const WHEEL_RUSH_COMPANY_ID = defineSecret('WHEEL_RUSH_COMPANY_ID');
const ATD_USERNAME = defineSecret('ATD_USERNAME');
const ATD_PASSWORD = defineSecret('ATD_PASSWORD');
const ADVANCE_TIRE_USERNAME = defineSecret('ADVANCE_TIRE_USERNAME');
const ADVANCE_TIRE_PASSWORD = defineSecret('ADVANCE_TIRE_PASSWORD');
const USAUTOFORCE_USERNAME = defineSecret('USAUTOFORCE_USERNAME');
const USAUTOFORCE_PASSWORD = defineSecret('USAUTOFORCE_PASSWORD');

function logSafe(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({
    fn: 'searchWheelRushSupplierPricing',
    event,
    ts: Date.now(),
    ...data,
  }));
}

const ALLOWED_FILTERS = new Set<SupplierFilter>([
  'all', 'ATD', 'Advance Tire', 'U.S. AutoForce',
]);

export const searchWheelRushSupplierPricing = onCall<SearchRequest, Promise<SearchResponse>>(
  {
    secrets: [
      WHEEL_RUSH_COMPANY_ID,
      ATD_USERNAME, ATD_PASSWORD,
      ADVANCE_TIRE_USERNAME, ADVANCE_TIRE_PASSWORD,
      USAUTOFORCE_USERNAME, USAUTOFORCE_PASSWORD,
    ],
    region: 'us-central1',
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (request: CallableRequest<SearchRequest>): Promise<SearchResponse> => {
    // 1. Authenticated
    if (!request.auth) {
      logSafe('reject-unauth');
      throw new HttpsError('unauthenticated', 'Sign in required');
    }
    const uid = request.auth.uid;

    // 2. Wheel Rush businessId match
    let userBusinessId: string | undefined;
    try {
      const userDoc = await admin.firestore().doc(`users/${uid}`).get();
      userBusinessId = userDoc.data()?.businessId as string | undefined;
    } catch (_err) {
      logSafe('reject-user-read-failed', { uid });
      throw new HttpsError('internal', 'Lookup failed');
    }
    const wheelRushId = WHEEL_RUSH_COMPANY_ID.value();
    if (!userBusinessId || userBusinessId !== wheelRushId) {
      logSafe('reject-not-wheel-rush', { uid });
      throw new HttpsError('permission-denied', 'Feature not available');
    }

    // 3. Owner/admin role check
    let role: string | undefined;
    try {
      const memberDoc = await admin.firestore()
        .doc(`businesses/${userBusinessId}/members/${uid}`).get();
      role = memberDoc.exists
        ? (memberDoc.data()?.role as string | undefined)
        : (uid === userBusinessId ? 'owner' : undefined);
    } catch (_err) {
      logSafe('reject-member-read-failed', { uid });
      throw new HttpsError('internal', 'Lookup failed');
    }
    if (role !== 'owner' && role !== 'admin') {
      logSafe('reject-role', { uid, role: role ?? 'none' });
      throw new HttpsError('permission-denied', 'Owner or admin only');
    }

    // 4. Rate limit
    if (!consumeRateLimitToken(uid)) {
      logSafe('reject-rate-limit', { uid });
      throw new HttpsError('resource-exhausted', 'Too many searches. Wait a minute.');
    }

    // 5. Input validation + normalize
    const tireSizeRaw = String(request.data?.tireSize ?? '');
    const normalizedSize = normalizeTireSize(tireSizeRaw);
    if (!normalizedSize) {
      throw new HttpsError('invalid-argument', `Invalid tire size: "${tireSizeRaw}"`);
    }
    const quantityRaw = Number(request.data?.quantity ?? 1);
    const quantity = Number.isFinite(quantityRaw)
      ? Math.max(1, Math.min(20, Math.floor(quantityRaw)))
      : 1;
    const filterRaw = (request.data?.supplierFilter ?? 'all') as SupplierFilter;
    const supplierFilter: SupplierFilter = ALLOWED_FILTERS.has(filterRaw) ? filterRaw : 'all';

    // 6. Run search
    let response: SearchResponse;
    try {
      response = await searchSuppliers({ normalizedSize, quantity, supplierFilter });
    } catch (_err) {
      logSafe('search-error', { uid, normalizedSize });
      throw new HttpsError('internal', 'Search failed');
    }

    // 7. Audit log (sanitized — never credentials, never raw upstream)
    logSafe('search-ok', {
      uid,
      businessId: userBusinessId,
      normalizedSize,
      filter: supplierFilter,
      resultCount: response.allResults.length,
      warningCount: response.warnings.length,
    });

    return response;
  }
);
