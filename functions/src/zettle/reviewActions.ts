// functions/src/zettle/reviewActions.ts
// ═══════════════════════════════════════════════════════════════════
//  Owner/admin callables to action the Zettle review queue.
//
//    resolveZettlePayment  — { businessId, paymentId, jobId } → marks
//                            the chosen job paid + links the payment.
//    dismissZettlePayment  — { businessId, paymentId } → clears the
//                            queue item (no MSOS job for this payment).
//
//  Both re-check owner/admin server-side (defense in depth beyond the
//  Firestore rules, which already block client writes to zettleSecure).
// ═══════════════════════════════════════════════════════════════════

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { ZETTLE_SECRETS } from '../lib/zettleEnabled';
import { resolveMatch, dismissReview } from './resolveMatch';

async function assertOwnerAdmin(businessId: string, uid: string | undefined): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in required');
  if (!businessId) throw new HttpsError('invalid-argument', 'businessId required');
  const role = (await admin.firestore().doc(`businesses/${businessId}/members/${uid}`).get()).get('role');
  if (uid !== businessId && role !== 'owner' && role !== 'admin') {
    throw new HttpsError('permission-denied', 'owner or admin only');
  }
}

export const resolveZettlePayment = onCall<
  { businessId: string; paymentId: string; jobId: string },
  Promise<{ ok: boolean; jobId: string; reason?: string }>
>({ secrets: ZETTLE_SECRETS }, async (req) => {
  const { businessId, paymentId, jobId } = req.data ?? { businessId: '', paymentId: '', jobId: '' };
  await assertOwnerAdmin(businessId, req.auth?.uid);
  if (!paymentId || !jobId) throw new HttpsError('invalid-argument', 'paymentId and jobId required');
  const result = await resolveMatch(admin.firestore(), businessId, paymentId, jobId);
  if (!result.ok) throw new HttpsError('failed-precondition', result.reason ?? 'could not resolve');
  return result;
});

export const dismissZettlePayment = onCall<
  { businessId: string; paymentId: string },
  Promise<{ ok: boolean }>
>({ secrets: ZETTLE_SECRETS }, async (req) => {
  const { businessId, paymentId } = req.data ?? { businessId: '', paymentId: '' };
  await assertOwnerAdmin(businessId, req.auth?.uid);
  if (!paymentId) throw new HttpsError('invalid-argument', 'paymentId required');
  return dismissReview(admin.firestore(), businessId, paymentId);
});
