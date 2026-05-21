// tests/paymentRoundTrip.test.ts
// Run: npx tsx tests/paymentRoundTrip.test.ts
//
// Two production bugs this pins:
//
// 1. JobDetailModal renders a "Paid via {paymentMethod} · {paidAt}"
//    block. invoice.ts renders the same line in the PDF. Both depend
//    on deserializeJob preserving paidAt and paymentMethod across a
//    Firestore read. Before the fix, the deserializer had no
//    mappings for either field — so even when something wrote them
//    to Firestore, every subsequent read returned undefined and
//    these UI elements silently never appeared.
//
// 2. handleMarkPaid (App.tsx) only flipped paymentStatus and never
//    stamped paidAt. The "Paid · timestamp" UI shipped, but the
//    timestamp it tried to render was never set. The fix in
//    App.tsx writes paidAt on every Mark Paid. We can't unit-test
//    App.tsx (React + Firebase), but the deserializer round-trip
//    here proves that once paidAt is written it survives the read.

import { deserializeJob } from '@/lib/deserializers';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const baseRaw: Record<string, unknown> = {
  id: 'job-1',
  date: '2026-05-21',
  service: 'Flat Tire Repair',
  vehicleType: 'Sedan',
  area: 'Tampa',
  payment: 'Cash',
  status: 'Completed',
  source: 'Direct',
  customerName: 'Test',
  customerPhone: '5555555555',
  tireSize: '',
  qty: 1,
  revenue: 150,
  tireCost: 0,
  materialCost: 0,
  miscCost: 0,
  miles: 5,
  note: '',
  emergency: false,
  lateNight: false,
  highway: false,
  weekend: false,
  tireSource: 'Inventory',
  paymentStatus: 'Paid',
  invoiceGenerated: false,
  invoiceSent: false,
  reviewRequested: false,
};

console.log('\n┌─ paidAt round-trip ───────────────────────────────');
{
  const raw = { ...baseRaw, paidAt: '2026-05-21T17:30:00.000Z' };
  const job = deserializeJob(raw);
  check('paidAt preserved as ISO string',
    job.paidAt === '2026-05-21T17:30:00.000Z');
  check('paidAt is a non-empty string',
    typeof job.paidAt === 'string' && job.paidAt.length > 0);
}
{
  const raw = { ...baseRaw }; // no paidAt
  const job = deserializeJob(raw);
  check('missing paidAt → undefined (not empty string)',
    job.paidAt === undefined);
}
{
  const raw = { ...baseRaw, paidAt: null };
  const job = deserializeJob(raw);
  check('null paidAt → undefined',
    job.paidAt === undefined);
}

console.log('\n┌─ paymentMethod round-trip ────────────────────────');
{
  const raw = { ...baseRaw, paymentMethod: 'card' };
  const job = deserializeJob(raw);
  check("paymentMethod 'card' preserved",
    job.paymentMethod === 'card');
}
{
  const raw = { ...baseRaw, paymentMethod: 'zelle' };
  const job = deserializeJob(raw);
  check("paymentMethod 'zelle' preserved",
    job.paymentMethod === 'zelle');
}
{
  const raw = { ...baseRaw, paymentMethod: 'apple_pay' };
  const job = deserializeJob(raw);
  check("paymentMethod 'apple_pay' preserved",
    job.paymentMethod === 'apple_pay');
}
{
  const raw = { ...baseRaw, paymentMethod: 'bitcoin' };
  const job = deserializeJob(raw);
  // Unknown enum value falls back to 'other' rather than crashing
  // or leaking a garbage string into typed UI.
  check("unknown paymentMethod → 'other' fallback",
    job.paymentMethod === 'other');
}
{
  const raw = { ...baseRaw }; // no paymentMethod
  const job = deserializeJob(raw);
  check('missing paymentMethod → undefined',
    job.paymentMethod === undefined);
}
{
  const raw = { ...baseRaw, paymentMethod: null };
  const job = deserializeJob(raw);
  check('null paymentMethod → undefined',
    job.paymentMethod === undefined);
}

console.log('\n┌─ JobDetailModal render-guard invariant ───────────');
// JobDetailModal.tsx:120 — `ps === 'Paid' && job.paidAt && (...)`.
// The guard only triggers when paidAt is a truthy string. Test
// confirms the deserializer can produce that state from Firestore
// data. The bug was: deserializer STRIPPED paidAt → guard never
// fired → block never rendered → "Marked as paid" had no audit
// confirmation in the UI.
{
  const raw = { ...baseRaw, paidAt: '2026-05-21T17:30:00.000Z', paymentMethod: 'cash' };
  const job = deserializeJob(raw);
  check('paid job with method + timestamp passes render guard',
    job.paymentStatus === 'Paid' && !!job.paidAt && typeof job.paymentMethod === 'string');
}

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
