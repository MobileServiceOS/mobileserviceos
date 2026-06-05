// functions/src/sendManualOutboundSms.ts
// ═══════════════════════════════════════════════════════════════════
//  sendManualOutboundSms — SP4B HTTPS callable.
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"Composer at the bottom" (LeadDetailSheet section)
//
//  Operator types an ad-hoc SMS from the LeadDetailSheet composer
//  and fires it through the drainer. Doc id `sms-manual-{leadId}-{ms}`
//  so multiple sends to the same Lead stay distinct.
//
//  Owner+admin gated. Validates the parent Lead exists.
// ═══════════════════════════════════════════════════════════════════

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { readOperationalSettings } from './lib/operationalSettings';
void admin;

interface Input {
  businessId: string;
  leadId: string;
  body: string;
}

interface BuildArgs {
  leadId: string;
  customerId: string;
  phoneE164: string;
  body: string;
  uid: string;
}

function _buildPatch(args: BuildArgs): Record<string, unknown> {
  if (!args.phoneE164?.trim()) throw new Error('phoneE164 required');
  if (!args.body?.trim())      throw new Error('body required');
  return {
    kind: 'manual_lead_reply',
    leadId: args.leadId,
    customerId: args.customerId,
    phoneE164: args.phoneE164.trim(),
    templateUsed: args.body.trim(),
    templateRendered: args.body.trim(),
    status: 'pending',
    retryCount: 0,
    isManual: true,
    invokedByUid: args.uid,
  };
}

function _computeSmsId(leadId: string, epochMs: number): string {
  return `sms-manual-${leadId}-${epochMs}`;
}

export const sendManualOutboundSms = onCall<Input, Promise<{ smsId: string }>>(
  async (req) => {
    const uid = req.auth?.uid;
    const { businessId, leadId, body } = req.data ?? { businessId: '', leadId: '', body: '' };
    if (!uid)        throw new HttpsError('unauthenticated', 'sign-in required');
    if (!businessId) throw new HttpsError('invalid-argument', 'businessId required');
    if (!leadId)     throw new HttpsError('invalid-argument', 'leadId required');
    if (!body?.trim()) throw new HttpsError('invalid-argument', 'body required');

    const db = admin.firestore();
    const memberSnap = await db.doc(`businesses/${businessId}/members/${uid}`).get();
    const role = memberSnap.data()?.role;
    if (role !== 'owner' && role !== 'admin') {
      throw new HttpsError('permission-denied', 'owner or admin only');
    }

    const leadSnap = await db.doc(`businesses/${businessId}/leads/${leadId}`).get();
    if (!leadSnap.exists) {
      throw new HttpsError('not-found', 'lead not found');
    }
    const lead = leadSnap.data() ?? {};
    if (!lead.phoneE164 || !lead.customerId) {
      throw new HttpsError('failed-precondition', 'lead missing phoneE164 or customerId');
    }

    // twilioPhoneNumber is an operational field (operational_settings/main),
    // not a Brand field. This gate only needs the operational doc.
    const settingsRead = await readOperationalSettings<{ twilioPhoneNumber?: string }>(db, businessId);
    if (!settingsRead.data.twilioPhoneNumber?.trim()) {
      throw new HttpsError('failed-precondition', 'set Twilio number in Settings first');
    }

    let patch: Record<string, unknown>;
    try {
      patch = _buildPatch({
        leadId,
        customerId: String(lead.customerId),
        phoneE164: String(lead.phoneE164),
        body,
        uid,
      });
    } catch (err) {
      throw new HttpsError('invalid-argument', (err as Error).message);
    }

    const ms = Date.now();
    const smsId = _computeSmsId(leadId, ms);
    const now = Timestamp.now();
    await db.doc(`businesses/${businessId}/outboundSms/${smsId}`).set({
      id: smsId,
      ...patch,
      sendAfterAt: now,
      createdAt: now,
    });

    return { smsId };
  },
);

export const __testHooks = {
  buildPatch: _buildPatch,
  computeSmsId: _computeSmsId,
};
