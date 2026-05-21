// ═══════════════════════════════════════════════════════════════════
//  tests/jobLifecycle.test.ts — Job lifecycle helper assertions
// ═══════════════════════════════════════════════════════════════════
//  Run: npx tsx tests/jobLifecycle.test.ts
//
//  Covers every invariant from
//  docs/superpowers/specs/2026-05-20-job-lifecycle-architecture-design.md
//  via the same lightweight check() runner the rest of the suite uses.
//
//  Why we build stub BusinessTypeConfig values here rather than
//  importing the real TIRE_CONFIG / MECHANIC_CONFIG / DETAILING_CONFIG:
//  the real configs pull `@/lib/utils → @/lib/verticalContext →
//  @/lib/verticals → @/config/businessTypes/registry`, and registry
//  imports back into the configs — a cycle the production bundler
//  resolves via live bindings but Node's strict ESM loader trips on.
//  The real configs' lifecycle shape is already type-checked by the
//  production build (`npm run build`), so the assertions here focus
//  on the resolver + helper behavior using minimal stubs that exercise
//  the same code paths a real config would.
//
//  When a formal runner (vitest) lands these assertions translate
//  one-for-one — keep predicates pure and self-describing.
// ═══════════════════════════════════════════════════════════════════

import {
  deriveLifecycleStage,
  legacyStatusFromStage,
  isRecommendedNext,
  appendTransition,
  getTransitionRetentionPolicy,
} from '@/lib/jobLifecycle';
import { resolveLifecycle, UNIVERSAL_STAGES } from '@/config/jobs';
import type { LifecycleTransition, LifecycleExtensions } from '@/config/jobs';
import type { Job, Settings } from '@/types';
import type { BusinessTypeConfig } from '@/config/businessTypes/types';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
  }
}

// ─── Minimal stub builders ──────────────────────────────────────────
// Just enough of BusinessTypeConfig to satisfy resolveLifecycle().
// resolveLifecycle reads only `vertical.key` and `vertical.lifecycle`
// — everything else is irrelevant to lifecycle resolution.
function stubVertical(
  key: 'tire' | 'mechanic' | 'detailing',
  lifecycle?: LifecycleExtensions,
): BusinessTypeConfig {
  return {
    key,
    displayName: 'stub',
    shortName: 'stub',
    pricingModel: { kind: 'flat' },
    services: [],
    jobFields: [],
    inventoryFields: [],
    copy: { jobNounSingular: 'job', jobNounPlural: 'jobs', emptyJobsHint: '', inventoryLabel: '' },
    defaultExpenseCategories: [],
    features: {
      inventoryDeduction: false,
      photoCapture: false,
      vehicleDiagnostics: false,
      vehicleSizeMultiplier: false,
      roadsideAddons: false,
    },
    invoiceTemplateKey: key,
    dashboardMetrics: [],
    lifecycle,
  };
}

// Minimal Job stub — only the lifecycle-relevant fields matter. The
// helpers under test read only the subset declared here; cast suffices.
function jobStub(over: Partial<Job> = {}): Job {
  return {
    id: 'test',
    date: '2026-05-20',
    service: 'Test',
    vehicleType: 'Car',
    area: '',
    payment: 'Cash',
    status: 'Pending',
    source: 'Test',
    customerName: '',
    customerPhone: '',
    tireSize: '',
    qty: 1,
    revenue: 0,
    tireCost: 0,
    materialCost: 0,
    miles: 0,
    note: '',
    emergency: false,
    lateNight: false,
    highway: false,
    weekend: false,
    tireSource: 'Inventory',
    inventoryDeductions: null,
    paymentStatus: 'Paid',
    invoiceGenerated: false,
    invoiceSent: false,
    reviewRequested: false,
    ...over,
  } as Job;
}

console.log('\n┌─ UNIVERSAL_STAGES ──────────────────────────────────');
check('has exactly 13 entries', UNIVERSAL_STAGES.length === 13);
check(
  'every stage has a unique id',
  new Set(UNIVERSAL_STAGES.map((s) => s.id)).size === UNIVERSAL_STAGES.length,
);
{
  const paid = UNIVERSAL_STAGES.find((s) => s.id === 'paid');
  const canceled = UNIVERSAL_STAGES.find((s) => s.id === 'canceled');
  check('terminal: paid has empty recommendedNext', paid?.recommendedNext.length === 0);
  check('terminal: canceled has empty recommendedNext', canceled?.recommendedNext.length === 0);
}

