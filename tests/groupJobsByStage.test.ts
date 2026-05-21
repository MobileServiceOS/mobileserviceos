// tests/groupJobsByStage.test.ts
// Run: npx tsx tests/groupJobsByStage.test.ts

import { groupJobsByStage } from '@/lib/jobPermissions';
import { resolveLifecycle } from '@/config/jobs';
import type { Job } from '@/types';
import type { BusinessTypeConfig } from '@/config/businessTypes/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const tireVertical: BusinessTypeConfig = {
  key: 'tire', displayName: 'Tire', shortName: 'Tire',
  pricingModel: { kind: 'flat' },
  services: [], jobFields: [], inventoryFields: [],
  copy: { jobNounSingular: 'job', jobNounPlural: 'jobs', emptyJobsHint: '', inventoryLabel: '' },
  defaultExpenseCategories: [],
  features: { inventoryDeduction: true, photoCapture: false, vehicleDiagnostics: false, vehicleSizeMultiplier: false, roadsideAddons: true },
  invoiceTemplateKey: 'tire', dashboardMetrics: [],
};
const detailingVertical: BusinessTypeConfig = {
  ...tireVertical, key: 'detailing',
  lifecycle: {
    applicableStages: [
      'lead', 'quoted', 'scheduled', 'dispatched', 'enroute', 'onsite',
      'in_progress', 'awaiting_approval', 'completed', 'invoiced', 'paid', 'canceled',
    ],
  },
};

const baseJob = (over: Partial<Job> = {}): Job => ({
  id: 'j', date: '2026-05-21', service: 'Repair', vehicleType: 'Car',
  area: '', payment: 'Cash', status: 'Pending', source: 'Google',
  customerName: '', customerPhone: '', tireSize: '', qty: 1,
  revenue: 0, tireCost: 0, materialCost: 0, miles: 0, note: '',
  emergency: false, lateNight: false, highway: false, weekend: false,
  tireSource: 'Inventory', inventoryDeductions: null, paymentStatus: 'Paid',
  invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
  ...over,
} as Job);

console.log('\n┌─ groupJobsByStage ────────────────────────────────');
{
  const resolved = resolveLifecycle(tireVertical);
  const jobs: Job[] = [
    baseJob({ id: 'a', lifecycleStage: 'in_progress' }),
    baseJob({ id: 'b', lifecycleStage: 'in_progress' }),
    baseJob({ id: 'c', lifecycleStage: 'paid' }),
    baseJob({ id: 'd', status: 'Pending', lifecycleStage: undefined }),
    baseJob({ id: 'e', status: 'Completed', paymentStatus: 'Paid', lifecycleStage: undefined }),
  ];
  const groups = groupJobsByStage(jobs, resolved);
  check('returns 2 populated buckets (in_progress + paid)', groups.length === 2);
  check('in_progress bucket has 3 jobs (a, b, d)',
    groups.find((g) => g.stage.id === 'in_progress')?.jobs.length === 3);
  check('paid bucket has 2 jobs (c, e)',
    groups.find((g) => g.stage.id === 'paid')?.jobs.length === 2);
  check('canonical order: in_progress before paid',
    groups[0].stage.id === 'in_progress' && groups[1].stage.id === 'paid');
}
{
  const resolved = resolveLifecycle(detailingVertical);
  const jobs: Job[] = [
    baseJob({ id: 'a', lifecycleStage: 'waiting_parts' }),
    baseJob({ id: 'b', lifecycleStage: 'in_progress' }),
  ];
  const groups = groupJobsByStage(jobs, resolved);
  check('detailing: drops jobs in non-applicable stage (waiting_parts)',
    groups.length === 1 && groups[0].stage.id === 'in_progress');
}
{
  const resolved = resolveLifecycle(tireVertical);
  check('empty input → empty output',
    groupJobsByStage([], resolved).length === 0);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
