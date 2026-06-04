// ═══════════════════════════════════════════════════════════════════
//  tests/customerInsightsModes.test.ts — mode helpers + VIP progress
//  Run: npx tsx tests/customerInsightsModes.test.ts
// ═══════════════════════════════════════════════════════════════════
import {
  computeMostCommonVehicle,
  computeMostCommonTireSize,
  computeMostCommonServiceType,
  deriveVipProgress,
} from '@/lib/customerInsights';

let passed = 0; let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

type JobLite = { vehicleMakeModel?: string; tireSize?: string; service?: string };

console.log('\n┌─ computeMostCommonVehicle ──────────────────────');
check('returns null on empty', computeMostCommonVehicle([]) === null);
check('returns single', computeMostCommonVehicle([{ vehicleMakeModel: 'Honda Civic' }] as JobLite[]) === 'Honda Civic');
check('picks mode',
  computeMostCommonVehicle([
    { vehicleMakeModel: 'Honda Civic' },
    { vehicleMakeModel: 'Honda Civic' },
    { vehicleMakeModel: 'Tesla Model 3' },
  ] as JobLite[]) === 'Honda Civic');
check('skips blanks', computeMostCommonVehicle([
  { vehicleMakeModel: '' }, { vehicleMakeModel: undefined }, { vehicleMakeModel: 'Tesla Model 3' },
] as JobLite[]) === 'Tesla Model 3');

console.log('\n┌─ computeMostCommonTireSize ─────────────────────');
check('returns null on empty', computeMostCommonTireSize([]) === null);
check('picks mode', computeMostCommonTireSize([
  { tireSize: '215/55R17' }, { tireSize: '215/55R17' }, { tireSize: '235/45R18' },
] as JobLite[]) === '215/55R17');

console.log('\n┌─ computeMostCommonServiceType ──────────────────');
check('returns null on empty', computeMostCommonServiceType([]) === null);
check('picks mode', computeMostCommonServiceType([
  { service: 'tire_swap' }, { service: 'tire_swap' }, { service: 'rotation' },
] as JobLite[]) === 'tire_swap');

console.log('\n┌─ deriveVipProgress ─────────────────────────────');
check('$0 → Gold in $1000',  JSON.stringify(deriveVipProgress(0))    === JSON.stringify({ nextTier: 'Gold',     remaining: 1000 }));
check('$999 → Gold in $1',    JSON.stringify(deriveVipProgress(999))  === JSON.stringify({ nextTier: 'Gold',     remaining: 1 }));
check('$1000 → Platinum in $1500', JSON.stringify(deriveVipProgress(1000)) === JSON.stringify({ nextTier: 'Platinum', remaining: 1500 }));
check('$2499 → Platinum in $1',    JSON.stringify(deriveVipProgress(2499)) === JSON.stringify({ nextTier: 'Platinum', remaining: 1 }));
check('$2500 → top tier reached',  JSON.stringify(deriveVipProgress(2500)) === JSON.stringify({ nextTier: null,       remaining: 0 }));

console.log('\n══════════════════════════════════════════════════');
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
