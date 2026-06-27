// ═══════════════════════════════════════════════════════════════════
//  tests/CustomerLookupCard.test.ts
//  Run: npx tsx tests/CustomerLookupCard.test.ts
//  Spec: §"AddJob Workflow Change → Returning Customer card spec"
// ═══════════════════════════════════════════════════════════════════
import { __pureHooks } from '@/components/addJob/CustomerLookupCard';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const { deriveCardState, deriveUseCustomerPatch, deriveRepeatLastServicePatch, deriveVehiclePatch } = __pureHooks;

console.log('\n┌─ deriveCardState ───────────────────────────────');
check('empty phone → idle',
  deriveCardState({ rawPhone: '', lookupInFlight: false, lookupResult: null, error: null }).kind === 'idle');
check('partial phone (still invalid) → idle',
  deriveCardState({ rawPhone: '305', lookupInFlight: false, lookupResult: null, error: null }).kind === 'idle');
check('valid phone + lookupInFlight → searching',
  deriveCardState({ rawPhone: '(305) 897-7030', lookupInFlight: true, lookupResult: null, error: null }).kind === 'searching');
check('valid phone + null result + no flight → miss',
  deriveCardState({ rawPhone: '(305) 555-0100', lookupInFlight: false, lookupResult: null, error: null }).kind === 'miss');
check('error → error',
  deriveCardState({ rawPhone: '(305) 897-7030', lookupInFlight: false, lookupResult: null, error: new Error('rules') }).kind === 'error');

{
  const lookupResult = {
    customer: { id: 'p_13058977030', name: 'Maria Lopez', phoneE164: '+13058977030', phoneKey: '13058977030', jobCount: 5, lifetimeRevenue: 1800 },
    vehicles: [{ id: 'honda-civic-2019', year: 2019, make: 'Honda', model: 'Civic', tireSize: '215/55R17' }],
    lastJob: { id: 'job-9', date: '2026-05-30', service: 'tire_swap', revenue: 450, paymentStatus: 'Paid' },
    lookupLatencyMs: 120,
  } as const;
  // Cast as the public LookupResult — the seed objects are partial but
  // the helper only reads the fields referenced in deriveCardState.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const state = deriveCardState({ rawPhone: '(305) 897-7030', lookupInFlight: false, lookupResult: lookupResult as any, error: null });
  check('hit → found', state.kind === 'found');
  if (state.kind === 'found') {
    check('found state carries customer', state.customer.id === 'p_13058977030');
    check('found state carries first vehicle', state.vehicles[0].make === 'Honda');
    check('found state carries lastJob', state.lastJob?.id === 'job-9');
  }
}

console.log('\n┌─ deriveUseCustomerPatch ────────────────────────');
{
  const customer = { id: 'p_13058977030', name: 'Maria Lopez', phoneE164: '+13058977030', email: 'maria@example.com', city: 'Miami', state: 'FL', addressLine: '123 Main', zipCode: '33101' };
  const vehicle = { id: 'honda-civic-2019', year: 2019, make: 'Honda', model: 'Civic', vehicleMakeModel: 'Honda Civic', tireSize: '215/55R17', vehicleType: 'Car' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch = deriveUseCustomerPatch(customer as any, vehicle as any);
  check('customerName from customer.name', patch.customerName === 'Maria Lopez');
  check('customerPhone as formatted display', patch.customerPhone === '(305) 897-7030');
  check('customerEmail copied', patch.customerEmail === 'maria@example.com');
  check('city copied', patch.city === 'Miami');
  check('state copied', patch.state === 'FL');
  check('addressLine copied', patch.addressLine === '123 Main');
  check('zipCode copied', patch.zipCode === '33101');
  check('vehicleType copied', patch.vehicleType === 'Car');
  check('vehicleMakeModel copied', patch.vehicleMakeModel === 'Honda Civic');
  check('tireSize copied', patch.tireSize === '215/55R17');
  check('does NOT copy revenue', !('revenue' in patch));
  check('does NOT copy materialCost', !('materialCost' in patch));
  check('does NOT copy note', !('note' in patch));
}

console.log('\n┌─ deriveRepeatLastServicePatch ──────────────────');
{
  const customer = { id: 'p_13058977030', name: 'Maria Lopez', phoneE164: '+13058977030', city: 'Miami', state: 'FL' };
  const vehicle = { id: 'honda-civic-2019', year: 2019, make: 'Honda', model: 'Civic', vehicleMakeModel: 'Honda Civic', tireSize: '215/55R17', vehicleType: 'Car' };
  const lastJob = { id: 'job-9', date: '2026-05-30', service: 'tire_swap', revenue: 450, vehicleMakeModel: 'Honda Civic', tireSize: '215/55R17', paymentStatus: 'Paid', city: 'Miami' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch = deriveRepeatLastServicePatch(customer as any, vehicle as any, lastJob as any);
  check('includes use-customer fields', patch.customerName === 'Maria Lopez');
  check('includes service from lastJob', patch.service === 'tire_swap');
  check('includes vehicleMakeModel from lastJob', patch.vehicleMakeModel === 'Honda Civic');
  check('includes tireSize from lastJob', patch.tireSize === '215/55R17');
  // One-tap pricing (2026-06-08): the repeat patch now CARRIES the last
  // job's sell price so a returning customer's price is a tap, not a
  // re-type. It stays editable + the live-quote divergence hint catches
  // a stale price.
  check('copies revenue from lastJob (one-tap pricing)', patch.revenue === 450);
  check('does NOT copy paymentStatus from lastJob', !('paymentStatus' in patch));
  check('does NOT copy note from lastJob', !('note' in patch));
  // Guard: a zero / missing last revenue must NOT seed a $0 price.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const zeroPatch = deriveRepeatLastServicePatch(customer as any, vehicle as any, { ...lastJob, revenue: 0 } as any);
  check('zero last revenue is not carried', !('revenue' in zeroPatch));
}

console.log('\n┌─ deriveVehiclePatch (tap a saved car → its size) ──');
{
  const vehicle = { id: 'truck-f150', year: 2021, make: 'Ford', model: 'F-150', vehicleMakeModel: 'Ford F-150', tireSize: '275/65R18', vehicleType: 'Truck' };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch = deriveVehiclePatch(vehicle as any);
  check('switches tireSize to the tapped vehicle', patch.tireSize === '275/65R18');
  check('switches vehicleType', patch.vehicleType === 'Truck');
  check('switches vehicleMakeModel', patch.vehicleMakeModel === 'Ford F-150');
  check('carries vehicleId', patch.vehicleId === 'truck-f150');
  // Vehicle-only patch: must NOT touch customer identity / pricing / notes,
  // so tapping a car never clobbers what the operator already entered.
  check('does NOT include customerName', !('customerName' in patch));
  check('does NOT include customerPhone', !('customerPhone' in patch));
  check('does NOT include revenue', !('revenue' in patch));
  check('does NOT include note', !('note' in patch));
  // Falls back to make+model when no precomposed makeModel is stored.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p2 = deriveVehiclePatch({ id: 'v2', make: 'Honda', model: 'Civic', tireSize: '215/55R17' } as any);
  check('composes makeModel from make+model', p2.vehicleMakeModel === 'Honda Civic');
}

console.log('\n══════════════════════════════════════════════════');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
