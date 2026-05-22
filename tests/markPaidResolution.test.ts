// tests/markPaidResolution.test.ts
// Run: npx tsx tests/markPaidResolution.test.ts
//
// Pins the Mark Paid → "Paid" resolution contract.
//
// Bug: resolvePaymentStatus returns 'Pending Payment' for ANY job
// whose status === 'Pending', ignoring paymentStatus entirely. So
// marking a Pending job paid by only setting paymentStatus:'Paid'
// left the pill stuck on "Pending Payment" — Mark Paid appeared to
// do nothing. The fix: handleMarkPaid also flips status →
// 'Completed'. These tests encode exactly that: the field shape
// handleMarkPaid must produce for the pill to read 'Paid'.

import { resolvePaymentStatus } from '@/lib/utils';
import type { Job } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

function mkJob(over: Partial<Job>): Job {
  return {
    id: 'j', date: '2026-05-22', service: 'X', vehicleType: 'Sedan',
    area: '', payment: 'Cash', status: 'Completed', source: '',
    customerName: '', customerPhone: '',
    tireSize: '', qty: 0,
    revenue: 200, tireCost: 0, materialCost: 0, miscCost: 0, miles: 0,
    note: '', emergency: false, lateNight: false, highway: false, weekend: false,
    tireSource: 'Inventory',
    paymentStatus: 'Paid',
    invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
    city: '', state: '', fullLocationLabel: '',
    ...over,
  } as Job;
}

console.log('\n┌─ The bug: Pending status masks Paid ──────────────');
{
  // A Pending job with paymentStatus flipped to 'Paid' but status
  // left as 'Pending' — what the OLD handleMarkPaid produced.
  const halfMarked = mkJob({ status: 'Pending', paymentStatus: 'Paid' });
  check('Pending status overrides Paid → still resolves Pending Payment',
    resolvePaymentStatus(halfMarked) === 'Pending Payment');
  // ^ This is WHY paymentStatus alone was not enough.
}

console.log('\n┌─ The fix: Mark Paid flips status too ─────────────');
{
  // What the FIXED handleMarkPaid produces: status Completed +
  // paymentStatus Paid.
  const marked = mkJob({ status: 'Completed', paymentStatus: 'Paid' });
  check('Completed + Paid → resolves Paid',
    resolvePaymentStatus(marked) === 'Paid');
}

console.log('\n┌─ Pending job lifecycle through Mark Paid ─────────');
{
  // Before: a job logged with status Pending.
  const before = mkJob({ status: 'Pending', paymentStatus: 'Pending Payment' });
  check('freshly-logged pending job resolves Pending Payment',
    resolvePaymentStatus(before) === 'Pending Payment');

  // handleMarkPaid's exact transform: {...j, status:'Completed',
  // paymentStatus:'Paid', paidAt, paymentMethod}.
  const after: Job = {
    ...before,
    status: 'Completed',
    paymentStatus: 'Paid',
    paidAt: '2026-05-22T15:00:00Z',
    paymentMethod: 'cash',
  };
  check('after Mark Paid → resolves Paid',
    resolvePaymentStatus(after) === 'Paid');
  check('JobDetailModal Mark Paid button hides (ps === Paid)',
    resolvePaymentStatus(after) === 'Paid');
}

console.log('\n┌─ Partial payment + Cancelled still correct ───────');
{
  check('Pending + Partial Payment → Partial Payment',
    resolvePaymentStatus(mkJob({ status: 'Pending', paymentStatus: 'Partial Payment' })) === 'Partial Payment');
  check('Cancelled job → Cancelled regardless of paymentStatus',
    resolvePaymentStatus(mkJob({ status: 'Cancelled', paymentStatus: 'Paid' })) === 'Cancelled');
  check('Completed job with no paymentStatus → defaults Paid',
    resolvePaymentStatus(mkJob({ status: 'Completed', paymentStatus: undefined as unknown as Job['paymentStatus'] })) === 'Paid');
}

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
