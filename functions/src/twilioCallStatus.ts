// functions/src/twilioCallStatus.ts
// ═══════════════════════════════════════════════════════════════════
//  twilioCallStatus — call-analytics status callback (Bandilero Phase 4
//  #3 "Twilio Intelligence").
//
//  SHIPS DORMANT. A standalone, signature-validated Twilio Status
//  Callback that records EVERY inbound call (answered AND missed) into
//  businesses/{bid}/calls/{callSid} for analytics — duration, answer
//  status, answered-by, recording URL when present. The onCallWrite
//  trigger rolls these into daily callMetrics.
//
//  Relationship to twilioVoiceStatus (UNCHANGED): twilioVoiceStatus
//  remains the missed-call → Lead recovery endpoint. This function is
//  additive analytics and does NOT touch leads/customers/outboundSms.
//  Twilio allows one Status Callback URL per call; unifying both behind
//  a single endpoint (so analytics + recovery run together) is a
//  documented operator follow-up — see the Twilio audit. No fabricated
//  data: nothing is written unless a real Twilio callback arrives.
//
//  Activation: set the 3 Twilio secrets, enable the Status Callback on
//  the number pointing here, and (optionally) call recording.
// ═══════════════════════════════════════════════════════════════════

import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { assertValidTwilioSignature } from './lib/twilioSignatureValidator';
import { OPERATIONAL_SETTINGS_COLLECTION } from './lib/operationalSettings';
void admin;

export type CallStatus = 'completed' | 'no-answer' | 'busy' | 'failed' | 'canceled';
const KNOWN_STATUSES: CallStatus[] = ['completed', 'no-answer', 'busy', 'failed', 'canceled'];

function _digitsOnly(s: string): string {
  return (s || '').replace(/\D/g, '');
}

function _mapStatus(raw: string): CallStatus {
  const v = (raw || '').toLowerCase().trim() as CallStatus;
  return KNOWN_STATUSES.includes(v) ? v : 'failed';
}

/** Pure analytics shape derived from a Twilio status-callback form. */
export interface CallAnalytics {
  callSid: string;
  direction: 'inbound' | 'outbound';
  from: string;
  to: string;
  status: CallStatus;
  /** True only for a connected, non-zero-duration call. */
  answered: boolean;
  durationSec: number;
  answeredBy?: string;
  recordingUrl?: string;
}

/**
 * Map a Twilio status-callback form to the call analytics record.
 * Deterministic + pure (timestamps + customer linkage added by the
 * handler). `answered` requires a completed status AND real talk time.
 */
function _deriveCall(form: Record<string, string>): CallAnalytics | null {
  const callSid = form.CallSid;
  if (!callSid) return null;
  const status = _mapStatus(form.DialCallStatus || form.CallStatus);
  const durationSec = Math.max(0, Math.floor(Number(form.CallDuration || form.DialCallDuration || 0)));
  const direction = (form.Direction || '').startsWith('outbound') ? 'outbound' : 'inbound';
  const out: CallAnalytics = {
    callSid,
    direction,
    from: form.From || '',
    to: form.To || '',
    status,
    answered: status === 'completed' && durationSec > 0,
    durationSec,
  };
  if (form.AnsweredBy) out.answeredBy = form.AnsweredBy;
  if (form.RecordingUrl) out.recordingUrl = form.RecordingUrl;
  return out;
}

/** Local-NY date key (YYYY-MM-DD) — matches the app's date convention. */
function _businessDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export const twilioCallStatus = onRequest(
  { cors: false, secrets: ['TWILIO_AUTH_TOKEN'] },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('method not allowed'); return; }
    const form = (req.body ?? {}) as Record<string, string>;

    // 1. Signature validation (fails closed in prod via the validator).
    try {
      const url = process.env.TWILIO_CALL_STATUS_URL
        || 'https://us-central1-mobile-service-os.cloudfunctions.net/twilioCallStatus';
      assertValidTwilioSignature({
        signatureHeader: req.header('x-twilio-signature') ?? undefined,
        url,
        params: form,
      });
    } catch (err) {
      if ((err as Error).message === 'TWILIO_SIGNATURE_INVALID') {
        console.error('[twilioCallStatus] signature invalid', { callSid: form.CallSid });
        res.status(403).send('invalid signature');
        return;
      }
      console.error('[twilioCallStatus] signature check error', err);
      res.status(200).send('ok');
      return;
    }

    try {
      const analytics = _deriveCall(form);
      if (!analytics) { res.status(200).send('ok'); return; }

      const db = admin.firestore();

      // 2. Route to business by the called number (To).
      const bizSnap = await db.collectionGroup(OPERATIONAL_SETTINGS_COLLECTION)
        .where('twilioPhoneNumber', '==', form.To ?? '')
        .limit(1)
        .get();
      if (bizSnap.empty) {
        console.warn('[twilioCallStatus] no business for To', { to: form.To });
        res.status(200).send('ok');
        return;
      }
      const businessId = bizSnap.docs[0].ref.parent.parent?.id;
      if (!businessId) { res.status(200).send('ok'); return; }

      // 3. Best-effort customer linkage (never blocks the write).
      let customerId: string | null = null;
      let customerExists = false;
      const digits = _digitsOnly(analytics.from);
      if (digits) {
        try {
          const cSnap = await db.doc(`businesses/${businessId}/customers/p_${digits}`).get();
          if (cSnap.exists) { customerId = cSnap.id; customerExists = true; }
        } catch (e) { console.warn('[twilioCallStatus] customer lookup failed', e); }
      }

      // 4. Merge-write the call analytics doc (CallSid-keyed → idempotent
      //    across Twilio retries / multiple status events).
      const nowMs = Date.now();
      await db.doc(`businesses/${businessId}/calls/${analytics.callSid}`).set({
        ...analytics,
        customerId,
        customerExists,
        businessDate: _businessDate(nowMs),
        receivedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }, { merge: true });

      res.status(200).send('ok');
    } catch (err) {
      console.error('[twilioCallStatus] handler error', err);
      res.status(200).send('ok'); // never trigger a Twilio retry storm
    }
  },
);

export const __testHooks = {
  deriveCall: _deriveCall,
  mapStatus: _mapStatus,
  businessDate: _businessDate,
};
