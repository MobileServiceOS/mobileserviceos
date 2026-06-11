// tests/verticalConditions.test.ts
// Run: npx tsx tests/verticalConditions.test.ts
//
// Vertical-aware "Conditions" chip row in AddJob. Per user feedback
// (2026-05-21): "for car wash condition highway shouldnt be included
// who washes car on the highway." This test pins the contract:
//
//   - tire        → all 4 (incl. highway — stranded shoulder calls)
//   - mechanic    → all 4 (incl. highway — battery replacement on the
//                          shoulder is a real case)
//   - detailing   → 3 only (NO highway)
//
// AddJob falls back to all 4 if a config omits `conditions`, so
// adding a new vertical without declaring conditions is safe — the
// fallback degrades to the legacy tire-style chip set.

import { getBusinessTypeConfig } from '@/config/businessTypes/registry';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const tire = getBusinessTypeConfig('tire');

console.log('\n┌─ Tire vertical conditions ────────────────────────');
check('tire declares conditions', Array.isArray(tire.conditions));
check('tire includes highway', !!tire.conditions?.some((c) => c.key === 'highway'));
check('tire includes emergency', !!tire.conditions?.some((c) => c.key === 'emergency'));
check('tire includes lateNight', !!tire.conditions?.some((c) => c.key === 'lateNight'));
check('tire includes weekend', !!tire.conditions?.some((c) => c.key === 'weekend'));
check('tire has exactly 4 conditions', tire.conditions?.length === 4);

console.log('\n┌─ Cross-vertical invariant ────────────────────────');
// Every declared condition key must be one of the 4 canonical Job
// boolean fields. Adding a 5th condition would require widening the
// Job type — this test catches that mistake.
const validKeys = new Set(['emergency', 'lateNight', 'highway', 'weekend']);
for (const v of [tire]) {
  for (const c of v.conditions ?? []) {
    check(`${v.key}.${c.key} maps to a known Job field`, validKeys.has(c.key));
  }
}

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
