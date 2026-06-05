// functions/src/drainReviewRequests.ts
// ═══════════════════════════════════════════════════════════════════
//  drainReviewRequests — scheduled drainer (SP4A task 7).
//
//  Spec: docs/superpowers/specs/2026-06-03-sp4a-review-automation-design.md
//        §"3. drainReviewRequests scheduled function"
//
//  Cron: every 1 minute. Lists active businesses, queries pending
//  reviewRequests (status='pending' AND sendAfterAt <= now, limit 50),
//  and for each row:
//    - 'TWILIO_NOT_CONFIGURED' → leave pending (dormant mode)
//    - 4xx                     → status=failed (no retry)
//    - 5xx                     → retryCount++ (status=failed at 3)
//    - success                 → status=sent + log event
//
//  The drainer is idempotent and race-safe via transactional flip
//  from 'pending' → 'sending' inside processOne.
// ═══════════════════════════════════════════════════════════════════

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { sendSms as realSendSms, TwilioError } from './lib/twilioClient';
void admin;
void FieldValue;

const BATCH_LIMIT = 50;
const MAX_RETRIES = 3;

interface ProcessTarget {
  businessId: string;
  requestId: string;
}

type SendSmsFn = (args: { to: string; body: string }) => Promise<{ messageSid: string; deliveryStatus: string }>;
type EventSink  = (e: Record<string, unknown>) => void;

// Minimal Firestore-tx shape — wide enough for the production admin
// transaction object AND the test shim.
interface TxLike {
  get(ref: { path: string }): Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
  update(ref: { path: string }, patch: Record<string, unknown>): void;
  set(ref: { path: string }, patch: Record<string, unknown>): void;
}

function _isSendAfterPast(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'number') return value <= Date.now();
  // Firestore Timestamp or admin Timestamp shape
  const obj = value as { _seconds?: number; seconds?: number; toMillis?: () => number };
  if (typeof obj.toMillis === 'function') return obj.toMillis() <= Date.now();
  const seconds = obj._seconds ?? obj.seconds;
  if (typeof seconds === 'number') return seconds * 1000 <= Date.now();
  return true;
}

/**
 * Process exactly one queue entry. Pure logic — tx + sendSms +
 * addCommunicationEvent are injected so tests stub them.
 */
async function _processOne(
  target: ProcessTarget,
  tx: TxLike,
  sendSms: SendSmsFn,
  addCommunicationEvent: EventSink,
): Promise<void> {
  const path = `businesses/${target.businessId}/reviewRequests/${target.requestId}`;
  const snap = await tx.get({ path });
  if (!snap.exists) return;
  const req = snap.data() ?? {};

  if (req.status !== 'pending') return;
  if (!_isSendAfterPast(req.sendAfterAt)) return;

  // Transactional flip pending → sending (race guard for two
  // instances draining the same minute).
  tx.update({ path }, { status: 'sending' });

  try {
    const result = await sendSms({ to: String(req.phoneE164), body: String(req.templateRendered) });
    const sentAt = Timestamp.now();
    tx.update({ path }, {
      status: 'sent',
      sentAt,
      twilioMessageSid: result.messageSid,
      deliveryStatus:   result.deliveryStatus,
    });
    addCommunicationEvent({
      type: 'review_request_sent',
      channel: 'sms',
      direction: 'outbound',
      customerId: req.customerId,
      jobId: req.jobId,
      reviewRequestId: target.requestId,
      content: req.templateRendered,
      status: 'sent',
      providerMessageId: result.messageSid,
      deliveryStatus:    result.deliveryStatus,
      sentAt,
      createdByUid: req.invokedByUid ?? 'system:reviewAutomation',
    });
  } catch (err) {
    const msg = (err as Error).message;
    // Dormant mode — leave pending, no counter bump, no log.
    if (msg === 'TWILIO_NOT_CONFIGURED') {
      tx.update({ path }, { status: 'pending' });   // unwind the sending flip
      return;
    }
    // Transient vs terminal.
    if (err instanceof TwilioError || (err as { name?: string }).name === 'TwilioError') {
      const status = (err as TwilioError).status;
      if (status >= 500) {
        const nextRetry = Number(req.retryCount ?? 0) + 1;
        if (nextRetry >= MAX_RETRIES) {
          const failedAt = Timestamp.now();
          tx.update({ path }, {
            status: 'failed',
            retryCount: nextRetry,
            failedAt,
            errorMessage: `transient retries exhausted: ${msg}`,
          });
          addCommunicationEvent({
            type: 'review_request_failed',
            channel: 'sms', direction: 'outbound',
            customerId: req.customerId, jobId: req.jobId,
            reviewRequestId: target.requestId,
            status: 'failed',
            sentAt: failedAt,
            content: req.templateRendered,
            carrierResponse: msg,
            createdByUid: req.invokedByUid ?? 'system:reviewAutomation',
          });
        } else {
          tx.update({ path }, { status: 'pending', retryCount: nextRetry });
        }
        return;
      }
      // 4xx terminal
      const failedAt = Timestamp.now();
      const carrierCode = (err as TwilioError).carrierCode;
      tx.update({ path }, {
        status: 'failed',
        failedAt,
        errorMessage: carrierCode ? `${carrierCode}: ${msg}` : msg,
      });
      addCommunicationEvent({
        type: 'review_request_failed',
        channel: 'sms', direction: 'outbound',
        customerId: req.customerId, jobId: req.jobId,
        reviewRequestId: target.requestId,
        status: 'failed',
        sentAt: failedAt,
        content: req.templateRendered,
        carrierResponse: carrierCode,
        createdByUid: req.invokedByUid ?? 'system:reviewAutomation',
      });
      return;
    }
    // Unknown error class — treat as transient.
    const nextRetry = Number(req.retryCount ?? 0) + 1;
    if (nextRetry >= MAX_RETRIES) {
      const failedAt = Timestamp.now();
      tx.update({ path }, {
        status: 'failed',
        retryCount: nextRetry,
        failedAt,
        errorMessage: `unknown error after retries: ${msg}`,
      });
      addCommunicationEvent({
        type: 'review_request_failed',
        channel: 'sms', direction: 'outbound',
        customerId: req.customerId, jobId: req.jobId,
        reviewRequestId: target.requestId,
        status: 'failed',
        sentAt: failedAt,
        content: req.templateRendered,
        carrierResponse: msg,
        createdByUid: req.invokedByUid ?? 'system:reviewAutomation',
      });
    } else {
      tx.update({ path }, { status: 'pending', retryCount: nextRetry });
    }
  }
}

