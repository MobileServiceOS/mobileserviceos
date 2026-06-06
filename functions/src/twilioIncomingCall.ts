// functions/src/twilioIncomingCall.ts
// ═══════════════════════════════════════════════════════════════════
//  twilioIncomingCall — Phase 1 real-time caller-ID webhook.
//
//  Spec: docs/superpowers/specs/2026-06-05-incoming-call-screenpop-design.md
//
//  This function ships DORMANT. It only fires when the operator points
//  the Twilio Voice URL (Phone Numbers → [Number] → Voice & Fax →
//  "A Call Comes In" → Webhook) at this endpoint. Until then it is
//  bytecode in the Cloud Functions runtime with no traffic.
//
//  Activation path (operator-driven, no code change required):
//    1. Operator confirms their T-Mobile plan supports SimRing /
//       Multi-Ring (DIGITS or carrier-equivalent on other carriers).
//    2. Operator configures SimRing in the T-Mobile portal to ring
//       the Twilio number in PARALLEL with their personal cell.
//    3. Operator points the Twilio Voice URL at:
//         https://us-central1-mobile-service-os.cloudfunctions.net/twilioIncomingCall
//
//  After activation, every inbound call to the business line rings
//  BOTH (a) the operator's cell over T-Mobile (with real audio) AND
//  (b) the Twilio leg, which routes here. We write a
//  businesses/{bid}/incoming_calls/{callSid} doc and respond with
//  <Hangup/> — the Twilio leg has no audio purpose, it exists purely
//  as a real-time popup trigger. The operator answers on their cell
//  while the IncomingCallNotification component on every connected
//  device pops within 1-2 seconds of the live ring.
//
//  Distinct from twilioVoiceStatus:
//    - twilioVoiceStatus is the STATUS CALLBACK (post-call) and
//      represents missed calls under carrier-forwarding.
//    - twilioIncomingCall is the VOICE URL (mid-call) and represents
//      a live ringing call under SimRing.
//
//  Component-side subscription: IncomingCallNotification.tsx subscribes
//  to BOTH businesses/{bid}/leads (missed-call source, active today)
//  AND businesses/{bid}/incoming_calls (this function's output,
//  dormant until activation). Whichever fires first triggers the
//  popup; same-phone dedup prevents double-fire.
//
//  Returns 200 OK on internal errors (no Twilio retry storm). 403 is
//  reserved for forged signature failures only. Always returns the
//  TwiML <Hangup/> so Twilio drops the call cleanly even when our
//  Firestore write fails — the user's cell still rings normally on
//  T-Mobile, so a failed popup is a degraded experience but not a
//  broken call.
//
//  TTL: each incoming_calls doc carries an `expiresAt` set to now+60s.
//  Operator must declare incoming_calls.expiresAt as a TTL field in
//  the Firebase Console (Firestore → TTL → Add Policy) so docs
//  auto-clean after the popup window closes. Without TTL, docs accrue
//  indefinitely — non-fatal but wasteful.
// ═══════════════════════════════════════════════════════════════════

import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { assertValidTwilioSignature } from './lib/twilioSignatureValidator';
import { OPERATIONAL_SETTINGS_COLLECTION } from './lib/operationalSettings';
void admin;

// TwiML payload — drop the Twilio leg silently. The actual call audio
// rings the operator's cell via T-Mobile SimRing, so Twilio's leg has
// no purpose past triggering the popup.
const TWIML_HANGUP = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';

// 60-second TTL — the popup's auto-dismiss window is 30s; a 60s TTL
// gives a comfortable buffer for late-arriving subscribers (slow
// device wake, brief network blip).
const INCOMING_CALL_TTL_MS = 60_000;

interface IncomingCallDecisionWrite {
  action: 'write';
  callSid: string;
  doc: {
    id: string;
    callSid: string;
    from: string;
    to: string;
    customerId: string | null;
    customerExists: boolean;
    direction: 'inbound';
    callStatus: 'ringing';
  };
}
interface IncomingCallDecisionSkip {
  action: 'skip';
  reason: string;
}
export type IncomingCallDecision =
  | IncomingCallDecisionWrite
  | IncomingCallDecisionSkip;

interface CustomerLite {
  id: string;
}

function _digitsOnly(e164: string): string {
  return (e164 ?? '').replace(/[^\d]/g, '');
}

function _isValidE164(s: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(s);
}

/**
 * Pure decision helper — exported via __testHooks. The wrapper handles
 * signature validation, Firestore lookups, doc writes, and the TwiML
 * response. This function decides ONLY whether to write an
 * incoming_calls doc, and if so, what fields it carries.
 *
 * Skip reasons:
 *   - 'invalid-from': From header missing or not a valid E.164.
 *   - 'invalid-to':   To header missing (we need it to route to a business).
 *   - 'missing-callsid': CallSid missing — would orphan the doc.
 *
 * Note: the customer-exists branch and the customer-absent branch
 * BOTH return action:'write'. The component decides what UI to show
 * via the customerExists flag and (when present) the customerId
 * lookup.
 */
