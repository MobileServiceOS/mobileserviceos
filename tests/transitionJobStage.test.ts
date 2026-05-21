// tests/transitionJobStage.test.ts
// Run: npx tsx tests/transitionJobStage.test.ts

import { transitionJobStage } from '@/lib/jobLifecycle';
import { resolveLifecycle } from '@/config/jobs';
import type { Job, Settings } from '@/types';
import type { BusinessTypeConfig } from '@/config/businessTypes/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const stubVertical = (key: 'tire' | 'mechanic' | 'detailing'): BusinessTypeConfig => ({
  key, displayName: 'stub', shortName: 'stub',
  pricingModel: { kind: 'flat' },
  services: [], jobFields: [], inventoryFields: [],
  copy: { jobNounSingular: 'job', jobNounPlural: 'jobs', emptyJobsHint: '', inventoryLabel: '' },
  defaultExpenseCategories: [],
  features: { inventoryDeduction: false, photoCapture: false, vehicleDiagnostics: false, vehicleSizeMultiplier: false, roadsideAddons: false },
  invoiceTemplateKey: key, dashboardMetrics: [],
  lifecycle: key === 'mechanic' ? {
    substages: [
      { id: 'mechanic.parts_on_order', parentStage: 'waiting_parts', label: 'Parts on order', technicianVisible: true, customerVisible: true },
    ],
  } : undefined,
}) as BusinessTypeConfig;

const resolved = resolveLifecycle(stubVertical('mechanic'));
const settings = {} as Settings;

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

console.log('\n┌─ transitionJobStage ──────────────────────────────');

// Recommended transition: scheduled → dispatched
{
  const job = baseJob({ lifecycleStage: 'scheduled' });
  const next = transitionJobStage({
    job, toStage: 'dispatched', byUid: 'owner', resolved, settings,
  });
  check('stamps lifecycleStage', next.lifecycleStage === 'dispatched');
  check('appends transition entry', next.transitions?.length === 1);
  check('entry has fromStage', next.transitions?.[0].fromStage === 'scheduled');
  check('entry has byUid', next.transitions?.[0].byUid === 'owner');
  check('recommended transition: no outOfFlow flag',
    next.transitions?.[0].outOfFlow === undefined);
  check('updates lastEditedAt', !!next.lastEditedAt);
}

// Out-of-flow: lead → in_progress (skipping multiple stages)
{
  const job = baseJob({ lifecycleStage: 'lead' });
  const next = transitionJobStage({
    job, toStage: 'in_progress', byUid: 'owner', resolved, settings,
  });
  check('out-of-flow: outOfFlow=true on entry',
    next.transitions?.[0].outOfFlow === true);
  check('out-of-flow: still applies the transition',
    next.lifecycleStage === 'in_progress');
}

// Substage included
{
  const job = baseJob({ lifecycleStage: 'in_progress' });
  const next = transitionJobStage({
    job, toStage: 'waiting_parts', toSubstage: 'mechanic.parts_on_order',
    byUid: 'tech', resolved, settings,
  });
  check('stamps lifecycleSubstage',
    next.lifecycleSubstage === 'mechanic.parts_on_order');
  check('entry has toSubstage',
    next.transitions?.[0].toSubstage === 'mechanic.parts_on_order');
}

// Legacy dual-write: paid stamps Completed + Paid + invoiceGenerated
{
  const job = baseJob({ lifecycleStage: 'completed' });
  const next = transitionJobStage({
    job, toStage: 'paid', byUid: 'owner', resolved, settings,
  });
  check('paid: status=Completed', next.status === 'Completed');
  check('paid: paymentStatus=Paid', next.paymentStatus === 'Paid');
  check('paid: invoiceGenerated=true', next.invoiceGenerated === true);
}

// Legacy dual-write: invoiced does NOT auto-stamp paymentStatus
{
  const job = baseJob({
    lifecycleStage: 'completed',
    paymentStatus: 'Pending Payment',
    invoiceGenerated: false,
  });
  const next = transitionJobStage({
    job, toStage: 'invoiced', byUid: 'owner', resolved, settings,
  });
  check('invoiced: status=Completed', next.status === 'Completed');
  check('invoiced: invoiceGenerated=true', next.invoiceGenerated === true);
  check('invoiced: preserves prior paymentStatus',
    next.paymentStatus === 'Pending Payment');
}

// Legacy dual-write: canceled
{
  const job = baseJob({ lifecycleStage: 'in_progress' });
  const next = transitionJobStage({
    job, toStage: 'canceled', byUid: 'owner', resolved, settings,
  });
  check('canceled: status=Cancelled', next.status === 'Cancelled');
}

// Multi-transition chain accumulates
{
  let job = baseJob({ lifecycleStage: 'scheduled' });
  job = transitionJobStage({ job, toStage: 'dispatched', byUid: 'owner', resolved, settings });
  job = transitionJobStage({ job, toStage: 'enroute', byUid: 'tech', resolved, settings });
  job = transitionJobStage({ job, toStage: 'onsite', byUid: 'tech', resolved, settings });
  check('three sequential transitions: 3 entries',
    job.transitions?.length === 3);
  check('chain preserves order: first is dispatched',
    job.transitions?.[0].toStage === 'dispatched');
  check('chain preserves order: last is onsite',
    job.transitions?.[2].toStage === 'onsite');
}

// Derives fromStage when lifecycleStage is undefined (legacy job)
{
  const job = baseJob({
    status: 'Completed', paymentStatus: 'Paid', invoiceGenerated: true,
    lifecycleStage: undefined,
  });
  const next = transitionJobStage({
    job, toStage: 'paid', byUid: 'owner', resolved, settings,
  });
  // deriveLifecycleStage on this legacy job → 'paid' (Completed + Paid)
  check('legacy job: derives fromStage via deriveLifecycleStage',
    next.transitions?.[0].fromStage === 'paid');
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
