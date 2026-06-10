// functions/src/zettle/importHistorical.ts
// ═══════════════════════════════════════════════════════════════════
//  importZettlePayments — owner/admin callable for back-filling past
//  Zettle transactions (30 / 90 / 365 days, or a custom range).
//
//  Paginates the Purchase API and runs each purchase through the same
//  persistAndMatch path as the webhook — so dedup (by purchaseUUID) and
//  matching are identical. Returns counts for the Settings UI.
// ═══════════════════════════════════════════════════════════════════

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { ZETTLE_ENABLED, ZETTLE_SECRETS } from '../lib/zettleEnabled';
import { listPurchases } from '../lib/zettleClient';
import { getValidAccessToken } from './tokens';
import { persistAndMatch } from './applyMatch';

type RangeKey = '30' | '90' | '365' | 'custom';

interface ImportInput {
  businessId: string;
  range: RangeKey;
  startDate?: string; // ISO, when range='custom'
  endDate?: string;   // ISO, when range='custom'
}

interface ImportResult {
  imported: number;
  matched: number;
  review: number;
  pages: number;
}

const MAX_PAGES = 50; // backstop against runaway pagination

export const importZettlePayments = onCall<ImportInput, Promise<ImportResult>>(
  { secrets: [...ZETTLE_SECRETS, 'MAP_STATIC_API_KEY'], timeoutSeconds: 540 },
  async (req) => {
    const uid = req.auth?.uid;
    const { businessId, range } = req.data ?? { businessId: '', range: '30' as RangeKey };
    if (!uid) throw new HttpsError('unauthenticated', 'sign-in required');
    if (!businessId) throw new HttpsError('invalid-argument', 'businessId required');
    if (!ZETTLE_ENABLED) throw new HttpsError('failed-precondition', 'Zettle integration not configured');

    const db = admin.firestore();
    const role = (await db.doc(`businesses/${businessId}/members/${uid}`).get()).get('role');
    if (uid !== businessId && role !== 'owner' && role !== 'admin') {
      throw new HttpsError('permission-denied', 'owner or admin only');
    }

    const now = Date.now();
    let startMs: number;
    let endMs = now;
    if (range === 'custom') {
      startMs = Date.parse(req.data.startDate ?? '') || (now - 30 * 86_400_000);
      endMs = Date.parse(req.data.endDate ?? '') || now;
    } else {
      const days = range === '365' ? 365 : range === '90' ? 90 : 30;
      startMs = now - days * 86_400_000;
    }
    const startDate = new Date(startMs).toISOString();
    const endDate = new Date(endMs).toISOString();

    const autoMatch = await db.doc(`businesses/${businessId}/operational_settings/main`)
      .get().then((s) => s.get('zettleAutoMatchEnabled') !== false);

    const accessToken = await getValidAccessToken(db, businessId);

    let imported = 0, matched = 0, review = 0, pages = 0;
    let cursor: string | undefined;
    do {
      const page = await listPurchases(accessToken, { startDate, endDate, limit: 1000, lastPurchaseHash: cursor });
      pages++;
      for (const raw of page.purchases) {
        try {
          const r = await persistAndMatch(db, businessId, raw, 'historical', { autoMatch });
          imported++;
          if (r.confidence === 'high' && r.jobId) matched++;
          else review++;
        } catch (err) {
          console.error('[importZettlePayments] purchase failed', (err as Error).message);
        }
      }
      cursor = page.purchases.length > 0 ? page.lastPurchaseHash : undefined;
    } while (cursor && pages < MAX_PAGES);

    return { imported, matched, review, pages };
  },
);
