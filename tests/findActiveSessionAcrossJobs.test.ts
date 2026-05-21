// tests/findActiveSessionAcrossJobs.test.ts
// Run: npx tsx tests/findActiveSessionAcrossJobs.test.ts

import { findActiveSessionAcrossJobs } from '@/lib/jobTime';
import type { Job } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const j = (id: string, sessions?: { byUid: string; endAt?: string }[]): Job => ({
  id, date: '2026-05-21', service: 'Repair', vehicleType: 'Car',
  area: '', payment: 'Cash', status: 'Pending', source: 'Google',
  customerName: '', customerPhone: '', tireSize: '', qty: 1,
  revenue: 0, tireCost: 0, materialCost: 0, miles: 0, note: '',
  emergency: false, lateNight: false, highway: false, weekend: false,
  tireSource: 'Inventory', inventoryDeductions: null, paymentStatus: 'Paid',
  invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
  timeSessions: sessions?.map((x, i) => ({
    startAt: `2026-05-21T${10 + i}:00:00Z`,
    byUid: x.byUid,
    endAt: x.endAt,
  })),
} as Job);

console.log('\n┌─ findActiveSessionAcrossJobs ─────────────────────');
check('empty jobs list → null',
  findActiveSessionAcrossJobs([], 'tech1') === null);
check('null uid → null',
  findActiveSessionAcrossJobs([j('a', [{ byUid: 'tech1' }])], null) === null);
check('undefined uid → null',
  findActiveSessionAcrossJobs([j('a', [{ byUid: 'tech1' }])], undefined) === null);
{
  const jobs = [j('a', [{ byUid: 'tech1' }])];
  const r = findActiveSessionAcrossJobs(jobs, 'tech1');
  check('1 open session for uid → found',
    r !== null && r.job.id === 'a' && r.session.byUid === 'tech1');
}
{
  const jobs = [
    j('a', [{ byUid: 'tech1', endAt: '2026-05-21T11:00:00Z' }]),
    j('b', [{ byUid: 'tech1' }]),
  ];
  const r = findActiveSessionAcrossJobs(jobs, 'tech1');
  check('closed on a + open on b → finds b',
    r !== null && r.job.id === 'b');
}
{
  const jobs = [j('a', [{ byUid: 'tech2' }])];
  const r = findActiveSessionAcrossJobs(jobs, 'tech1');
  check('open session for different uid → null', r === null);
}
{
  const jobs = [j('a', [{ byUid: 'tech1', endAt: '2026-05-21T11:00:00Z' }])];
  const r = findActiveSessionAcrossJobs(jobs, 'tech1');
  check('only closed sessions for uid → null', r === null);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
