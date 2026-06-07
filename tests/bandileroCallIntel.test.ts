// tests/bandileroCallIntel.test.ts
// Run: npx tsx tests/bandileroCallIntel.test.ts
//
// Call Intelligence + Review monitoring services. KEY honesty assertion:
// when Twilio / review automation is NOT connected, metrics are
// NOT_CONNECTED (value null) — never a fake 0. Lost-revenue is an
// ESTIMATED model with the assumption stated inline.

import { missedCallStats, missedCallMetrics } from '@/lib/bandilero/services/callIntel';
import { reviewRequestMetrics, reviewScore } from '@/lib/bandilero/services/reviews';
import type { Lead, ReviewRequest } from '@/types';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const TODAY = '2026-06-07';
const todayMs = new Date(TODAY + 'T12:00:00').getTime();
const ts = (ms: number) => ({ toMillis: () => ms });   // mimics Firestore Timestamp
const daysAgo = (n: number) => todayMs - n * 86_400_000;

function lead(over: Partial<Lead>): Lead {
  return {
    id: Math.random().toString(36).slice(2), customerId: 'c', phoneE164: '+13055550000',
    source: 'missed_call', status: 'New', wasNewCustomer: true, autoTextSent: false,
    receivedAt: ts(todayMs), createdAt: ts(todayMs), updatedAt: ts(todayMs), lastEditedByUid: 'sys',
    ...over,
  } as unknown as Lead;
}

const leads: Lead[] = [
  lead({ source: 'missed_call', status: 'New' }),               // unrecovered
  lead({ source: 'missed_call', status: 'Booked' }),            // recovered
  lead({ source: 'missed_call', status: 'Lost' }),              // unrecovered (lost)
  lead({ source: 'inbound_sms', status: 'New' }),               // not a missed call
  lead({ source: 'missed_call', status: 'New', receivedAt: ts(daysAgo(30)) }), // outside 7d window
];

console.log('\n── missedCallStats (7-day window) ──');
{
  const s = missedCallStats(leads, TODAY, 7);
  check('total = 3 (in-window missed calls)', s.total === 3, `got ${s.total}`);
  check('recovered = 1', s.recovered === 1, `got ${s.recovered}`);
  check('lost = 1', s.lost === 1, `got ${s.lost}`);
  check('unrecovered = 2 (total − recovered)', s.unrecovered === 2, `got ${s.unrecovered}`);
}

console.log('\n── missedCallMetrics — Twilio CONNECTED ──');
{
  const m = missedCallMetrics(leads, { twilio: true }, TODAY, 7, 150);
  check('count LIVE = 3', m.count.state === 'LIVE' && m.count.value === 3);
  check('recovered LIVE = 1', m.recovered.value === 1);
  check('unrecovered LIVE = 2', m.unrecovered.value === 2);
  check('lostRevenue ESTIMATED = 300 (2 × $150)', m.lostRevenue.state === 'ESTIMATED' && m.lostRevenue.value === 300, `got ${m.lostRevenue.value}`);
  check('lostRevenue assumption mentions avg ticket $150',
    !!m.lostRevenue.assumption && m.lostRevenue.assumption.includes('$150'));
}

console.log('\n── missedCallMetrics — Twilio NOT CONNECTED (honesty) ──');
{
  const m = missedCallMetrics(leads, { twilio: false }, TODAY, 7, 150);
  check('count NOT_CONNECTED (not 0)', m.count.state === 'NOT_CONNECTED' && m.count.value === null);
  check('unrecovered NOT_CONNECTED', m.unrecovered.state === 'NOT_CONNECTED' && m.unrecovered.value === null);
  check('lostRevenue NOT_CONNECTED', m.lostRevenue.state === 'NOT_CONNECTED' && m.lostRevenue.value === null);
}

console.log('\n── reviewRequestMetrics ──');
{
  const reqs = [
    { id: '1', status: 'sent',    createdAt: ts(todayMs) },
    { id: '2', status: 'sent',    createdAt: ts(todayMs) },
    { id: '3', status: 'pending', createdAt: ts(todayMs) },
    { id: '4', status: 'failed',  createdAt: ts(todayMs) },
    { id: '5', status: 'sent',    createdAt: ts(daysAgo(30)) }, // outside window
  ] as unknown as ReviewRequest[];

  const on = reviewRequestMetrics(reqs, { reviews: true }, TODAY, 7);
  check('sent LIVE = 2 (in window)', on.sent.state === 'LIVE' && on.sent.value === 2, `got ${on.sent.value}`);
  check('pending LIVE = 1', on.pending.value === 1);
  check('failed LIVE = 1', on.failed.value === 1);

  const off = reviewRequestMetrics(reqs, { reviews: false }, TODAY, 7);
  check('reviews not connected → sent NOT_CONNECTED (not 0)', off.sent.state === 'NOT_CONNECTED' && off.sent.value === null);
}

console.log('\n── reviewScore (no source) ──');
{
  const sc = reviewScore();
  check('review score always NOT_CONNECTED (no GBP/rating data)', sc.state === 'NOT_CONNECTED' && sc.value === null);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