function _decide(
  form: Record<string, string>,
  existingCustomer: CustomerLite | null,
): IncomingCallDecision {
  if (!_isValidE164(form.From ?? '')) {
    return { action: 'skip', reason: 'invalid-from' };
  }
  if (!form.To) {
    return { action: 'skip', reason: 'invalid-to' };
  }
  if (!form.CallSid) {
    return { action: 'skip', reason: 'missing-callsid' };
  }

  const customerId = existingCustomer?.id ?? null;
  const customerExists = !!existingCustomer;

  return {
    action: 'write',
    callSid: form.CallSid,
    doc: {
      id: form.CallSid,
      callSid: form.CallSid,
      from: form.From,
      to: form.To,
      customerId,
      customerExists,
      direction: 'inbound',
      callStatus: 'ringing',
    },
  };
}

// ─── Wrapper ───────────────────────────────────────────────────────

export const twilioIncomingCall = onRequest(
  {
    cors: false,
    secrets: ['TWILIO_AUTH_TOKEN'],
  },
  async (req, res) => {
    // TwiML helper — always send the hangup TwiML on the way out, even
    // on internal errors. We never want to leave Twilio holding a leg.
    const sendHangup = (status: number): void => {
      res.status(status).type('text/xml').send(TWIML_HANGUP);
    };

    if (req.method !== 'POST') {
      res.status(405).send('method not allowed');
      return;
    }

    const form = (req.body ?? {}) as Record<string, string>;

    // 1. Signature validation — canonical URL pattern (see commit a81de97).
    //    Cloud Run rewrites Host + Path, so reconstructing the URL from
    //    req.* always mismatches. Use the canonical cloudfunctions.net
    //    URL the operator configures in Twilio Console. Override via
    //    TWILIO_INCOMING_CALL_WEBHOOK_URL for emulator/multi-tenant.
    try {
      const url = process.env.TWILIO_INCOMING_CALL_WEBHOOK_URL
        || 'https://us-central1-mobile-service-os.cloudfunctions.net/twilioIncomingCall';
      assertValidTwilioSignature({
        signatureHeader: req.header('x-twilio-signature') ?? undefined,
        url,
        params: form,
      });
    } catch (err) {
      if ((err as Error).message === 'TWILIO_SIGNATURE_INVALID') {
        console.error('[twilioIncomingCall] signature invalid', {
          from: form.From, to: form.To, callSid: form.CallSid,
        });
        res.status(403).send('invalid signature');
        return;
      }
      console.error('[twilioIncomingCall] signature check error', err);
      // Non-signature error during validation: still hang up cleanly.
      sendHangup(200);
      return;
    }

    try {
      const db = admin.firestore();

      // 2. Route to business via collection-group operational_settings
      //    query — same pattern as twilioVoiceStatus.
      const bizSnap = await db.collectionGroup(OPERATIONAL_SETTINGS_COLLECTION)
        .where('twilioPhoneNumber', '==', form.To ?? '')
        .limit(1)
        .get();
      if (bizSnap.empty) {
        console.warn('[twilioIncomingCall] no business found for To', { to: form.To });
        sendHangup(200);
        return;
      }
      const opsDoc     = bizSnap.docs[0];
      const businessId = opsDoc.ref.parent.parent?.id;
      if (!businessId) {
        console.warn('[twilioIncomingCall] settings path missing parent business', {
          path: opsDoc.ref.path,
        });
        sendHangup(200);
        return;
      }

      // 3. Look up existing customer by From E.164 (p_<digits> convention).
      let existingCustomer: CustomerLite | null = null;
      if (form.From && _isValidE164(form.From)) {
        const phoneKey = _digitsOnly(form.From);
        const customerRef = db.doc(`businesses/${businessId}/customers/p_${phoneKey}`);
        const custSnap = await customerRef.get();
        if (custSnap.exists) {
          existingCustomer = { id: custSnap.id };
        }
      }

      // 4. Pure decision
      const decision = _decide(form, existingCustomer);
      if (decision.action === 'skip') {
        console.info('[twilioIncomingCall] skip', {
          reason: decision.reason, from: form.From, callSid: form.CallSid,
        });
        sendHangup(200);
        return;
      }

      // 5. Write the incoming_calls doc — keyed on CallSid for natural
      //    idempotency. Twilio retries land on the same key and
      //    re-merge identically.
      const now = Timestamp.now();
      const expiresAt = Timestamp.fromMillis(Date.now() + INCOMING_CALL_TTL_MS);
      const callRef = db.doc(`businesses/${businessId}/incoming_calls/${decision.callSid}`);
      await callRef.set({
        ...decision.doc,
        receivedAt: now,
        createdAt: now,
        expiresAt,
      }, { merge: true });

      console.info('[twilioIncomingCall] popup queued', {
        businessId,
        callSid: decision.callSid,
        from: form.From,
        customerExists: decision.doc.customerExists,
      });

      sendHangup(200);
    } catch (err) {
      console.error('[twilioIncomingCall] internal error', err);
      // Hang up cleanly even on internal errors so Twilio doesn't
      // retry-storm. The operator's cell is already ringing via
      // T-Mobile SimRing — a missed popup is a degraded UX, not a
      // broken call.
      sendHangup(200);
    }
  },
);

export const __testHooks = {
  decide: _decide,
  isValidE164: _isValidE164,
  digitsOnly: _digitsOnly,
};
