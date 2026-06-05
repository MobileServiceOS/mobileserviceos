// functions/src/drainOutboundSms.ts
// ═══════════════════════════════════════════════════════════════════
//  drainOutboundSms — SP4B scheduled drainer.
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"4. drainOutboundSms scheduled function"
//
//  Sibling of SP4A's drainReviewRequests but reads from the new
//  outboundSms collection. Same per-row decision tree:
//
//    - TWILIO_NOT_CONFIGURED → leave pending (dormant)
//    - 4xx                   → status=failed + event
//    - 5xx                   → retryCount++; status=failed at 3 + event
//    - success               → status=sent + sid + lifecycle + event;
//                              for kind=missed_call_response also flips
//                              parent lead.autoTextSent = true
//    - status != pending     → race-skip
//    - sendAfterAt > now     → defensive skip
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
  smsId: string;
}

type SendSmsFn = (args: { to: string; body: string }) => Promise<{ messageSid: string; deliveryStatus: string }>;
type EventSink  = (e: Record<string, unknown>) => void;

interface TxLike {
  get(ref: { path: string }): Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
  update(ref: { path: string }, patch: Record<string, unknown>): void;
  set(ref: { path: string }, patch: Record<string, unknown>): void;
}

function _isSendAfterPast(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'number') return value <= Date.now();
  const obj = value as { _seconds?: number; seconds?: number; toMillis?: () => number };
  if (typeof obj.toMillis === 'function') return obj.toMillis() <= Date.now();
  const seconds = obj._seconds ?? obj.seconds;
  if (typeof seconds === 'number') return seconds * 1000 <= Date.now();
  return true;
}

// SP4B-specific event-type discriminator: missed_call_response writes
// the missed_call_* event names, manual_lead_reply writes outbound_sms_*.
function _eventTypeForOutcome(kind: string, outcome: 'sent' | 'failed'): string {
  if (kind === 'missed_call_response') {
    return outcome === 'sent' ? 'missed_call_auto_text_sent' : 'missed_call_auto_text_failed';
  }
  return outcome === 'sent' ? 'outbound_sms_sent' : 'outbound_sms_failed';
}

