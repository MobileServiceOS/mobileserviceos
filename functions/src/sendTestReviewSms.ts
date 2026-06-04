// functions/src/sendTestReviewSms.ts
// ═══════════════════════════════════════════════════════════════════
//  sendTestReviewSms — HTTPS callable (SP4A task 8).
//
//  Spec: §"7. Send Test SMS form" in
//        docs/superpowers/specs/2026-06-03-sp4a-review-automation-design.md
//
//  Owner/admin gated. Enqueues a reviewRequests doc with isTest:true
//  + sendAfterAt:now so the drainer picks it up immediately. The doc
//  id is req-test-{uid}-{epochMs} so multiple test sends from the
//  same operator on the same day still produce distinct rows.
// ═══════════════════════════════════════════════════════════════════

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { renderTemplate } from './lib/reviewTemplate';
void admin;

interface SendTestInput {
  businessId: string;
  phoneE164?: string;     // optional override; defaults to caller's member.phone
  template?: string;      // optional override; defaults to settings.reviewSmsTemplate
}

interface BuildPatchArgs {
  phoneE164: string;
  template: string;
  settings: {
    reviewSmsTemplate?: string;
    googleReviewLink?: string;
    businessName?: string;
  };
  uid: string;
}

function _buildPatch(args: BuildPatchArgs): Record<string, unknown> {
  if (!args.phoneE164?.trim()) throw new Error('phoneE164 required');
  if (!args.settings.googleReviewLink?.trim()) throw new Error('googleReviewLink required in settings');
  const template = args.template?.trim() || args.settings.reviewSmsTemplate?.trim() || '';
  if (!template) throw new Error('template required');
  const rendered = renderTemplate(template, {
    firstName: 'Test',
    lastName:  'Operator',
    businessName: args.settings.businessName?.trim(),
    serviceType:  'Test Send',
    city:         '',
    vehicle:      '',
    reviewLink:   args.settings.googleReviewLink.trim(),
  });
  return {
    jobId: '__test__',
    customerId: '__test__',
    phoneE164: args.phoneE164.trim(),
    templateUsed: template,
    templateRendered: rendered,
    status: 'pending',
    retryCount: 0,
    isTest: true,
    invokedByUid: args.uid,
  };
}

export const sendTestReviewSms = onCall<SendTestInput, Promise<{ requestId: string }>>(async (req) => {
  const uid = req.auth?.uid;
  const { businessId, phoneE164, template } = req.data ?? { businessId: '' };
  if (!uid)        throw new HttpsError('unauthenticated', 'sign-in required');
  if (!businessId) throw new HttpsError('invalid-argument', 'businessId required');

  const db = admin.firestore();
  const memberSnap = await db.doc(`businesses/${businessId}/members/${uid}`).get();
  const role = memberSnap.data()?.role;
  if (role !== 'owner' && role !== 'admin') {
    throw new HttpsError('permission-denied', 'owner or admin only');
  }
  const memberPhone = (memberSnap.data()?.phoneE164 ?? '') as string;
  const targetPhone = phoneE164?.trim() || memberPhone.trim();
  if (!targetPhone) {
    throw new HttpsError('invalid-argument', 'phoneE164 required (caller member doc has none)');
  }

  const settingsSnap = await db.doc(`businesses/${businessId}/settings/main`).get();
  const settings = settingsSnap.data() ?? {};
  if (!settings.googleReviewLink?.trim()) {
    throw new HttpsError('failed-precondition', 'set Google Review URL in Settings first');
  }

  let patch: Record<string, unknown>;
  try {
    patch = _buildPatch({
      phoneE164: targetPhone,
      template: template ?? '',
      settings,
      uid,
    });
  } catch (err) {
    throw new HttpsError('invalid-argument', (err as Error).message);
  }

  const requestId = `req-test-${uid}-${Date.now()}`;
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
};
