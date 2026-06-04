// ═══════════════════════════════════════════════════════════════════
//  tests/customerInsights.test.ts
//  Spec: §"VIP tier derivation" and §"customerStatus derivation"
// ═══════════════════════════════════════════════════════════════════
import { deriveVipTier, deriveCustomerStatus } from '@/lib/customerInsights';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

console.log('\n┌─ deriveVipTier ─────────────────────────────────');
check('0 → Standard', deriveVipTier(0) === 'Standard');
check('999 → Standard', deriveVipTier(999) === 'Standard');
check('1000 → Gold (boundary)', deriveVipTier(1000) === 'Gold');
check('1500 → Gold', deriveVipTier(1500) === 'Gold');
check('2499 → Gold (boundary minus 1)', deriveVipTier(2499) === 'Gold');
check('2500 → Platinum (boundary)', deriveVipTier(2500) === 'Platinum');
check('5000 → Platinum', deriveVipTier(5000) === 'Platinum');
check('negative → Standard (defensive)', deriveVipTier(-10) === 'Standard');

console.log('\n┌─ deriveCustomerStatus ──────────────────────────');
const recentIso = new Date().toISOString();
const oldIso = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(); // ~13 months ago
check('no lastJobAt → Active (new customer)', deriveCustomerStatus({ lastJobAt: undefined }) === 'Active');
check('recent lastJobAt → Active', deriveCustomerStatus({ lastJobAt: recentIso }) === 'Active');
check('13-month-old lastJobAt → Inactive', deriveCustomerStatus({ lastJobAt: oldIso }) === 'Inactive');
check('garbage lastJobAt → Active (lenient)', deriveCustomerStatus({ lastJobAt: 'nonsense' }) === 'Active');

console.log('\n══════════════════════════════════════════════════');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
