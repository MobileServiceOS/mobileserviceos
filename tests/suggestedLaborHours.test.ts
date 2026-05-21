// tests/suggestedLaborHours.test.ts
// Run: npx tsx tests/suggestedLaborHours.test.ts

import { suggestedLaborHours } from '@/lib/jobTime';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const MIN = 60_000;

console.log('\n┌─ suggestedLaborHours ─────────────────────────────');
check('0 ms → 0', suggestedLaborHours(0) === 0);
check('negative → 0', suggestedLaborHours(-1) === 0);
check('1 ms → 0.25 (rounded up)', suggestedLaborHours(1) === 0.25);
check('14 min → 0.25', suggestedLaborHours(14 * MIN) === 0.25);
check('15 min → 0.25 (exact)', suggestedLaborHours(15 * MIN) === 0.25);
check('16 min → 0.5', suggestedLaborHours(16 * MIN) === 0.5);
check('29 min → 0.5', suggestedLaborHours(29 * MIN) === 0.5);
check('30 min → 0.5 (exact)', suggestedLaborHours(30 * MIN) === 0.5);
check('31 min → 0.75', suggestedLaborHours(31 * MIN) === 0.75);
check('45 min → 0.75 (exact)', suggestedLaborHours(45 * MIN) === 0.75);
check('59 min → 1.0', suggestedLaborHours(59 * MIN) === 1);
check('60 min (1h) → 1.0 (exact)', suggestedLaborHours(60 * MIN) === 1);
check('1h 1m → 1.25', suggestedLaborHours(61 * MIN) === 1.25);
check('2h 17m → 2.5', suggestedLaborHours((2 * 60 + 17) * MIN) === 2.5);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
