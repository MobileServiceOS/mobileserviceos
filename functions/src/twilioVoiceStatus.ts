// functions/src/twilioVoiceStatus.ts
// ═══════════════════════════════════════════════════════════════════
//  twilioVoiceStatus — SP4B inbound webhook (HTTPS function).
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"1. twilioVoiceStatus HTTPS webhook"
//
//  Twilio Console → Phone Numbers → [Number] → Voice & Fax → Status
//  Callback URL points here. Twilio POSTs form-encoded body on every
//  call completion. We filter to inbound missed calls and create a
//  Lead + optionally enqueue an outboundSms auto-text.
//
//  Pure decision logic lives in _decide() (exposed via __testHooks).
//  The wrapper handles signature validation, Firestore transactions,
//  and HTTP response codes.
//
//  Returns 200 OK for all internal failures (with loud console.error)
//  so Twilio doesn't initiate a retry storm. 403 is reserved for
//  forged signature failures only.
//
//  Architecture note (added 2026-06-05): this webhook assumes the
//  Twilio number is the TARGET of upstream conditional call forwarding
//  (e.g., carrier-level no-answer/busy/missed forwarding from the
//  operator's public business line). Every inbound POST to this
//  endpoint represents a missed call. The CallStatus filter that
//  originally gated enqueue has been removed; the only gates now
//  are (1) Direction='inbound', (2) valid E.164 From, (3) 24h
//  per-phone dedup. If a future tenant uses Twilio as the PRIMARY
//  receiver instead of a forward target, restore the CallStatus
//  filter by reverting to `if (!status) return skip('not-missed')`.
// ═══════════════════════════════════════════════════════════════════

import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { renderTemplate } from './lib/reviewTemplate';
import { assertValidTwilioSignature } from './lib/twilioSignatureValidator';
import {
  OPERATIONAL_SETTINGS_COLLECTION,
  brandSettingsDocPath,
} from './lib/operationalSettings';
void admin;

const DEFAULT_TEMPLATE_FALLBACK = 'Hi, thanks for contacting {businessName}.';

type SettingsLite = {
  missedCallAutoTextEnabled?: boolean;
  missedCallTemplate?: string;
  businessName?: string;
  twilioPhoneNumber?: string;
};
type CustomerLite = {
  id: string;
  name?: string;
  phoneE164?: string;
  kind?: 'individual' | 'fleet';
  vipTier?: 'Standard' | 'Gold' | 'Platinum';
  jobCount?: number;
};

interface LeadDraft {
  customerId: string;
  phoneE164: string;
  source: 'missed_call';
  status: 'New';
  wasNewCustomer: boolean;
  callSid?: string;
  callStatus?: 'no-answer' | 'busy' | 'failed' | 'voicemail';
  autoTextSent: false;
  lastEditedByUid: 'system:missedCallRecovery';
}
interface OutboundSmsDraft {
  id: string;
  kind: 'missed_call_response';
  leadId: string;
  customerId: string;
  phoneE164: string;
  templateUsed: string;
  templateRendered: string;
  status: 'pending';
  retryCount: 0;
  isTest: false;
  invokedByUid: 'system:missedCallRecovery';
}

interface DecisionEnqueue {
  action: 'enqueue';
  leadId: string;
  wasNewCustomer: boolean;
  lead: LeadDraft;
  outboundSms?: OutboundSmsDraft;
}
interface DecisionSkip {
  action: 'skip';
  reason: string;
}
export type Decision = DecisionEnqueue | DecisionSkip;

function _digitsOnly(e164: string): string {
  return (e164 ?? '').replace(/[^\d]/g, '');
}

function _isValidE164(s: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(s);
}

function _computeLeadId(fromE164: string, dateIso: string): string {
  return `lead-${_digitsOnly(fromE164)}-${dateIso}`;
}

function _isoDate(): string {
  // YYYY-MM-DD in UTC. Date partition for dedup. Operators in DST
  // edge cases get the UTC boundary — acceptable for v1.
  return new Date().toISOString().slice(0, 10);
}

function _mapCallStatus(raw: string): 'no-answer' | 'busy' | 'failed' | 'voicemail' | null {
  switch (raw) {
    case 'no-answer': return 'no-answer';
    case 'busy':      return 'busy';
    case 'failed':    return 'failed';
    case 'voicemail': return 'voicemail';
    default:          return null;
  }
}

