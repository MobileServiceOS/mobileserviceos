// ═══════════════════════════════════════════════════════════════════
//  tests/drainReviewRequests.test.ts
//  Run: npx tsx tests/drainReviewRequests.test.ts
//
//  Exercises the drainer's per-request decision tree via the
//  __testHooks.processOne() hook. Shimmed Firestore + injected
//  sendSms function — no emulator, no network.
// ═══════════════════════════════════════════════════════════════════

import { __testHooks } from '../functions/src/drainReviewRequests';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const { processOne } = __testHooks;

interface FakeDoc {
  path: string;
  data: Record<string, unknown>;
}
function makeShim(initialRequest: Record<string, unknown>) {
  const docs = new Map<string, Record<string, unknown>>();
  docs.set('businesses/biz1/reviewRequests/req1', { id: 'req1', ...initialRequest });
  const writes: Array<{ path: string; patch: Record<string, unknown>; op: 'set' | 'update' }> = [];
  const events: FakeDoc[] = [];

  return {
    docs, writes, events,
    // mimic admin Firestore shape the drainer needs
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
    addCommunicationEvent: (e: Record<string, unknown>) => {
      events.push({ path: `businesses/biz1/communicationEvents/evt${events.length+1}`, data: e });
    },
  };
}

function baseRequest(over: Record<string, unknown> = {}) {
  return {
    jobId: 'jobA', customerId: 'cust1', phoneE164: '+13055551234',
    templateUsed: 'Hi {firstName}', templateRendered: 'Hi Maria, leave a review: https://g.page/r/x',
    status: 'pending', retryCount: 0, ...over,
  };
}

console.log('\n── Twilio off — leaves pending, no counter bump ──');
{
  const shim = makeShim(baseRequest());
  const sendSms = async () => { throw new Error('TWILIO_NOT_CONFIGURED'); };
  await processOne({ businessId: 'biz1', requestId: 'req1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/reviewRequests/req1');
  check('status stays pending', after?.status === 'pending');
  check('retryCount stays 0',   after?.retryCount === 0);
  check('no errorMessage written', after?.errorMessage === undefined);
  check('no communicationEvents log', shim.events.length === 0);
}

console.log('\n── 4xx — terminal fail, no retry ──');
{
  const shim = makeShim(baseRequest());
  const err = Object.assign(new Error('Invalid number'), { name: 'TwilioError', status: 400, carrierCode: '21211' });
  const sendSms = async () => { throw err; };
  await processOne({ businessId: 'biz1', requestId: 'req1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/reviewRequests/req1');
  check('status=failed on 4xx', after?.status === 'failed');
  check('errorMessage contains carrier code', String(after?.errorMessage ?? '').includes('21211'));
  check('1 communicationEvents log written', shim.events.length === 1);
  check('event type is review_request_failed', shim.events[0].data.type === 'review_request_failed');
}

console.log('\n── 5xx — retry, bumps counter ──');
{
  const shim = makeShim(baseRequest({ retryCount: 0 }));
  const err = Object.assign(new Error('upstream'), { name: 'TwilioError', status: 503 });
  const sendSms = async () => { throw err; };
  await processOne({ businessId: 'biz1', requestId: 'req1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/reviewRequests/req1');
  check('status stays pending after 5xx', after?.status === 'pending');
  check('retryCount incremented to 1', after?.retryCount === 1);
  check('no communicationEvents log on transient retry', shim.events.length === 0);
}

console.log('\n── 5xx — third strike → failed ──');
{
  const shim = makeShim(baseRequest({ retryCount: 2 }));
  const err = Object.assign(new Error('upstream'), { name: 'TwilioError', status: 503 });
  const sendSms = async () => { throw err; };
  await processOne({ businessId: 'biz1', requestId: 'req1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/reviewRequests/req1');
  check('status=failed at retryCount==3', after?.status === 'failed');
  check('retryCount frozen at 3', after?.retryCount === 3);
  check('communicationEvents log on terminal failure', shim.events.length === 1);
}

console.log('\n── success — sent + sid + lifecycle ──');
{
  const shim = makeShim(baseRequest());
  const sendSms = async () => ({ messageSid: 'SM_test_abc', deliveryStatus: 'queued' });
  await processOne({ businessId: 'biz1', requestId: 'req1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/reviewRequests/req1');
  check('status=sent', after?.status === 'sent');
  check('twilioMessageSid populated', after?.twilioMessageSid === 'SM_test_abc');
  check('deliveryStatus set to queued', after?.deliveryStatus === 'queued');
  check('sentAt populated', after?.sentAt !== undefined);
  check('1 communicationEvents log written', shim.events.length === 1);
  check('event type review_request_sent', shim.events[0].data.type === 'review_request_sent');
  check('event content matches templateRendered', shim.events[0].data.content === 'Hi Maria, leave a review: https://g.page/r/x');
}

console.log('\n── racing instances — second one no-ops ──');
{
  // Pre-flip the request to sending to simulate Instance A already claimed it.
  const shim = makeShim(baseRequest({ status: 'sending' }));
  const sendSms = async () => { throw new Error('should not be called'); };
  await processOne({ businessId: 'biz1', requestId: 'req1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/reviewRequests/req1');
  check('status stays sending — second instance skipped', after?.status === 'sending');
  check('no writes from second instance', shim.writes.every(w => w.path !== 'businesses/biz1/reviewRequests/req1' || w.patch.status === undefined || w.patch.status === 'sending'));
  check('no communicationEvents log',  shim.events.length === 0);
}

console.log('\n── sendAfterAt in the future — leaves pending ──');
{
  const futureMs = Date.now() + 10 * 60_000;
  const shim = makeShim(baseRequest({ sendAfterAt: { _seconds: Math.floor(futureMs / 1000), _nanoseconds: 0 } }));
  // The query layer normally filters this out, but processOne defends too.
  const sendSms = async () => { throw new Error('should not be called'); };
  await processOne({ businessId: 'biz1', requestId: 'req1' }, shim.tx as never, sendSms, shim.addCommunicationEvent);
  const after = shim.docs.get('businesses/biz1/reviewRequests/req1');
  check('status stays pending when sendAfterAt > now', after?.status === 'pending');
  check('no events', shim.events.length === 0);
}

console.log(`\n── ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
