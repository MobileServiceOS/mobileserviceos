// tests/technicianPermissions.test.ts
// Run: npx tsx tests/technicianPermissions.test.ts

import { getRolePermissions, getPermissions } from '@/lib/permissions';
import type { MemberDoc } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

console.log('\n┌─ technician role permissions ─────────────────────');
{
  const p = getRolePermissions('technician');
  check('canCreateJobs', p.canCreateJobs === true);
  check('canEditJobs', p.canEditJobs === true);
  check('canDeleteJobs', p.canDeleteJobs === false);
  check('canViewRevenue (must collect payment)', p.canViewRevenue === true);
  check('canViewProfit (hidden)', p.canViewProfit === false);
  check('canViewFinancials (hidden)', p.canViewFinancials === false);
  check('canManageInventory', p.canManageInventory === false);
  check('canManageExpenses', p.canManageExpenses === false);
  check('canEditBusinessSettings', p.canEditBusinessSettings === false);
  check('canManageTeam', p.canManageTeam === false);
  check('canGenerateInvoices', p.canGenerateInvoices === true);
  check('canSendReviews', p.canSendReviews === true);
}

console.log('\n┌─ owner role permissions (regression) ─────────────');
{
  const p = getRolePermissions('owner');
  check('owner: canViewProfit', p.canViewProfit === true);
  check('owner: canDeleteJobs', p.canDeleteJobs === true);
  check('owner: canManageBilling', p.canManageBilling === true);
  check('owner: canViewRevenue', p.canViewRevenue === true);
}

console.log('\n┌─ admin role permissions (regression) ─────────────');
{
  const p = getRolePermissions('admin');
  check('admin: canViewProfit', p.canViewProfit === true);
  check('admin: canDeleteJobs', p.canDeleteJobs === true);
  check('admin: canManageBilling (false)', p.canManageBilling === false);
  check('admin: canViewRevenue', p.canViewRevenue === true);
}

console.log('\n┌─ getPermissions integration ──────────────────────');
{
  const m: MemberDoc = {
    uid: 'u1', businessId: 'b1', role: 'technician', status: 'active',
  } as MemberDoc;
  const p = getPermissions(m, { plan: 'pro' });
  check('tech with pro plan: canViewRevenue still true', p.canViewRevenue === true);
  check('tech with pro plan: canViewAdvancedReports still false', p.canViewAdvancedReports === false);
  check('tech with pro plan: canManageTeam still false', p.canManageTeam === false);
}
{
  const m: MemberDoc = {
    uid: 'u1', businessId: 'b1', role: 'technician', status: 'disabled',
  } as MemberDoc;
  const p = getPermissions(m, { plan: 'pro' });
  check('disabled tech: ALL_FALSE (canViewRevenue false)', p.canViewRevenue === false);
  check('disabled tech: canCreateJobs false', p.canCreateJobs === false);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
