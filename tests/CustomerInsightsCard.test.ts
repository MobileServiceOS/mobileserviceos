// ═══════════════════════════════════════════════════════════════════
//  tests/CustomerInsightsCard.test.ts
//  Run: npx tsx tests/CustomerInsightsCard.test.ts
// ═══════════════════════════════════════════════════════════════════
import { __pureHooks } from '@/components/customers/CustomerInsightsCard';

let passed = 0; let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const { deriveMetrics, shouldRecomputeClientSide } = __pureHooks;

console.log('\n┌─ deriveMetrics: empty jobs ──────────────────────');
{
  const m = deriveMetrics({ jobs: [], canViewFinancials: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customer: { id: 'p_1', name: 'X' } as any });
  check('lifetimeRevenue 0', m.lifetimeRevenue === 0);
  check('totalJobs 0', m.totalJobs === 0);
  check('averageTicket null', m.averageTicket === null);
  check('mostCommonVehicle null', m.mostCommonVehicle === null);
}

console.log('\n┌─ deriveMetrics: typical customer ────────────────');
{
  const jobs = [
    { id: 'j1', revenue: 480, vehicleMakeModel: 'Honda Civic', tireSize: '215/55R17', service: 'tire_swap', date: '2026-05-30' },
    { id: 'j2', revenue: 200, vehicleMakeModel: 'Honda Civic', tireSize: '215/55R17', service: 'rotation',  date: '2026-04-10' },
    { id: 'j3', revenue: 1200, vehicleMakeModel: 'Tesla Model 3', tireSize: '235/45R18', service: 'tire_swap', date: '2026-03-01' },
  ];
  const m = deriveMetrics({ jobs, canViewFinancials: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customer: { id: 'p_1', name: 'M' } as any });
  check('lifetimeRevenue summed', m.lifetimeRevenue === 1880);
  check('totalJobs 3', m.totalJobs === 3);
  check('averageTicket', m.averageTicket !== null && Math.abs(m.averageTicket - 626.67) < 0.5);
  check('mostCommonVehicle = Honda Civic', m.mostCommonVehicle === 'Honda Civic');
  check('mostCommonTireSize = 215/55R17', m.mostCommonTireSize === '215/55R17');
  check('mostCommonServiceType = tire_swap', m.mostCommonServiceType === 'tire_swap');
  check('vipTier = Gold (≥$1000)', m.vipTier === 'Gold');
  check('vipProgress = Platinum in $620', m.vipProgress.nextTier === 'Platinum' && m.vipProgress.remaining === 620);
}

console.log('\n┌─ deriveMetrics: financials gated ────────────────');
{
  const jobs = [{ id: 'j1', revenue: 1000 }];
  const m = deriveMetrics({ jobs, canViewFinancials: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customer: { id: 'p_1', name: 'X' } as any });
  check('lifetimeRevenue hidden = 0', m.lifetimeRevenue === 0);
  check('averageTicket hidden = null', m.averageTicket === null);
  check('totalJobs still 1', m.totalJobs === 1);
}

console.log('\n┌─ shouldRecomputeClientSide ──────────────────────');
check('stale rollup', shouldRecomputeClientSide({
  lastJobAt: '2026-06-03T12:00:31Z',
  updatedAt: '2026-06-03T12:00:00Z',
}) === true);
check('fresh rollup', shouldRecomputeClientSide({
  lastJobAt: '2026-06-03T12:00:10Z',
  updatedAt: '2026-06-03T12:00:00Z',
}) === false);
check('missing updatedAt forces recompute',
  shouldRecomputeClientSide({ lastJobAt: '2026-06-03T12:00:00Z' }) === true);
check('missing lastJobAt is fresh',
  shouldRecomputeClientSide({ updatedAt: '2026-06-03T12:00:00Z' }) === false);

console.log('\n══════════════════════════════════════════════════');
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
