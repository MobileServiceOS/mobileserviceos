// functions/src/onJobCompletedReviewRequest.ts
// ═══════════════════════════════════════════════════════════════════
//  onJobCompletedReviewRequest — Firestore trigger (SP4A task 6).
//
//  Spec: docs/superpowers/specs/2026-06-03-sp4a-review-automation-design.md
//        §"1. onJobCompletedReviewRequest Firestore trigger"
//
//  Fires on every write to businesses/{bid}/jobs/{jobId}. Six guards
//  decide whether to enqueue. Pass → transactional enqueue of
//  reviewRequests/{requestId} + flip jobs/{jobId}.reviewRequestSent.
//
//  Doc id pattern: req-{jobId}-{completedDateISO}. Same job same day
//  = same id = idempotent re-saves.
// ═══════════════════════════════════════════════════════════════════

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { renderTemplate, type TemplateVars } from './lib/reviewTemplate';
void admin;

type JobLite = {
  id: string;
  status?: string;
  date?: string;                  // YYYY-MM-DD (ISO date string)
  service?: string;
  city?: string;
  area?: string;
  customerId?: string;
  reviewRequestSent?: boolean;
};
type CustomerLite = {
  id: string;
  name?: string;
  phoneE164?: string;
};
type SettingsLite = {
  reviewAutomationEnabled?: boolean;
  reviewSmsTemplate?: string;
  reviewDelayMinutes?: number;
  googleReviewLink?: string;
  serviceArea?: string;
  businessName?: string;
};
type VehicleLite = {
  vehicleMakeModel?: string;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
};

interface DecisionEnqueue {
  action: 'enqueue';
  requestId: string;
  patch: {
    jobId: string;
    customerId: string;
    phoneE164: string;
    templateUsed: string;
    templateRendered: string;
    sendAfterAtEpochMs: number;    // wrapper converts to Timestamp
    status: 'pending';
    retryCount: number;
    invokedByUid: string;
  };
}
interface DecisionSkip {
  action: 'skip';
  reason: string;
}
export type Decision = DecisionEnqueue | DecisionSkip;

const DEFAULT_TEMPLATE_FALLBACK =
  'Hi {firstName}, thanks for the service. Please leave a review: {reviewLink}';

function _firstName(name?: string): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}
function _lastName(name?: string): string {
  const parts = (name ?? '').trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : '';
}
function _resolveCity(job: JobLite, settings: SettingsLite): string {
  if (job.city?.trim())             return job.city.trim();
  if (job.area?.trim())             return job.area.trim();
  if (settings.serviceArea?.trim()) return settings.serviceArea.trim();
  return '';
}
function _vehicleLabel(v: VehicleLite | undefined): string {
  if (!v) return '';
  if (v.vehicleMakeModel?.trim()) return v.vehicleMakeModel.trim();
  const parts = [v.vehicleYear, v.vehicleMake, v.vehicleModel].filter(p => p?.trim());
  return parts.join(' ').trim();
}

function _decide(
  before: JobLite | null,
  after: JobLite,
  customer: CustomerLite,
  settings: SettingsLite,
  vehicle?: VehicleLite,
): Decision {
  // Guard 1: already-completed edit (re-save of a Completed job).
  if (before?.status === 'Completed') return { action: 'skip', reason: 'before-completed' };
  // Guard 2: not a completion event.
  if (after.status !== 'Completed') return { action: 'skip', reason: 'not-completed' };
  // Guard 3: idempotency layer 1 — already enqueued.
  if (after.reviewRequestSent === true) return { action: 'skip', reason: 'already-sent' };
  // Guard 4: operator opted out.
  if (settings.reviewAutomationEnabled !== true) return { action: 'skip', reason: 'disabled' };
  // Guard 5: no review URL — spec addition #7.
  if (!settings.googleReviewLink?.trim()) return { action: 'skip', reason: 'no-review-link' };
  // Guard 6: no phone to text.
  if (!customer.phoneE164?.trim()) return { action: 'skip', reason: 'no-phone' };

  const template = settings.reviewSmsTemplate?.trim() || DEFAULT_TEMPLATE_FALLBACK;
  const vars: TemplateVars = {
    firstName: _firstName(customer.name),
    lastName:  _lastName(customer.name),
    businessName: settings.businessName?.trim(),
    serviceType:  after.service?.trim(),
    city:         _resolveCity(after, settings),
    vehicle:      _vehicleLabel(vehicle),
    reviewLink:   settings.googleReviewLink.trim(),
  };
  const templateRendered = renderTemplate(template, vars);

  const delayMs = (Number(settings.reviewDelayMinutes) || 0) * 60_000;
  const sendAfterAtEpochMs = Date.now() + delayMs;

  const dateKey = (after.date && /^\d{4}-\d{2}-\d{2}$/.test(after.date))
    ? after.date
    : new Date().toISOString().slice(0, 10);

  return {
    action: 'enqueue',
    requestId: _computeRequestId(after.id, dateKey),
    patch: {
      jobId: after.id,
      customerId: customer.id,
      phoneE164: customer.phoneE164.trim(),
      templateUsed: template,
      templateRendered,
      sendAfterAtEpochMs,
      status: 'pending',
      retryCount: 0,
      invokedByUid: 'system:reviewAutomation',
    },
  };
}

