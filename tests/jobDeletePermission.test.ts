// tests/jobDeletePermission.test.ts
// Run: npx tsx tests/jobDeletePermission.test.ts

import { canDeleteJob } from '@/lib/jobPermissions';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

console.log('\n┌─ canDeleteJob ────────────────────────────────────');
check('owner can delete', canDeleteJob('owner') === true);
check('admin can delete', canDeleteJob('admin') === true);
check('technician cannot delete', canDeleteJob('technician') === false);
check('null role cannot delete', canDeleteJob(null) === false);
check('undefined role cannot delete', canDeleteJob(undefined) === false);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
