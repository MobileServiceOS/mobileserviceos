// functions/src/sendManualReviewRequest.ts
// ═══════════════════════════════════════════════════════════════════
//  sendManualReviewRequest — HTTPS callable (SP4A task 8).
//
//  Spec: §"Manual Review Request (addition #6)" in
//        docs/superpowers/specs/2026-06-03-sp4a-review-automation-design.md
//
//  Owner/admin gated. Enqueues with isManual:true, sendAfterAt:now.
//  Doc id matches the trigger's req-{jobId}-{date} pattern so re-clicks
//  same day collapse to the same row (idempotency).
// ═══════════════════════════════════════════════════════════════════

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { renderTemplate, pickReviewTemplate } from './lib/reviewTemplate';
import { readBrandAndOperationalSettings } from './lib/operationalSettings';
void admin;

interface SendManualInput {
  businessId: string;
  jobId: string;
}

interface BuildPatchArgs {
  jobId: string;
  customerId: string;
  customerName: string;
  phoneE164: string;
  serviceType: string;
  city: string;
  vehicleMakeModel?: string;
  settings: {
    reviewSmsTemplate?: string;
    googleReviewLink?: string;
    businessName?: string;
    serviceArea?: string;
  };
  uid: string;
}

function _firstName(name?: string): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}
function _lastName(name?: string): string {
  const parts = (name ?? '').trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : '';
}

function _buildPatch(args: BuildPatchArgs): Record<string, unknown> {
  if (!args.phoneE164?.trim())            throw new Error('phoneE164 required');
  if (!args.settings.googleReviewLink?.trim()) throw new Error('googleReviewLink required in settings');
  const template = args.settings.reviewSmsTemplate?.trim() || pickReviewTemplate();
  const cityResolved = args.city?.trim() || args.settings.serviceArea?.trim() || '';
  const rendered = renderTemplate(template, {
    firstName:    _firstName(args.customerName),
    lastName:     _lastName(args.customerName),
    businessName: args.settings.businessName?.trim(),
    serviceType:  args.serviceType?.trim(),
    city:         cityResolved,
    vehicle:      args.vehicleMakeModel?.trim() ?? '',
    reviewLink:   args.settings.googleReviewLink.trim(),
  });
  return {
    jobId: args.jobId,
    customerId: args.customerId,
    phoneE164: args.phoneE164.trim(),
    templateUsed: template,
    templateRendered: rendered,
    status: 'pending',
    retryCount: 0,
    isManual: true,
    invokedByUid: args.uid,
  };
}

function _computeRequestId(jobId: string, dateIso: string): string {
  return `req-${jobId}-${dateIso}`;
}

export const sendManualReviewRequest = onCall<SendManualInput, Promise<{ requestId: string }>>(async (req) => {
  const uid = req.auth?.uid;
  const { businessId, jobId } = req.data ?? { businessId: '', jobId: '' };
  if (!uid)        throw new HttpsError('unauthenticated', 'sign-in required');
  if (!businessId) throw new HttpsError('invalid-argument', 'businessId required');
  if (!jobId)      throw new HttpsError('invalid-argument', 'jobId required');

  const db = admin.firestore();
  const memberSnap = await db.doc(`businesses/${businessId}/members/${uid}`).get();
  const role = memberSnap.data()?.role;
  if (role !== 'owner' && role !== 'admin') {
    throw new HttpsError('permission-denied', 'owner or admin only');
  }

  // Brand fields (businessName) live on settings/main; operational fields
  // (reviewSmsTemplate, googleReviewLink, serviceArea) live on
  // operational_settings/main. Merge both via the shared helper.
  const [jobSnap, settingsRead] = await Promise.all([
    db.doc(`businesses/${businessId}/jobs/${jobId}`).get(),
    readBrandAndOperationalSettings(db, businessId),
  ]);
  if (!jobSnap.exists)                  throw new HttpsError('not-found', 'job not found');
  if (!settingsRead.operationalExists)  throw new HttpsError('failed-precondition', 'settings missing');

  const job      = jobSnap.data() ?? {};
  const settings = settingsRead.data;
  if (job.status !== 'Completed') {
    throw new HttpsError('failed-precondition', 'job must be Completed');
  }
  if (!job.customerId) throw new HttpsError('failed-precondition', 'job has no customer');

  const custSnap = await db.doc(`businesses/${businessId}/customers/${job.customerId}`).get();
  if (!custSnap.exists) throw new HttpsError('not-found', 'customer not found');
  const customer = custSnap.data() ?? {};
  if (!customer.phoneE164) throw new HttpsError('failed-precondition', 'customer has no phone');

  // Optional vehicle (limit 1, best-effort)
  let vehicleMakeModel: string | undefined;
  try {
    const vSnap = await db.collection(`businesses/${businessId}/customers/${job.customerId}/vehicles`).limit(1).get();
    if (!vSnap.empty) vehicleMakeModel = (vSnap.docs[0].data() as { vehicleMakeModel?: string }).vehicleMakeModel;
  } catch { /* best-effort */ }

  let patch: Record<string, unknown>;
  try {
    patch = _buildPatch({
      jobId,
      customerId: job.customerId,
      customerName: customer.name ?? '',
      phoneE164:    customer.phoneE164,
      serviceType:  job.service ?? '',
      city:         (job.city ?? job.area ?? '') as string,
      vehicleMakeModel,
      settings,
      uid,
    });
  } catch (err) {
    throw new HttpsError('invalid-argument', (err as Error).message);
  }

  const dateKey = (job.date && /^\d{4}-\d{2}-\d{2}$/.test(String(job.date)))
    ? String(job.date)
    : new Date().toISOString().slice(0, 10);
  const requestId = _computeRequestId(jobId, dateKey);
  const now = Timestamp.now();
  await db.doc(`businesses/${businessId}/reviewRequests/${requestId}`).set({
    ...patch,
    sendAfterAt: now,
    createdAt: now,
  }, { merge: true });

  return { requestId };
});

export const __testHooks = {
  buildPatch: _buildPatch,
  computeRequestId: _computeRequestId,
};
