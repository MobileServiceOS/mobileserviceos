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

const { deriveCardState, deriveUseCustomerPatch, deriveRepeatLastServicePatch } = __pureHooks;

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
  check('does NOT copy revenue from lastJob', !('revenue' in patch));
  check('does NOT copy paymentStatus from lastJob', !('paymentStatus' in patch));
  check('does NOT copy note from lastJob', !('note' in patch));
}

console.log('\n══════════════════════════════════════════════════');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
