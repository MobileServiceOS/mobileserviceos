// tests/startStopSession.test.ts
// Run: npx tsx tests/startStopSession.test.ts

import { startSession, stopActiveSession } from '@/lib/jobTime';
import type { Job } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const baseJob = (over: Partial<Job> = {}): Job => ({
  id: 'j', date: '2026-05-21', service: 'Repair', vehicleType: 'Car',
  area: '', payment: 'Cash', status: 'Pending', source: 'Google',
  customerName: '', customerPhone: '', tireSize: '', qty: 1,
  revenue: 0, tireCost: 0, materialCost: 0, miles: 0, note: '',
  emergency: false, lateNight: false, highway: false, weekend: false,
  tireSource: 'Inventory', inventoryDeductions: null, paymentStatus: 'Paid',
  invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
  ...over,
} as Job);

console.log('\n┌─ startSession ────────────────────────────────────');
{
  const now = new Date('2026-05-21T10:00:00Z');
  const next = startSession(baseJob(), 'tech1', now);
  check('first session: timeSessions has 1 entry', next.timeSessions?.length === 1);
  check('entry has startAt now', next.timeSessions?.[0].startAt === '2026-05-21T10:00:00.000Z');
  check('entry has byUid', next.timeSessions?.[0].byUid === 'tech1');
  check('entry endAt undefined (open)', next.timeSessions?.[0].endAt === undefined);
}
{
  const job = baseJob({
    timeSessions: [{ startAt: '2026-05-21T08:00:00Z', endAt: '2026-05-21T09:00:00Z', byUid: 'tech1' }],
  });
  const now = new Date('2026-05-21T10:00:00Z');
  const next = startSession(job, 'tech1', now);
  check('appends to existing: 2 entries', next.timeSessions?.length === 2);
  check('first entry preserved', next.timeSessions?.[0].endAt === '2026-05-21T09:00:00Z');
  check('input not mutated', job.timeSessions?.length === 1);
}

console.log('\n┌─ stopActiveSession ───────────────────────────────');
{
  const job = baseJob();
  const next = stopActiveSession(job);
  check('no sessions → returns same job', next === job);
}
{
  const job = baseJob({
    timeSessions: [{ startAt: '2026-05-21T08:00:00Z', endAt: '2026-05-21T09:00:00Z', byUid: 'tech1' }],
  });
  const next = stopActiveSession(job);
  check('no open sessions → returns same job', next === job);
}
{
  const job = baseJob({
    timeSessions: [{ startAt: '2026-05-21T08:00:00Z', byUid: 'tech1' }],
  });
  const now = new Date('2026-05-21T09:30:00Z');
  const next = stopActiveSession(job, now);
  check('open session: endAt stamped',
    next.timeSessions?.[0].endAt === '2026-05-21T09:30:00.000Z');
  check('input not mutated',
    job.timeSessions?.[0].endAt === undefined);
}
{
  const job = baseJob({
    timeSessions: [
      { startAt: '2026-05-21T08:00:00Z', endAt: '2026-05-21T09:00:00Z', byUid: 'tech1' },
      { startAt: '2026-05-21T10:00:00Z', byUid: 'tech1' },
    ],
  });
  const now = new Date('2026-05-21T11:00:00Z');
  const next = stopActiveSession(job, now);
  check('mixed: only the open session is stamped',
    next.timeSessions?.[0].endAt === '2026-05-21T09:00:00Z' &&
    next.timeSessions?.[1].endAt === '2026-05-21T11:00:00.000Z');
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