function _computeRequestId(jobId: string, dateIso: string): string {
  return `req-${jobId}-${dateIso}`;
}

export const onJobCompletedReviewRequest = onDocumentWritten(
  'businesses/{businessId}/jobs/{jobId}',
  async (event) => {
    const before = event.data?.before?.data() as JobLite | undefined;
    const afterRaw = event.data?.after?.data() as JobLite | undefined;
    if (!afterRaw) return;  // deletion
    const after: JobLite = { ...afterRaw, id: event.params.jobId };
    const businessId = event.params.businessId;
    const db = admin.firestore();

    // Fast-path skip BEFORE the parallel reads — guards 1/2/3 are cheap.
    if (before?.status === 'Completed') return;
    if (after.status !== 'Completed')   return;
    if (after.reviewRequestSent === true) return;
    if (!after.customerId) return;  // can't enqueue without a customer

    // Three parallel reads: customer, settings, primary vehicle.
    const [custSnap, settingsSnap] = await Promise.all([
      db.doc(`businesses/${businessId}/customers/${after.customerId}`).get(),
      db.doc(`businesses/${businessId}/settings/main`).get(),
    ]);
    if (!custSnap.exists)     return;
    if (!settingsSnap.exists) return;
    const customer: CustomerLite = { id: custSnap.id, ...(custSnap.data() as Omit<CustomerLite, 'id'>) };
    const settings = settingsSnap.data() as SettingsLite;

    // Vehicle is optional — read the FIRST vehicle subdoc if any, else skip.
    let vehicle: VehicleLite | undefined;
    try {
      const vSnap = await db.collection(`businesses/${businessId}/customers/${after.customerId}/vehicles`).limit(1).get();
      if (!vSnap.empty) vehicle = vSnap.docs[0].data() as VehicleLite;
    } catch { /* vehicle is best-effort */ }

    const decision = _decide(before ?? null, after, customer, settings, vehicle);
    if (decision.action === 'skip') {
      console.info('[reviewTrigger] skip', { jobId: after.id, reason: decision.reason });
      return;
    }

    const requestPath = `businesses/${businessId}/reviewRequests/${decision.requestId}`;
    const jobPath     = `businesses/${businessId}/jobs/${after.id}`;
    const now = Timestamp.now();
    const sendAfterAt = Timestamp.fromMillis(decision.patch.sendAfterAtEpochMs);

    await db.runTransaction(async (tx) => {
      // Idempotency layer 2: re-read the Job inside the transaction.
      // Another instance may have flipped the flag between our snapshot
      // and the transaction body.
      const freshJob = await tx.get(db.doc(jobPath));
      if (freshJob.exists && (freshJob.data() as JobLite).reviewRequestSent === true) {
        console.info('[reviewTrigger] race-skip', { jobId: after.id });
        return;
      }
      tx.set(db.doc(requestPath), {
        ...decision.patch,
        sendAfterAt,
        createdAt: now,
      }, { merge: true });
      tx.set(db.doc(jobPath), {
        reviewRequestSent: true,
        reviewRequestId: decision.requestId,
      }, { merge: true });
    });
    console.info('[reviewTrigger] enqueued', { jobId: after.id, requestId: decision.requestId });
  },
);

export const __testHooks = {
  decide: _decide,
  computeRequestId: _computeRequestId,
  firstName: _firstName,
  lastName: _lastName,
  resolveCity: _resolveCity,
  vehicleLabel: _vehicleLabel,
};
