// functions/src/sendTestMissedCall.ts
// ═══════════════════════════════════════════════════════════════════
//  sendTestMissedCall — SP4B HTTPS callable.
//
//  Spec: docs/superpowers/specs/2026-06-04-sp4b-missed-call-recovery-design.md
//        §"7. Send Test Missed Call"
//
//  Synthesizes a fake Lead + outboundSms so the operator can exercise
//  the end-to-end flow without dialing their Twilio number. Lead id
//  is `lead-test-{uid}-{ms}` so:
//    - it doesn't collide with real missed-call leads
//    - leadPriority sorts it to the bottom of the queue
//    - the LeadCard renders a TEST badge
//
//  Owner+admin gated.
// ═══════════════════════════════════════════════════════════════════

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { renderTemplate } from './lib/reviewTemplate';
import { readBrandAndOperationalSettings } from './lib/operationalSettings';
void admin;

interface Input {
  businessId: string;
  phoneE164: string;             // operator's own number for the test
}

interface SettingsLite {
  missedCallTemplate?: string;
  businessName?: string;
  twilioPhoneNumber?: string;
}

interface BuildArgs {
  uid: string;
  settings: SettingsLite;
  phoneE164: string;
}

interface BuildResult {
  leadId: string;
  lead: {
    id: string;
    customerId: string;
    phoneE164: string;
    source: 'missed_call';
    status: 'New';
    wasNewCustomer: boolean;
    callSid: string;
    callStatus: 'no-answer';
    autoTextSent: false;
    lastEditedByUid: 'system:missedCallRecovery:test';
  };
  outboundSms: {
    id: string;
    kind: 'missed_call_response';
    leadId: string;
    customerId: string;
    phoneE164: string;
    templateUsed: string;
    templateRendered: string;
    status: 'pending';
    retryCount: 0;
    isTest: true;
    invokedByUid: string;
  };
}

function _buildLeadAndSms(args: BuildArgs): BuildResult {
  if (!args.phoneE164?.trim()) throw new Error('phoneE164 required');
  const template = args.settings.missedCallTemplate?.trim()
    || 'Hi, thanks for contacting {businessName}.';
  const templateRendered = renderTemplate(template, {
    firstName: '',
    lastName: '',
    businessName: args.settings.businessName?.trim() ?? '',
    serviceType: '', city: '', vehicle: '', reviewLink: '',
  });

  const ms = Date.now();
  const leadId = `lead-test-${args.uid}-${ms}`;
  // The test path uses a synthetic customer id that won't collide
  // with real customer lookups. The customer enrichment panel will
  // show "Test Lead" when it can't resolve this id.
  const customerId = `cust-test-${args.uid}`;

  return {
    leadId,
    lead: {
      id: leadId,
      customerId,
      phoneE164: args.phoneE164.trim(),
      source: 'missed_call',
      status: 'New',
      wasNewCustomer: false,
      callSid: `CA_test_${ms}`,
      callStatus: 'no-answer',
      autoTextSent: false,
      lastEditedByUid: 'system:missedCallRecovery:test',
    },
    outboundSms: {
      id: `sms-${leadId}`,
      kind: 'missed_call_response',
      leadId,
      customerId,
      phoneE164: args.phoneE164.trim(),
      templateUsed: template,
      templateRendered,
      status: 'pending',
      retryCount: 0,
      isTest: true,
      invokedByUid: args.uid,
    },
  };
}

export const sendTestMissedCall = onCall<Input, Promise<{ leadId: string }>>(
  async (req) => {
    const uid = req.auth?.uid;
    const { businessId, phoneE164 } = req.data ?? { businessId: '', phoneE164: '' };
    if (!uid)        throw new HttpsError('unauthenticated', 'sign-in required');
    if (!businessId) throw new HttpsError('invalid-argument', 'businessId required');
    if (!phoneE164?.trim()) {
      throw new HttpsError('invalid-argument', 'phoneE164 required');
    }

    const db = admin.firestore();
    const memberSnap = await db.doc(`businesses/${businessId}/members/${uid}`).get();
    const role = memberSnap.data()?.role;
    if (role !== 'owner' && role !== 'admin') {
      throw new HttpsError('permission-denied', 'owner or admin only');
    }

    // SP4B operational fields (missedCallTemplate, twilioPhoneNumber) live
    // on operational_settings/main; businessName lives on settings/main
    // (Brand). The merged read returns both.
    const settingsRead = await readBrandAndOperationalSettings<SettingsLite>(db, businessId);
    if (!settingsRead.operationalExists) {
      throw new HttpsError('failed-precondition', 'settings missing');
    }
    const settings = settingsRead.data;
    if (!settings.twilioPhoneNumber?.trim()) {
      throw new HttpsError('failed-precondition', 'set Twilio number in Settings first');
    }

    let build: BuildResult;
    try {
      build = _buildLeadAndSms({ uid, settings, phoneE164: phoneE164.trim() });
    } catch (err) {
      throw new HttpsError('invalid-argument', (err as Error).message);
    }

    const now = Timestamp.now();
    const leadRef = db.doc(`businesses/${businessId}/leads/${build.leadId}`);
    const smsRef  = db.doc(`businesses/${businessId}/outboundSms/${build.outboundSms.id}`);

    await db.runTransaction(async (tx) => {
      tx.set(leadRef, {
        ...build.lead,
        receivedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      tx.set(smsRef, {
        ...build.outboundSms,
        sendAfterAt: now,
        createdAt: now,
      });
    });

    return { leadId: build.leadId };
  },
);

export const __testHooks = {
  buildLeadAndSms: _buildLeadAndSms,
};
