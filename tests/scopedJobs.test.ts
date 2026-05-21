// tests/scopedJobs.test.ts
// Run: npx tsx tests/scopedJobs.test.ts

import { scopeJobsByRole } from '@/lib/jobPermissions';
import type { Job } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};
const j = (over: Partial<Job> = {}): Job => ({
  id: 'j', date: '2026-05-21', service: 'Repair', vehicleType: 'Car',
  area: '', payment: 'Cash', status: 'Completed', source: 'Google',
  customerName: '', customerPhone: '', tireSize: '', qty: 1,
  revenue: 0, tireCost: 0, materialCost: 0, miles: 0, note: '',
  emergency: false, lateNight: false, highway: false, weekend: false,
  tireSource: 'Inventory', inventoryDeductions: null, paymentStatus: 'Paid',
  invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
  ...over,
} as Job);

const jobs: Job[] = [
  j({ id: 'a', assignedToUid: 'tech1', createdByUid: 'owner' }),
  j({ id: 'b', assignedToUid: 'tech2', createdByUid: 'owner' }),
  j({ id: 'c', assignedToUid: undefined, createdByUid: 'tech1' }),
  j({ id: 'd', assignedToUid: 'tech1', createdByUid: 'tech1' }),
  j({ id: 'e', assignedToUid: undefined, createdByUid: 'owner' }),
];

console.log('\n┌─ scopeJobsByRole ─────────────────────────────────');
check('owner sees all 5', scopeJobsByRole(jobs, 'owner', 'owner').length === 5);
check('admin sees all 5', scopeJobsByRole(jobs, 'admin', 'admin').length === 5);
check('tech1 sees a + c + d (3 jobs: 1 assigned, 1 created, 1 both)',
  scopeJobsByRole(jobs, 'technician', 'tech1').length === 3);
check('tech2 sees b only (1 assigned)',
  scopeJobsByRole(jobs, 'technician', 'tech2').length === 1);
check('tech with no jobs sees empty',
  scopeJobsByRole(jobs, 'technician', 'tech-nobody').length === 0);
check('null role → empty (defensive)',
  scopeJobsByRole(jobs, null, 'tech1').length === 0);
check('undefined role → empty (defensive)',
  scopeJobsByRole(jobs, undefined, 'tech1').length === 0);
check('tech with null uid → empty',
  scopeJobsByRole(jobs, 'technician', null).length === 0);
check('tech with empty-string uid → empty',
  scopeJobsByRole(jobs, 'technician', '').length === 0);
check('owner returns a NEW array (not same reference)',
  scopeJobsByRole(jobs, 'owner', 'owner') !== jobs);
check('owner clone preserves order',
  scopeJobsByRole(jobs, 'owner', 'owner')[0].id === 'a');
check('empty input → empty output for any role',
  scopeJobsByRole([], 'owner', 'owner').length === 0);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
