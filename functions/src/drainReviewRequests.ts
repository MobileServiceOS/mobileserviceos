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
//  The drainer is idempotent and race-safe via a two-phase design:
//  Phase 1 claims the row in an I/O-free transaction (pending →
//  sending); Phase 2 sends the SMS and records the outcome OUTSIDE any
//  transaction. The Twilio call must never sit inside a retrying
//  transaction — retries would double-text the customer (2026-06-05
//  audit). _processOne composes both phases for the test harness.
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
 * Process exactly one queue entry: claim (pending → sending) then send.
 * Pure logic — tx + sendSms + addCommunicationEvent are injected so
 * tests stub them. Used by the test harness via __testHooks; production
 * splits the claim and the send across two phases (see the scheduler
 * body) so the Twilio call never runs inside a retrying transaction.
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

  await _finalizeClaimed(target, req, tx, sendSms, addCommunicationEvent);
}

/**
 * Send the SMS for an ALREADY-CLAIMED ('sending') request and record the
 * outcome (sent / failed / retry / dormant-unwind) + communication event.
 *
 * 2026-06-05 audit: this must NOT run inside a retrying Firestore
 * transaction. Transactions auto-retry on contention and would re-invoke
 * sendSms, double-texting the customer. Production claims the row in an
 * I/O-free transaction first, then calls this with a non-transactional
 * writer. The `writer` only needs `update` (one write per outcome).
 */
async function _finalizeClaimed(
  target: ProcessTarget,
  req: Record<string, unknown>,
  writer: Pick<TxLike, 'update'>,
  sendSms: SendSmsFn,
  addCommunicationEvent: EventSink,
): Promise<void> {
  const path = `businesses/${target.businessId}/reviewRequests/${target.requestId}`;
  const tx = writer;
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
        const ref = db.doc(`businesses/${businessId}/reviewRequests/${reqDoc.id}`);

        // ─── Phase 1: claim (pending → sending) ──────────────────────
        // I/O-free transaction so contention retries are cheap and safe.
        // Exactly one drainer instance wins the flip; the loser sees
        // status !== 'pending' and skips. Returns the claimed data, or
        // null if not claimable (already sending/sent, or not yet due).
        let claimedReq: Record<string, unknown> | null = null;
        try {
          claimedReq = await db.runTransaction(async (tx) => {
            const s = await tx.get(ref);
            if (!s.exists) return null;
            const d = s.data() ?? {};
            if (d.status !== 'pending') return null;
            if (!_isSendAfterPast(d.sendAfterAt)) return null;
            tx.update(ref, { status: 'sending' });
            return d;
          });
        } catch (err) {
          // Claim aborted (contention) — let the next minute retry.
          console.error('[drainReviewRequests] claim failed', { target, err: (err as Error).message });
          continue;
        }
        if (!claimedReq) continue;

        // ─── Phase 2: send + finalize (OUTSIDE any transaction) ──────
        // The Twilio call must never run inside a retrying transaction
        // (2026-06-05 audit: would double-text on retry). A post-send
        // write failure leaves the row in 'sending' rather than re-
        // sending — safer than a duplicate text; a stale-'sending'
        // sweep can reconcile it.
        const events: Array<Record<string, unknown>> = [];
        const addEvent: EventSink = (e) => events.push(e);
        const writes: Array<Promise<unknown>> = [];
        const writer: Pick<TxLike, 'update'> = {
          update: (r, patch) => { writes.push(db.doc(r.path).update(patch)); },
        };
        try {
          await _finalizeClaimed(target, claimedReq, writer, realSendSms, addEvent);
          await Promise.all(writes);
          if (events.length) {
            const batch = db.batch();
            for (const e of events) {
              batch.set(db.collection(`businesses/${businessId}/communicationEvents`).doc(), e);
            }
            await batch.commit();
          }
          if (events.find(e => e.type === 'review_request_sent'))   sent += 1;
          if (events.find(e => e.type === 'review_request_failed')) failedCount += 1;
        } catch (err) {
          // Send/finalize failed after the claim — row stays 'sending'.
          console.error('[drainReviewRequests] finalize failed', { target, err: (err as Error).message });
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