console.log('\n┌─ resolveLifecycle ──────────────────────────────────');
{
  // Tire: no lifecycle extensions → inherits universal defaults.
  const r = resolveLifecycle(stubVertical('tire'));
  check('tire-shape: inherits all 13 universal stages', r.stages.length === 13);
  check('tire-shape: zero substages', r.substagesByParent.size === 0);
}
{
  // Mechanic: declares 3 substages (2 under waiting_parts + 1 under in_progress).
  const r = resolveLifecycle(
    stubVertical('mechanic', {
      substages: [
        { id: 'mechanic.parts_on_order',    parentStage: 'waiting_parts', label: 'Parts on order',    technicianVisible: true, customerVisible: true },
        { id: 'mechanic.parts_back_order',  parentStage: 'waiting_parts', label: 'Parts back-order',  technicianVisible: true, customerVisible: true },
        { id: 'mechanic.diagnosis_pending', parentStage: 'in_progress',   label: 'Diagnosing',        technicianVisible: true, customerVisible: false },
      ],
    }),
  );
  check('mechanic-shape: inherits all 13 stages', r.stages.length === 13);
  check('mechanic-shape: 2 substages under waiting_parts', r.substagesByParent.get('waiting_parts')?.length === 2);
  check('mechanic-shape: 1 substage under in_progress', r.substagesByParent.get('in_progress')?.length === 1);
}
{
  // Detailing: omits waiting_parts via applicableStages + overrides awaiting_approval label.
  const r = resolveLifecycle(
    stubVertical('detailing', {
      applicableStages: [
        'lead', 'quoted', 'scheduled', 'dispatched', 'enroute', 'onsite',
        'in_progress', 'awaiting_approval', 'completed', 'invoiced', 'paid', 'canceled',
      ],
      stageOverrides: {
        awaiting_approval: { label: 'Awaiting customer walk-around', shortLabel: 'Walk-around' },
      },
    }),
  );
  check('detailing-shape: omits waiting_parts (12 stages)', r.stages.length === 12);
  check('detailing-shape: waiting_parts not in stageById', r.stageById.has('waiting_parts') === false);
  check(
    'detailing-shape: awaiting_approval label overridden',
    r.stageById.get('awaiting_approval')?.label === 'Awaiting customer walk-around',
  );
}
{
  // Sanity: a substage referencing a parent that's been filtered out
  // emits a warning and drops the substage.
  const r = resolveLifecycle(
    stubVertical('detailing', {
      applicableStages: ['in_progress'],
      substages: [
        { id: 'detailing.bad', parentStage: 'waiting_parts', label: 'orphan', technicianVisible: true, customerVisible: true },
      ],
    }),
  );
  check('substage with filtered-out parent is dropped', r.substagesByParent.size === 0);
}
{
  // Sanity: duplicate substage ids — first wins, second dropped.
  const r = resolveLifecycle(
    stubVertical('mechanic', {
      substages: [
        { id: 'dup', parentStage: 'in_progress', label: 'A', technicianVisible: true, customerVisible: true },
        { id: 'dup', parentStage: 'in_progress', label: 'B', technicianVisible: true, customerVisible: true },
      ],
    }),
  );
  check('duplicate substage id keeps first occurrence only', r.substagesByParent.get('in_progress')?.length === 1);
}

console.log('\n┌─ deriveLifecycleStage (read-side compat) ───────────');
check(
  'explicit lifecycleStage wins',
  deriveLifecycleStage(jobStub({ lifecycleStage: 'enroute' })) === 'enroute',
);
check(
  "legacy 'Cancelled' status maps to canceled",
  deriveLifecycleStage(jobStub({ status: 'Cancelled' })) === 'canceled',
);
check(
  "legacy 'Pending' status maps to in_progress",
  deriveLifecycleStage(jobStub({ status: 'Pending' })) === 'in_progress',
);
check(
  "legacy 'Completed' + paymentStatus 'Paid' maps to paid",
  deriveLifecycleStage(jobStub({ status: 'Completed', paymentStatus: 'Paid' })) === 'paid',
);
check(
  "legacy 'Completed' + invoiceGenerated maps to invoiced",
  deriveLifecycleStage(
    jobStub({ status: 'Completed', paymentStatus: 'Pending Payment', invoiceGenerated: true }),
  ) === 'invoiced',
);
check(
  "legacy 'Completed' with no payment / invoice maps to completed",
  deriveLifecycleStage(
    jobStub({ status: 'Completed', paymentStatus: 'Pending Payment', invoiceGenerated: false }),
  ) === 'completed',
);

