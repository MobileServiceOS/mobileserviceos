// ═══════════════════════════════════════════════════════════════════
//  tests/customerEntity.test.ts — upsertCustomerFromJob behaviour
//  Run: npx tsx tests/customerEntity.test.ts
//
//  These tests use a tiny in-memory Firestore shim so we can verify
//  the transactional read-then-write logic without booting the
//  emulator. The shim implements just enough to satisfy our usage:
//  runTransaction(tx => ...) where tx exposes get/set/update, plus
//  FieldValue.increment + FieldValue.arrayUnion as sentinel objects
//  the shim recognises on set/update.
// ═══════════════════════════════════════════════════════════════════
import { __testHooks } from '@/lib/customerEntity';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const { runUpsertWithShim } = __testHooks;

function makeJob(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'job-1',
    date: '2026-05-30',
    customerName: 'Maria Lopez',
    customerPhone: '(305) 897-7030',
    customerEmail: 'maria@example.com',
    city: 'Miami',
    state: 'FL',
    vehicleType: 'Car',
    vehicleMakeModel: 'Honda Civic',
    tireSize: '215/55R17',
    revenue: 450,
    ...over,
  };
}

console.log('\n┌─ first-time upsert ─────────────────────────────');
{
  const store = new Map<string, Record<string, unknown>>();
  const res = runUpsertWithShim(store, 'biz-1', makeJob());
  const c = store.get('businesses/biz-1/customers/p_13058977030') as Record<string, unknown>;
  check('writes customer at canonical p_<11-digit> path', !!c);
  check('phoneKey set to 11-digit digits', c?.phoneKey === '13058977030');
  check('phoneE164 set', c?.phoneE164 === '+13058977030');
  check('firstJobAt set to job.date', c?.firstJobAt === '2026-05-30');
  check('lastJobAt set to job.date', c?.lastJobAt === '2026-05-30');
  check('jobCount === 1', c?.jobCount === 1);
  check('kind defaults to individual', c?.kind === 'individual');
  check('lifetimeRevenue === 450', c?.lifetimeRevenue === 450);
  check('processedJobIds includes job-1', Array.isArray(c?.processedJobIds) && (c?.processedJobIds as string[]).includes('job-1'));
  check('returns customerId', res.customerId === 'p_13058977030');
  check('returns vehicleId', typeof res.vehicleId === 'string' && (res.vehicleId as string).length > 0);
}

console.log('\n┌─ second job is non-idempotent (different jobId) ──');
{
  const store = new Map<string, Record<string, unknown>>();
  runUpsertWithShim(store, 'biz-1', makeJob({ id: 'job-1', date: '2026-05-10', revenue: 200 }));
  runUpsertWithShim(store, 'biz-1', makeJob({ id: 'job-2', date: '2026-05-30', revenue: 300 }));
  const c = store.get('businesses/biz-1/customers/p_13058977030') as Record<string, unknown>;
  check('jobCount incremented to 2', c?.jobCount === 2);
  check('firstJobAt preserved (set-if-absent)', c?.firstJobAt === '2026-05-10');
  check('lastJobAt = max of dates', c?.lastJobAt === '2026-05-30');
  check('lifetimeRevenue summed to 500', c?.lifetimeRevenue === 500);
  check('averageTicket = 500/2 = 250', c?.averageTicket === 250);
}

console.log('\n┌─ repeated upsert of same job is idempotent ─────');
{
  const store = new Map<string, Record<string, unknown>>();
  runUpsertWithShim(store, 'biz-1', makeJob({ id: 'job-1', revenue: 400 }));
  runUpsertWithShim(store, 'biz-1', makeJob({ id: 'job-1', revenue: 400 }));
  const c = store.get('businesses/biz-1/customers/p_13058977030') as Record<string, unknown>;
  check('jobCount stays at 1 on duplicate', c?.jobCount === 1);
  check('lifetimeRevenue stays at 400 on duplicate', c?.lifetimeRevenue === 400);
}

