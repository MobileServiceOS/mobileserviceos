// tests/jobEditPermission.test.ts
// Run: npx tsx tests/jobEditPermission.test.ts

import { canEditJob } from '@/lib/jobPermissions';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

console.log('\n┌─ canEditJob ──────────────────────────────────────');
check('owner edits any job',
  canEditJob({ assignedToUid: 'x', createdByUid: 'y' }, 'owner', 'me') === true);
check('admin edits any job',
  canEditJob({ assignedToUid: 'x', createdByUid: 'y' }, 'admin', 'me') === true);
check('tech edits job assigned to them',
  canEditJob({ assignedToUid: 'me', createdByUid: 'someone' }, 'technician', 'me') === true);
check('tech edits job they created',
  canEditJob({ assignedToUid: 'someone', createdByUid: 'me' }, 'technician', 'me') === true);
check('tech edits job assigned AND created by them',
  canEditJob({ assignedToUid: 'me', createdByUid: 'me' }, 'technician', 'me') === true);
check('tech CANNOT edit a stranger\'s job',
  canEditJob({ assignedToUid: 'them', createdByUid: 'them' }, 'technician', 'me') === false);
check('tech CANNOT edit unassigned job they didn\'t create',
  canEditJob({ assignedToUid: undefined, createdByUid: 'them' }, 'technician', 'me') === false);
check('tech without uid cannot edit (defensive)',
  canEditJob({ assignedToUid: 'me', createdByUid: 'me' }, 'technician', null) === false);
check('null role cannot edit',
  canEditJob({ assignedToUid: 'me', createdByUid: 'me' }, null, 'me') === false);
check('undefined role cannot edit',
  canEditJob({ assignedToUid: 'me', createdByUid: 'me' }, undefined, 'me') === false);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
