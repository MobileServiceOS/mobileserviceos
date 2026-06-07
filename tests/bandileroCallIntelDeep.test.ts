// tests/bandileroCallIntelDeep.test.ts
// Run: npx tsx tests/bandileroCallIntelDeep.test.ts
//
// Deep call intelligence: funnel by status, conversion rate, and
// response time from real Lead + CommunicationEvent docs. All
// NOT_CONNECTED when Twilio is off — never a fake 0/0%.

import { funnelCounts, callIntelDeep, avgResponseMinutes } from '@/lib/bandilero/services/callIntelDeep';
import type { Lead, CommunicationEvent } from '@/types';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const TODAY = '2026-06-07';
const todayMs = new Date(TODAY + 'T12:00:00').getTime();
const ts = (ms: number) => ({ toMillis: () => ms });
const min = (n: number) => n * 60_000;

function lead(id: string, status: Lead['status'], over: Partial<Lead> = {}): Lead {
  return {
    id, customerId: 'c', phoneE164: '+1', source: 'missed_call', status,
    wasNewCustomer: true, autoTextSent: false,
    receivedAt: ts(todayMs), createdAt: ts(todayMs), updatedAt: ts(todayMs), lastEditedByUid: 'sys',
    ...over,
  } as unknown as Lead;
}

const leads: Lead[] = [
  lead('la', 'New'),
  lead('lb', 'Booked'),
  lead('lc', 'Lost'),
  lead('ld', 'inbound' as never, { source: 'inbound_sms' }), // not a missed call → excluded
];

console.log('\n── funnelCounts ──');
{
  const f = funnelCounts(leads, TODAY, 7);
  check('new = 1', f.new === 1);
  check('booked = 1', f.booked === 1);
  check('lost = 1', f.lost === 1);
  check('inbound_sms excluded (total missed = 3)', f.new + f.booked + f.lost === 3);
}

console.log('\n── callIntelDeep — Twilio CONNECTED ──');
{
  const d = callIntelDeep(leads, [], { twilio: true }, TODAY, 7);
  // recovered (Booked+Closed) = 1, total = 3 → 33%
  check('conversionPct LIVE = 33', d.conversionPct.state === 'LIVE' && d.conversionPct.value === 33, `got ${d.conversionPct.value}`);
  check('funnel.booked LIVE 1', d.funnel.booked.state === 'LIVE' && d.funnel.booked.value === 1);
  check('avgResponseMinutes NOT_CONNECTED with no events', d.avgResponseMinutes.state === 'NOT_CONNECTED');
}

console.log('\n── callIntelDeep — Twilio OFF ──');
{
  const d = callIntelDeep(leads, [], { twilio: false }, TODAY, 7);
  check('conversionPct NOT_CONNECTED (not 0%)', d.conversionPct.state === 'NOT_CONNECTED' && d.conversionPct.value === null);
  check('funnel.new NOT_CONNECTED', d.funnel.new.state === 'NOT_CONNECTED');
  check('avgResponseMinutes NOT_CONNECTED', d.avgResponseMinutes.state === 'NOT_CONNECTED');
}

console.log('\n── avgResponseMinutes ──');
{
  const events = [
    { id: 'e1', type: 'x', channel: 'sms', direction: 'outbound', customerId: 'c', leadId: 'la', sentAt: ts(todayMs + min(10)), createdByUid: 's' },
    { id: 'e2', type: 'x', channel: 'sms', direction: 'outbound', customerId: 'c', leadId: 'lb', sentAt: ts(todayMs + min(20)), createdByUid: 's' },
    { id: 'e3', type: 'x', channel: 'sms', direction: 'inbound',  customerId: 'c', leadId: 'lc', sentAt: ts(todayMs + min(5)),  createdByUid: 's' }, // inbound → ignored
  ] as unknown as CommunicationEvent[];
  const m = avgResponseMinutes(leads, events, TODAY, 7);
  check('avg response = 15 min ((10+20)/2)', m.state === 'LIVE' && m.value === 15, `got ${m.value}`);

  // lead lc has only an inbound event → no measurable response; not averaged.
  const onlyInbound = avgResponseMinutes([lead('lc', 'Lost')], events, TODAY, 7);
  check('no outbound response → NOT_CONNECTED (not 0)', onlyInbound.state === 'NOT_CONNECTED' && onlyInbound.value === null);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