function _decide(
  form: Record<string, string>,
  settings: SettingsLite,
  existingCustomer: CustomerLite | null,
  existingLead24h: { id: string } | null,
): Decision {
  // Guard 1: inbound only
  if (form.Direction !== 'inbound') {
    return { action: 'skip', reason: 'not-inbound' };
  }
  // Architecture: Twilio number only receives carrier-forwarded missed calls
  // (per operator T-Mobile conditional-forwarding config). Status field is
  // captured as metadata only — no longer gates the enqueue. The Direction
  // filter above (inbound only) + the 24h dedup + valid-phone check are the
  // real safety gates.
  const status = _mapCallStatus(form.DialCallStatus || form.CallStatus) ?? 'no-answer';
  // Guard 3: valid phone
  if (!_isValidE164(form.From)) {
    return { action: 'skip', reason: 'invalid-phone' };
  }
  // Guard 4: 24h dedup
  if (existingLead24h) {
    return { action: 'skip', reason: 'dedup' };
  }

  const dateIso = _isoDate();
  const leadId = _computeLeadId(form.From, dateIso);

  const customerId = existingCustomer?.id ?? `p_${_digitsOnly(form.From)}`;
  const wasNewCustomer = !existingCustomer;

  const lead: LeadDraft = {
    customerId,
    phoneE164: form.From,
    source: 'missed_call',
    status: 'New',
    wasNewCustomer,
    callSid: form.CallSid,
    callStatus: status,
    autoTextSent: false,
    lastEditedByUid: 'system:missedCallRecovery',
  };

  let outboundSms: OutboundSmsDraft | undefined;
  if (settings.missedCallAutoTextEnabled === true) {
    const template = settings.missedCallTemplate?.trim() || DEFAULT_TEMPLATE_FALLBACK;
    const templateRendered = renderTemplate(template, {
      firstName:    existingCustomer?.name ? (existingCustomer.name.trim().split(/\s+/)[0] ?? '') : '',
      lastName:     existingCustomer?.name ? existingCustomer.name.trim().split(/\s+/).slice(1).join(' ') : '',
      businessName: settings.businessName?.trim() ?? '',
      serviceType:  '',
      city:         '',
      vehicle:      '',
      reviewLink:   '',
    });
    outboundSms = {
      id: `sms-${leadId}`,
      kind: 'missed_call_response',
      leadId,
      customerId,
      phoneE164: form.From,
      templateUsed: template,
      templateRendered,
      status: 'pending',
      retryCount: 0,
      isTest: false,
      invokedByUid: 'system:missedCallRecovery',
    };
  }

  return { action: 'enqueue', leadId, wasNewCustomer, lead, outboundSms };
}

// ─── Wrapper ───────────────────────────────────────────────────────