export const drainReviewRequests = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'],
  },
  async () => {
    const db = admin.firestore();
    const now = Timestamp.now();
    const startTs = Date.now();

    // List businesses by walking the top-level collection. This is
    // a bounded query for SP4A's tenant count (<100). When the tenant
    // count crosses ~1000, swap to a per-business pubsub subscription
    // (tracked in SP4B's scale-out followup).
    const bizSnap = await db.collection('businesses').get();
    let scanned = 0, sent = 0, failedCount = 0;
    for (const bizDoc of bizSnap.docs) {
      const businessId = bizDoc.id;
      // Pull pending whose sendAfterAt is past. Uses the composite
      // index added in Task 4.
      const pendingSnap = await db.collection(`businesses/${businessId}/reviewRequests`)
        .where('status', '==', 'pending')
        .where('sendAfterAt', '<=', now)
        .limit(BATCH_LIMIT)
        .get();
      for (const reqDoc of pendingSnap.docs) {
        scanned += 1;
        const target = { businessId, requestId: reqDoc.id };
        try {
          await db.runTransaction(async (tx) => {
            const events: Array<Record<string, unknown>> = [];
            const addEvent: EventSink = (e) => events.push(e);
            // Real tx satisfies TxLike; admin tx APIs accept DocumentReference,
            // so we adapt by wrapping the path back into a ref inside the helper.
            const adapter: TxLike = {
              get: async (ref) => {
                const s = await tx.get(db.doc(ref.path));
                return { exists: s.exists, data: () => s.data() ?? undefined };
              },
              update: (ref, patch) => tx.update(db.doc(ref.path), patch),
              set:    (ref, patch) => tx.set(db.doc(ref.path), patch, { merge: true }),
            };
            await _processOne(target, adapter, realSendSms, addEvent);
            // After the request-doc writes are queued, append events.
            for (const e of events) {
              const eventRef = db.collection(`businesses/${businessId}/communicationEvents`).doc();
              tx.set(eventRef, e);
            }
            if (events.find(e => e.type === 'review_request_sent'))   sent += 1;
            if (events.find(e => e.type === 'review_request_failed')) failedCount += 1;
          });
        } catch (err) {
          // Tx aborted (contention) — let the next minute retry.
          console.error('[drainReviewRequests] tx failed', { target, err: (err as Error).message });
        }
      }
    }
    console.info('[drainReviewRequests] done', {
      scanned, sent, failed: failedCount, durationMs: Date.now() - startTs,
    });
  },
);

export const __testHooks = {
  processOne: _processOne,
  isSendAfterPast: _isSendAfterPast,
};
