// functions/src/zettle/resolveMatch.ts
// ═══════════════════════════════════════════════════════════════════
//  Owner resolution of low-confidence Zettle imports.
//
//  When persistAndMatch can't confidently match a payment, it parks it
//  in zettleSecure/{bid}/reviewQueue and leaves every candidate job
//  untouched. These helpers let an owner/admin either:
//    • resolveMatch  — pick the correct job → mark it paid + link the
//                      payment, exactly like an auto-match would.
//    • dismissReview — there's no MSOS job for this payment (e.g. a
//                      counter sale) → just clear the queue item.
//
//  Pure-ish core (Admin SDK + emulator-testable). The onCall wrappers in
//  reviewActions.ts add the owner/admin auth gate.
// ═══════════════════════════════════════════════════════════════════

import type * as admin from 'firebase-admin';

type DB = admin.firestore.Firestore;

export interface ResolveResult { ok: boolean; jobId: string; reason?: string }

/**
 * Apply an owner-chosen match: mark the job paid + link the payment +
 * resolve the queue item. Idempotent and safe — refuses if the job is
 * already paid by a DIFFERENT payment.
 */
export async function resolveMatch(
  db: DB,
  businessId: string,
  paymentId: string,
  jobId: string,
): Promise<ResolveResult> {
  const payRef = db.doc(`zettleSecure/${businessId}/payments/${paymentId}`);
  const jobRef = db.doc(`businesses/${businessId}/jobs/${jobId}`);
  const reviewRef = db.doc(`zettleSecure/${businessId}/reviewQueue/${paymentId}`);

  return db.runTransaction(async (tx) => {
    const [paySnap, jobSnap] = await Promise.all([tx.get(payRef), tx.get(jobRef)]);
    if (!paySnap.exists) return { ok: false, jobId, reason: 'payment not found' };
    if (!jobSnap.exists) return { ok: false, jobId, reason: 'job not found' };

    const existingImport = jobSnap.get('paymentImportId');
    if (existingImport && existingImport !== paymentId) {
      return { ok: false, jobId, reason: 'job already paid by another payment' };
    }

    const paidAt = jobSnap.get('paidAt') || paySnap.get('timestamp') || new Date().toISOString();
    tx.update(jobRef, {
      status: 'Completed',
      paymentStatus: 'Paid',
      paymentMethod: 'card',
      paymentSource: 'zettle',
      paymentImportId: paymentId,
      paidAt,
    });
    tx.set(payRef, {
      jobId,
      matchConfidence: 'high',
      matchReasons: ['manually matched by owner'],
    }, { merge: true });
    tx.set(reviewRef, { status: 'resolved', resolvedJobId: jobId, resolvedAt: new Date().toISOString() }, { merge: true });
    return { ok: true, jobId };
  });
}

/** Clear a review item without applying a match (no MSOS job exists). */
export async function dismissReview(db: DB, businessId: string, paymentId: string): Promise<{ ok: boolean }> {
  await db.doc(`zettleSecure/${businessId}/reviewQueue/${paymentId}`)
    .set({ status: 'dismissed', dismissedAt: new Date().toISOString() }, { merge: true });
  return { ok: true };
}