console.log('\n┌─ invalid phone is skipped, name fallback used ──');
{
  const store = new Map<string, Record<string, unknown>>();
  const res = runUpsertWithShim(store, 'biz-1', makeJob({ customerPhone: '911', customerName: 'Walk In' }));
  check('falls back to n_<slug> ID', res.customerId === 'n_walk-in');
  const c = store.get('businesses/biz-1/customers/n_walk-in') as Record<string, unknown>;
  check('no phoneKey written when phone invalid', c?.phoneKey === undefined);
  check('no phoneE164 written when phone invalid', c?.phoneE164 === undefined);
}

console.log('\n┌─ totally unidentifiable job: throws ────────────');
{
  const store = new Map<string, Record<string, unknown>>();
  let threw = false;
  try { runUpsertWithShim(store, 'biz-1', makeJob({ customerPhone: '', customerName: '' })); } catch { threw = true; }
  check('throws when neither phone nor name resolvable', threw);
}

console.log('\n┌─ vehicle subdoc written + idempotent ───────────');
{
  const store = new Map<string, Record<string, unknown>>();
  runUpsertWithShim(store, 'biz-1', makeJob({ id: 'job-1' }));
  runUpsertWithShim(store, 'biz-1', makeJob({ id: 'job-2' }));
  // The vehicle path includes the slugged year-make-model-trim.
  // We don't pin the exact slug here — we just count vehicle docs
  // under the customer's vehicles/ subcollection.
  const vehicleKeys = Array.from(store.keys()).filter(k => k.startsWith('businesses/biz-1/customers/p_13058977030/vehicles/'));
  check('exactly one vehicle doc for same make/model', vehicleKeys.length === 1);
  const v = store.get(vehicleKeys[0]) as Record<string, unknown>;
  check('vehicle serviceCount = 2 after two distinct jobs', v?.serviceCount === 2);
}

console.log('\n┌─ SP2: email is persisted on Customer ───────────');
{
  const store = new Map<string, Record<string, unknown>>();
  runUpsertWithShim(store, 'biz-1', makeJob({ customerEmail: 'maria@example.com' }));
  const c = store.get('businesses/biz-1/customers/p_13058977030') as Record<string, unknown>;
  check('email persisted', c?.email === 'maria@example.com');
}

console.log('\n┌─ SP2: empty email does NOT clobber existing ───');
{
  const store = new Map<string, Record<string, unknown>>();
  runUpsertWithShim(store, 'biz-1', makeJob({ id: 'job-1', customerEmail: 'maria@example.com' }));
  runUpsertWithShim(store, 'biz-1', makeJob({ id: 'job-2', customerEmail: '' }));
  const c = store.get('businesses/biz-1/customers/p_13058977030') as Record<string, unknown>;
  check('email preserved on second job with blank email', c?.email === 'maria@example.com');
}

console.log('\n┌─ SP2: companyName + companyLower for fleet ────');
{
  const store = new Map<string, Record<string, unknown>>();
  runUpsertWithShim(store, 'biz-1', makeJob({ companyName: 'Uber Fleet LLC' }));
  const c = store.get('businesses/biz-1/customers/p_13058977030') as Record<string, unknown>;
  check('companyName persisted', c?.companyName === 'Uber Fleet LLC');
  check('companyLower derived', c?.companyLower === 'uber fleet llc');
}

console.log('\n┌─ SP2: empty companyName does NOT clobber ──────');
{
  const store = new Map<string, Record<string, unknown>>();
  runUpsertWithShim(store, 'biz-1', makeJob({ id: 'job-1', companyName: 'Uber Fleet LLC' }));
  runUpsertWithShim(store, 'biz-1', makeJob({ id: 'job-2', companyName: '' }));
  const c = store.get('businesses/biz-1/customers/p_13058977030') as Record<string, unknown>;
  check('companyName preserved on second job with blank companyName', c?.companyName === 'Uber Fleet LLC');
  check('companyLower preserved', c?.companyLower === 'uber fleet llc');
}

console.log('\n══════════════════════════════════════════════════');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