async function _processOne(
  target: ProcessTarget,
  tx: TxLike,
  sendSms: SendSmsFn,
  addCommunicationEvent: EventSink,
): Promise<void> {
  const path = `businesses/${target.businessId}/outboundSms/${target.smsId}`;
  const snap = await tx.get({ path });
  if (!snap.exists) return;
  const req = snap.data() ?? {};

  if (req.status !== 'pending') return;
  if (!_isSendAfterPast(req.sendAfterAt)) return;

  // Transactional flip pending → sending
  tx.update({ path }, { status: 'sending' });

  const kind = String(req.kind ?? 'missed_call_response');
  const leadId = String(req.leadId ?? '');

  try {
    const result = await sendSms({ to: String(req.phoneE164), body: String(req.templateRendered) });
    const sentAt = Timestamp.now();
    tx.update({ path }, {
      status: 'sent',
      sentAt,
      twilioMessageSid: result.messageSid,
      deliveryStatus:   result.deliveryStatus,
    });
    // For missed_call_response: also flip the parent Lead so the UI
    // can render the auto-text-sent state without a join query.
    if (kind === 'missed_call_response' && leadId) {
      tx.update({ path: `businesses/${target.businessId}/leads/${leadId}` }, {
        autoTextSent: true,
        autoTextSentAt: sentAt,
        outboundSmsId: target.smsId,
      });
    }
    addCommunicationEvent({
      type: _eventTypeForOutcome(kind, 'sent'),
      channel: 'sms',
      direction: 'outbound',
      customerId: req.customerId,
      leadId,
      content: req.templateRendered,
      status: 'sent',
      providerMessageId: result.messageSid,
      deliveryStatus:    result.deliveryStatus,
      sentAt,
      createdByUid: req.invokedByUid ?? 'system:missedCallRecovery',
    });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'TWILIO_NOT_CONFIGURED') {
      tx.update({ path }, { status: 'pending' });
      return;
    }
    if (err instanceof TwilioError || (err as { name?: string }).name === 'TwilioError') {
      const status = (err as TwilioError).status;
      if (status >= 500) {
        const nextRetry = Number(req.retryCount ?? 0) + 1;
        if (nextRetry >= MAX_RETRIES) {
          const failedAt = Timestamp.now();
          tx.update({ path }, {
            status: 'failed', retryCount: nextRetry, failedAt,
            errorMessage: `transient retries exhausted: ${msg}`,
          });
          addCommunicationEvent({
            type: _eventTypeForOutcome(kind, 'failed'),
            channel: 'sms', direction: 'outbound',
            customerId: req.customerId, leadId,
            content: req.templateRendered,
            carrierResponse: msg,
            status: 'failed',
            sentAt: failedAt,
            createdByUid: req.invokedByUid ?? 'system:missedCallRecovery',
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
        status: 'failed', failedAt,
        errorMessage: carrierCode ? `${carrierCode}: ${msg}` : msg,
      });
      addCommunicationEvent({
        type: _eventTypeForOutcome(kind, 'failed'),
        channel: 'sms', direction: 'outbound',
        customerId: req.customerId, leadId,
        content: req.templateRendered,
        carrierResponse: carrierCode,
        status: 'failed',
        sentAt: failedAt,
        createdByUid: req.invokedByUid ?? 'system:missedCallRecovery',
      });
      return;
    }
    // Unknown error class → transient
    const nextRetry = Number(req.retryCount ?? 0) + 1;
    if (nextRetry >= MAX_RETRIES) {
      const failedAt = Timestamp.now();
      tx.update({ path }, {
        status: 'failed', retryCount: nextRetry, failedAt,
        errorMessage: `unknown error after retries: ${msg}`,
      });
      addCommunicationEvent({
        type: _eventTypeForOutcome(kind, 'failed'),
        channel: 'sms', direction: 'outbound',
        customerId: req.customerId, leadId,
        content: req.templateRendered,
        carrierResponse: msg,
        status: 'failed',
        sentAt: failedAt,
        createdByUid: req.invokedByUid ?? 'system:missedCallRecovery',
      });
    } else {
      tx.update({ path }, { status: 'pending', retryCount: nextRetry });
    }
  }
}

export const drainOutboundSms = onSchedule(
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
    const bizSnap = await db.collection('businesses').get();
    let scanned = 0, sent = 0, failedCount = 0;
    for (const bizDoc of bizSnap.docs) {
      const businessId = bizDoc.id;
      const pendingSnap = await db.collection(`businesses/${businessId}/outboundSms`)
        .where('status', '==', 'pending')
        .where('sendAfterAt', '<=', now)
        .limit(BATCH_LIMIT)
        .get();
      for (const reqDoc of pendingSnap.docs) {
        scanned += 1;
        const target = { businessId, smsId: reqDoc.id };
        try {
          await db.runTransaction(async (tx) => {
            const events: Array<Record<string, unknown>> = [];
            const addEvent: EventSink = (e) => events.push(e);
            const adapter: TxLike = {
              get: async (ref) => {
                const s = await tx.get(db.doc(ref.path));
                return { exists: s.exists, data: () => s.data() ?? undefined };
              },
              update: (ref, patch) => tx.update(db.doc(ref.path), patch),
              set:    (ref, patch) => tx.set(db.doc(ref.path), patch, { merge: true }),
            };
            await _processOne(target, adapter, realSendSms, addEvent);
            for (const e of events) {
              const eventRef = db.collection(`businesses/${businessId}/communicationEvents`).doc();
              tx.set(eventRef, { id: eventRef.id, ...e });
            }
            if (events.find(e => String(e.type).endsWith('_sent')))   sent += 1;
            if (events.find(e => String(e.type).endsWith('_failed'))) failedCount += 1;
          });
        } catch (err) {
          console.error('[drainOutboundSms] tx failed', { target, err: (err as Error).message });
        }
      }
    }
    console.info('[drainOutboundSms] done', {
      scanned, sent, failed: failedCount, durationMs: Date.now() - startTs,
    });
  },
);

export const __testHooks = {
  processOne: _processOne,
  isSendAfterPast: _isSendAfterPast,
  eventTypeForOutcome: _eventTypeForOutcome,
};