export const twilioVoiceStatus = onRequest(
  {
    cors: false,
    secrets: ['TWILIO_AUTH_TOKEN'],
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('method not allowed');
      return;
    }
    // Twilio sends application/x-www-form-urlencoded. Firebase Functions
    // v2 onRequest parses this into req.body as an object of strings.
    const form = (req.body ?? {}) as Record<string, string>;

    // 1. Signature validation
    try {
      // Twilio signs the URL configured in Twilio Console — for SP4B
      // that's the canonical cloudfunctions.net public URL. Cloud Run's
      // container receives the request via a GCP proxy that rewrites
      // both Host (→ *.a.run.app) and Path (→ /), so reconstructing the
      // URL from req.* always mismatches. Use the canonical URL the
      // operator configured. Override via env for emulator/multi-tenant.
      const url = process.env.TWILIO_WEBHOOK_URL
        || 'https://us-central1-mobile-service-os.cloudfunctions.net/twilioVoiceStatus';
      assertValidTwilioSignature({
        signatureHeader: req.header('x-twilio-signature') ?? undefined,
        url,
        params: form,
      });
    } catch (err) {
      if ((err as Error).message === 'TWILIO_SIGNATURE_INVALID') {
        console.error('[twilioVoiceStatus] signature invalid', {
          from: form.From, to: form.To, callSid: form.CallSid,
        });
        res.status(403).send('invalid signature');
        return;
      }
      console.error('[twilioVoiceStatus] signature check error', err);
      res.status(200).send('ok');
      return;
    }

    try {
      const db = admin.firestore();

      // 2. Route to business via collection-group operational_settings query.
      //    twilioPhoneNumber lives on operational_settings/main — written
      //    by persistSettings (src/App.tsx). The collection-group index
      //    is declared in firestore.indexes.json as a fieldOverride.
      const bizSnap = await db.collectionGroup(OPERATIONAL_SETTINGS_COLLECTION)
        .where('twilioPhoneNumber', '==', form.To ?? '')
        .limit(1)
        .get();
      if (bizSnap.empty) {
        console.warn('[twilioVoiceStatus] no business found for To', { to: form.To });
        res.status(200).send('ok');
        return;
      }
      const opsDoc     = bizSnap.docs[0];
      const businessId = opsDoc.ref.parent.parent?.id;
      if (!businessId) {
        console.warn('[twilioVoiceStatus] settings path missing parent business', {
          path: opsDoc.ref.path,
        });
        res.status(200).send('ok');
        return;
      }
      // Merge brand fields (businessName for SMS rendering) onto operational
      // fields (missedCallAutoTextEnabled / missedCallTemplate). Brand lives
      // at settings/main; operational at operational_settings/main. Read the
      // Brand doc directly here (we already have the operational doc from
      // the routing query, so an additional .get() saves a redundant fetch).
      const brandSnap = await db.doc(brandSettingsDocPath(businessId)).get();
      const brandData = (brandSnap.exists ? brandSnap.data() ?? {} : {}) as Record<string, unknown>;
      const opsData   = opsDoc.data() as Record<string, unknown>;
      const settings: SettingsLite = { ...brandData, ...opsData } as SettingsLite;

      // 3. Look up existing customer by phone
      let existingCustomer: CustomerLite | null = null;
      if (form.From && _isValidE164(form.From)) {
        const phoneKey = _digitsOnly(form.From);
        const customerRef = db.doc(`businesses/${businessId}/customers/p_${phoneKey}`);
        const custSnap = await customerRef.get();
        if (custSnap.exists) {
          existingCustomer = { id: custSnap.id, ...(custSnap.data() as Omit<CustomerLite, 'id'>) };
        }
      }

      // 4. Dedup check — Lead from same phone in last 24h
      const dayAgo = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
      const dedupSnap = await db.collection(`businesses/${businessId}/leads`)
        .where('phoneE164', '==', form.From ?? '')
        .where('receivedAt', '>', dayAgo)
        .limit(1)
        .get();
      const existingLead24h = dedupSnap.empty
        ? null
        : { id: dedupSnap.docs[0].id };

      // 5. Pure decision
      const decision = _decide(form, settings, existingCustomer, existingLead24h);
      if (decision.action === 'skip') {
        console.info('[twilioVoiceStatus] skip', { reason: decision.reason, from: form.From });
        res.status(200).send('ok');
        return;
      }

      // 6. Apply decision in a transaction
      const leadRef = db.doc(`businesses/${businessId}/leads/${decision.leadId}`);
      const customerRef = db.doc(`businesses/${businessId}/customers/${decision.lead.customerId}`);
      const outboundSmsRef = decision.outboundSms
        ? db.doc(`businesses/${businessId}/outboundSms/${decision.outboundSms.id}`)
        : null;
      const now = Timestamp.now();

      await db.runTransaction(async (tx) => {
        // Re-check dedup inside the tx (race protection)
        const freshLead = await tx.get(leadRef);
        if (freshLead.exists) {
          console.info('[twilioVoiceStatus] race-skip — Lead already exists', { leadId: decision.leadId });
          return;
        }

        // If customer was new, write the Customer doc inside the tx
        if (decision.wasNewCustomer) {
          tx.set(customerRef, {
            id: decision.lead.customerId,
            name: '',
            nameLower: '',
            phoneE164: form.From,
            phoneKey: _digitsOnly(form.From),
            kind: 'individual',
            jobCount: 0,
            customerStatus: 'Active',
            vipTier: 'Standard',
            createdAt: now,
            updatedAt: now,
            lastEditedAt: now,
            lastEditedByUid: 'system:missedCallRecovery',
          }, { merge: true });
        }

        tx.set(leadRef, {
          id: decision.leadId,
          ...decision.lead,
          receivedAt: now,
          createdAt: now,
          updatedAt: now,
        });

        if (outboundSmsRef && decision.outboundSms) {
          tx.set(outboundSmsRef, {
            ...decision.outboundSms,
            sendAfterAt: now,
            createdAt: now,
          });
        }

        // CommunicationEvent: missed_call_received (always)
        const evtRef = db.collection(`businesses/${businessId}/communicationEvents`).doc();
        tx.set(evtRef, {
          id: evtRef.id,
          type: 'missed_call_received',
          channel: 'call',
          direction: 'inbound',
          customerId: decision.lead.customerId,
          leadId: decision.leadId,
          status: 'queued',
          sentAt: now,
          createdByUid: 'system:missedCallRecovery',
        });
      });

      console.info('[twilioVoiceStatus] lead enqueued', {
        businessId, leadId: decision.leadId, from: form.From,
        wasNewCustomer: decision.wasNewCustomer,
        autoTextEnqueued: !!decision.outboundSms,
      });
      res.status(200).send('ok');
    } catch (err) {
      console.error('[twilioVoiceStatus] internal error', err);
      // ALWAYS 200 on internal error so Twilio doesn't retry-storm
      res.status(200).send('ok');
    }
  },
);

export const __testHooks = {
  decide: _decide,
  computeLeadId: _computeLeadId,
  isValidE164: _isValidE164,
  mapCallStatus: _mapCallStatus,
};
