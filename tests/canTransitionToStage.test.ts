// tests/canTransitionToStage.test.ts
// Run: npx tsx tests/canTransitionToStage.test.ts

import { canTransitionToStage } from '@/lib/jobPermissions';
import type { JobLifecycleStage } from '@/config/jobs/lifecycle';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const ALL_STAGES: JobLifecycleStage[] = [
  'lead', 'quoted', 'scheduled',
  'dispatched', 'enroute', 'onsite',
  'in_progress', 'waiting_parts', 'awaiting_approval',
  'completed', 'invoiced', 'paid', 'canceled',
];
const TECH_ALLOWED: JobLifecycleStage[] = [
  'dispatched', 'enroute', 'onsite',
  'in_progress', 'waiting_parts', 'awaiting_approval',
  'completed', 'paid',
];
const TECH_FORBIDDEN: JobLifecycleStage[] = [
  'lead', 'quoted', 'scheduled', 'invoiced', 'canceled',
];

console.log('\n┌─ canTransitionToStage ────────────────────────────');

for (const s of ALL_STAGES) {
  check(`owner → ${s}: allowed`, canTransitionToStage('owner', s) === true);
}
for (const s of ALL_STAGES) {
  check(`admin → ${s}: allowed`, canTransitionToStage('admin', s) === true);
}
for (const s of TECH_ALLOWED) {
  check(`tech → ${s}: allowed`, canTransitionToStage('technician', s) === true);
}
for (const s of TECH_FORBIDDEN) {
  check(`tech → ${s}: forbidden`, canTransitionToStage('technician', s) === false);
}

check('null role → in_progress: forbidden',
  canTransitionToStage(null, 'in_progress') === false);
check('undefined role → paid: forbidden',
  canTransitionToStage(undefined, 'paid') === false);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