console.log('\n┌─ legacyStatusFromStage (write-side dual-stamp) ─────');
{
  const r = legacyStatusFromStage('canceled');
  check("'canceled' → status: 'Cancelled'", r.status === 'Cancelled');
  check("'canceled' → no paymentStatus", r.paymentStatus === undefined);
  check("'canceled' → no invoiceGenerated", r.invoiceGenerated === undefined);
}
{
  const r = legacyStatusFromStage('paid');
  check("'paid' default → status: Completed", r.status === 'Completed');
  check("'paid' default → paymentStatus: Paid", r.paymentStatus === 'Paid');
  check("'paid' default → invoiceGenerated: true", r.invoiceGenerated === true);
}
{
  const r = legacyStatusFromStage('paid', { paymentTrackingEnabled: false });
  check("'paid' + paymentTracking disabled → status only", r.status === 'Completed' && r.paymentStatus === undefined);
}
{
  const r = legacyStatusFromStage('invoiced');
  check("'invoiced' → status: Completed", r.status === 'Completed');
  check("'invoiced' → invoiceGenerated: true", r.invoiceGenerated === true);
  check("'invoiced' does NOT auto-set paymentStatus", r.paymentStatus === undefined);
}
{
  const r = legacyStatusFromStage('invoiced', { job: { paymentStatus: 'Partial Payment' } });
  check("'invoiced' preserves prior paymentStatus via ctx.job", r.paymentStatus === 'Partial Payment');
}
{
  const r = legacyStatusFromStage('completed', { job: { invoiceGenerated: true } });
  check("'completed' preserves prior invoiceGenerated", r.invoiceGenerated === true);
}
{
  const preService = ['lead', 'quoted', 'scheduled', 'dispatched', 'enroute',
                      'onsite', 'in_progress', 'waiting_parts', 'awaiting_approval'] as const;
  const allPending = preService.every((s) => legacyStatusFromStage(s).status === 'Pending');
  check('every pre-service / in-field stage maps to Pending', allPending);
}

console.log('\n┌─ isRecommendedNext ─────────────────────────────────');
{
  const r = resolveLifecycle(stubVertical('tire'));
  check('scheduled → dispatched is recommended', isRecommendedNext('scheduled', 'dispatched', r) === true);
  check('paid → in_progress NOT recommended (terminal)', isRecommendedNext('paid', 'in_progress', r) === false);
  check('undefined from-stage returns false', isRecommendedNext(undefined, 'lead', r) === false);
}

console.log('\n┌─ appendTransition ──────────────────────────────────');
{
  const policy = { inlineCap: 3 };
  const entry = (toStage: 'lead' | 'quoted' | 'scheduled', at: string): LifecycleTransition => ({
    toStage, at, byUid: 'u',
  });

  {
    const j = jobStub({});
    const out = appendTransition(j, entry('lead', '2026-01-01T00:00:00Z'), policy);
    check('appends to undefined transitions', out.transitions?.length === 1);
    check('first entry has toStage lead', out.transitions?.[0].toStage === 'lead');
  }

  {
    const j = jobStub({ transitions: [entry('lead', '2026-01-01T00:00:00Z')] });
    const out = appendTransition(j, entry('quoted', '2026-01-02T00:00:00Z'), policy);
    check('returns a new object (not same reference)', out !== j);
    check('input job not mutated', j.transitions?.length === 1);
    check('output has 2 entries', out.transitions?.length === 2);
  }

  {
    const j = jobStub({
      transitions: [
        entry('lead',      '2026-01-01T00:00:00Z'),
        entry('quoted',    '2026-01-02T00:00:00Z'),
        entry('scheduled', '2026-01-03T00:00:00Z'),
      ],
    });
    const out = appendTransition(j, entry('lead', '2026-01-04T00:00:00Z'), policy);
    check('trims to inlineCap', out.transitions?.length === 3);
    check('oldest entry dropped', out.transitions?.[0].at === '2026-01-02T00:00:00Z');
    check('new entry at end', out.transitions?.[2].at === '2026-01-04T00:00:00Z');
  }
}

console.log('\n┌─ getTransitionRetentionPolicy ──────────────────────');
{
  const s = {} as Settings;
  check('foundation tier: inlineCap === 50', getTransitionRetentionPolicy(s).inlineCap === 50);
}

console.log('\n══════════════════════════════════════════════════');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
