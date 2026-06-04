// ═══════════════════════════════════════════════════════════════════
//  tests/drainOutboundSms.test.ts
//  Run: npx tsx tests/drainOutboundSms.test.ts
//
//  Mirrors SP4A's drainReviewRequests test suite for the outboundSms
//  queue. Same 7 outcome paths. Plus: confirms the parent Lead
//  `autoTextSent` flag flips on success for kind=missed_call_response.
// ═══════════════════════════════════════════════════════════════════

import { __testHooks } from '../functions/src/drainOutboundSms';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const { processOne } = __testHooks;

function makeShim(initialSms: Record<string, unknown>, initialLead?: Record<string, unknown>) {
  const docs = new Map<string, Record<string, unknown>>();
  docs.set('businesses/biz1/outboundSms/sms1', { id: 'sms1', ...initialSms });
  if (initialLead) {
    docs.set(`businesses/biz1/leads/${initialLead.id}`, initialLead);
  }
  const writes: Array<{ path: string; patch: Record<string, unknown>; op: 'set' | 'update' }> = [];
  const events: Array<Record<string, unknown>> = [];

  return {
    docs, writes, events,
    tx: {
      get: async (ref: { path: string }) => ({
        exists: docs.has(ref.path),
        data: () => docs.get(ref.path),
      }),
      update: (ref: { path: string }, patch: Record<string, unknown>) => {
        const current = docs.get(ref.path) ?? {};
        docs.set(ref.path, { ...current, ...patch });
        writes.push({ path: ref.path, patch, op: 'update' });
      },
      set: (ref: { path: string }, patch: Record<string, unknown>) => {
        docs.set(ref.path, { ...(docs.get(ref.path) ?? {}), ...patch });
        writes.push({ path: ref.path, patch, op: 'set' });
      },
    },
    addCommunicationEvent: (e: Record<string, unknown>) => { events.push(e); },
  };
}

function baseSms(over: Record<string, unknown> = {}) {
  return {
    kind: 'missed_call_response',
    leadId: 'lead-3055551234-2026-06-04',
    customerId: 'p_13055551234',
    phoneE164: '+13055551234',
    templateUsed: 'Hi, thanks for contacting {businessName}.',
    templateRendered: 'Hi, thanks for contacting Wheel Rush.',
    status: 'pending',
    retryCount: 0,
    invokedByUid: 'system:missedCallRecovery',
    ...over,
  };
}

function baseLead() {
  return { id: 'lead-3055551234-2026-06-04', autoTextSent: false };
}

console.log('\n── Twilio off → leaves pending ──');
{
  const shim = makeShim(baseSms(), baseLead());
  const sendSms = async () => { throw new Error('TWILIO_NOT_CONFIGURED'); };
  await processOne({ businessId: 'biz1', smsId: 'sms1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/outboundSms/sms1');
  check('status stays pending', after?.status === 'pending');
  check('retryCount stays 0', after?.retryCount === 0);
  check('no events', shim.events.length === 0);
  const lead = shim.docs.get(`businesses/biz1/leads/lead-3055551234-2026-06-04`);
  check('lead.autoTextSent stays false', lead?.autoTextSent === false);
}

console.log('\n── 4xx terminal → failed + event ──');
{
  const shim = makeShim(baseSms(), baseLead());
  const err = Object.assign(new Error('Invalid number'), { name: 'TwilioError', status: 400, carrierCode: '21211' });
  const sendSms = async () => { throw err; };
  await processOne({ businessId: 'biz1', smsId: 'sms1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/outboundSms/sms1');
  check('status=failed on 4xx', after?.status === 'failed');
  check('event missed_call_auto_text_failed logged', shim.events[0]?.type === 'missed_call_auto_text_failed');
}

console.log('\n── 5xx retry → bumps counter, no event ──');
{
  const shim = makeShim(baseSms({ retryCount: 0 }), baseLead());
  const err = Object.assign(new Error('upstream'), { name: 'TwilioError', status: 503 });
  const sendSms = async () => { throw err; };
  await processOne({ businessId: 'biz1', smsId: 'sms1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/outboundSms/sms1');
  check('stays pending', after?.status === 'pending');
  check('retryCount=1', after?.retryCount === 1);
  check('no event yet', shim.events.length === 0);
}

console.log('\n── 5xx third strike → failed + event ──');
{
  const shim = makeShim(baseSms({ retryCount: 2 }), baseLead());
  const err = Object.assign(new Error('upstream'), { name: 'TwilioError', status: 503 });
  const sendSms = async () => { throw err; };
  await processOne({ businessId: 'biz1', smsId: 'sms1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/outboundSms/sms1');
  check('status=failed', after?.status === 'failed');
  check('retryCount=3', after?.retryCount === 3);
  check('event logged', shim.events.length === 1);
}

console.log('\n── success: missed_call_response → flips lead.autoTextSent ──');
{
  const shim = makeShim(baseSms(), baseLead());
  const sendSms = async () => ({ messageSid: 'SM_abc', deliveryStatus: 'queued' });
  await processOne({ businessId: 'biz1', smsId: 'sms1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/outboundSms/sms1');
  check('status=sent', after?.status === 'sent');
  check('twilioMessageSid populated', after?.twilioMessageSid === 'SM_abc');
  check('deliveryStatus queued', after?.deliveryStatus === 'queued');
  check('event missed_call_auto_text_sent', shim.events[0]?.type === 'missed_call_auto_text_sent');
  const lead = shim.docs.get('businesses/biz1/leads/lead-3055551234-2026-06-04');
  check('lead.autoTextSent flipped true', lead?.autoTextSent === true);
  check('lead.outboundSmsId set', lead?.outboundSmsId === 'sms1');
}

console.log('\n── success: manual_lead_reply → does NOT flip lead.autoTextSent ──');
{
  const shim = makeShim(baseSms({ kind: 'manual_lead_reply', isManual: true, invokedByUid: 'uid-operator' }), baseLead());
  const sendSms = async () => ({ messageSid: 'SM_xyz', deliveryStatus: 'queued' });
  await processOne({ businessId: 'biz1', smsId: 'sms1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/outboundSms/sms1');
  check('status=sent', after?.status === 'sent');
  check('event outbound_sms_sent', shim.events[0]?.type === 'outbound_sms_sent');
  const lead = shim.docs.get('businesses/biz1/leads/lead-3055551234-2026-06-04');
  check('lead.autoTextSent stays false (manual reply does not flip)', lead?.autoTextSent === false);
}

console.log('\n── racing: doc already in sending → skip ──');
{
  const shim = makeShim(baseSms({ status: 'sending' }), baseLead());
  const sendSms = async () => { throw new Error('should not be called'); };
  await processOne({ businessId: 'biz1', smsId: 'sms1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/outboundSms/sms1');
  check('stays sending', after?.status === 'sending');
  check('no events', shim.events.length === 0);
}

console.log('\n── sendAfterAt future → skip ──');
{
  const futureMs = Date.now() + 10 * 60_000;
  const shim = makeShim(
    baseSms({ sendAfterAt: { _seconds: Math.floor(futureMs / 1000), _nanoseconds: 0 } }),
    baseLead(),
  );
  const sendSms = async () => { throw new Error('should not be called'); };
  await processOne({ businessId: 'biz1', smsId: 'sms1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/outboundSms/sms1');
  check('stays pending when sendAfterAt > now', after?.status === 'pending');
  check('no events', shim.events.length === 0);
}

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
