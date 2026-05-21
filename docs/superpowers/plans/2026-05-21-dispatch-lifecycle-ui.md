# Dispatch + Lifecycle UI Implementation Plan (Phase 2.2 / Sub-Project C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the first writers of the job-lifecycle foundation — a stage picker in `JobDetailModal`, a transition recorder that dual-writes legacy status, a timeline view, and a "Group by stage" toggle on the History page. Spec: [docs/superpowers/specs/2026-05-21-dispatch-lifecycle-ui-design.md](../specs/2026-05-21-dispatch-lifecycle-ui-design.md).

**Architecture:** Strictly additive on top of Sub-Projects A + B + the lifecycle foundation. All Job fields needed are already declared (`lifecycleStage?`, `lifecycleSubstage?`, `transitions?`). No schema changes. No firestore.rules changes (existing job-update rules from Sub-Project B already cover the writes).

**Tech Stack:** TypeScript strict mode, React 18, Firestore. No new dependencies.

**Commit cadence:** one focused commit per task; never squash. `npm run build` + relevant `npx tsx tests/<file>.test.ts` after every task.

---

## File Structure

**Files to create:**

| File | Responsibility |
|---|---|
| `src/components/JobDetailModal/StagePicker.tsx` | Stage chip grid with substage row + role-gated taps |
| `src/components/JobDetailModal/StageHistory.tsx` | Collapsible transitions timeline |
| `tests/transitionJobStage.test.ts` | `transitionJobStage()` correctness |
| `tests/canTransitionToStage.test.ts` | Role-based gate |
| `tests/historyEntries.test.ts` | Timeline-row builder |
| `tests/groupJobsByStage.test.ts` | Stage-grouped buckets |

**Files to modify:**

| File | Change |
|---|---|
| `src/lib/jobLifecycle.ts` | Add `transitionJobStage()` + `historyEntries()` |
| `src/lib/jobPermissions.ts` | Add `canTransitionToStage()` + `groupJobsByStage()` |
| `src/components/JobDetailModal.tsx` | Mount `StagePicker` + `StageHistory`; wire transition callback |
| `src/App.tsx` | Add `handleStageTransition` callback passed to JobDetailModal |
| `src/pages/History.tsx` | Add Date/Stage grouping toggle |

---

## Task 1: `transitionJobStage()` helper + test

**Files:**
- Modify: `src/lib/jobLifecycle.ts` (append `transitionJobStage` + `TransitionContext`)
- Create: `tests/transitionJobStage.test.ts`

- [ ] **Step 1: Add the helper**

Append to `src/lib/jobLifecycle.ts`:

```ts
// ─────────────────────────────────────────────────────────────────
//  Stage transition writer
// ─────────────────────────────────────────────────────────────────

export interface TransitionContext {
  job: Job;
  toStage: JobLifecycleStage;
  toSubstage?: string;
  byUid: string;
  note?: string;
  resolved: ResolvedLifecycle;
  settings: Settings;
  invoicingEnabled?: boolean;
  paymentTrackingEnabled?: boolean;
}

/**
 * Construct the next Job state after a stage transition. Pure — the
 * caller is responsible for writing the returned Job to Firestore.
 *
 * Atomically:
 *   - Stamps lifecycleStage + lifecycleSubstage
 *   - Appends a LifecycleTransition entry to transitions[] (trimmed
 *     via getTransitionRetentionPolicy)
 *   - Dual-writes legacy status / paymentStatus / invoiceGenerated
 *     via legacyStatusFromStage() so old readers stay consistent
 *   - Sets outOfFlow on the transition entry when the move isn't in
 *     the prior stage's recommendedNext set
 *   - Bumps lastEditedAt to the same ISO timestamp
 */
export function transitionJobStage(ctx: TransitionContext): Job {
  const fromStage = ctx.job.lifecycleStage ?? deriveLifecycleStage(ctx.job);
  const outOfFlow = !isRecommendedNext(fromStage, ctx.toStage, ctx.resolved);
  const at = new Date().toISOString();

  const entry: LifecycleTransition = {
    toStage: ctx.toStage,
    toSubstage: ctx.toSubstage,
    fromStage,
    at,
    byUid: ctx.byUid,
    note: ctx.note,
    outOfFlow: outOfFlow || undefined,
  };

  const retention = getTransitionRetentionPolicy(ctx.settings);
  const withTransition = appendTransition(ctx.job, entry, retention);

  const legacy = legacyStatusFromStage(ctx.toStage, {
    invoicingEnabled: ctx.invoicingEnabled,
    paymentTrackingEnabled: ctx.paymentTrackingEnabled,
    job: {
      invoiceGenerated: ctx.job.invoiceGenerated,
      paymentStatus: ctx.job.paymentStatus,
    },
  });

  return {
    ...withTransition,
    lifecycleStage: ctx.toStage,
    lifecycleSubstage: ctx.toSubstage,
    status: legacy.status,
    ...(legacy.paymentStatus !== undefined ? { paymentStatus: legacy.paymentStatus } : {}),
    ...(legacy.invoiceGenerated !== undefined ? { invoiceGenerated: legacy.invoiceGenerated } : {}),
    lastEditedAt: at,
  };
}
```

- [ ] **Step 2: Write the test**

```ts
// tests/transitionJobStage.test.ts
import { transitionJobStage } from '@/lib/jobLifecycle';
import { resolveLifecycle, UNIVERSAL_STAGES } from '@/config/jobs';
import type { Job, Settings, JobPartLine } from '@/types';
import type { BusinessTypeConfig } from '@/config/businessTypes/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

// Minimal stub vertical — resolveLifecycle only reads `key` + `lifecycle`.
const stubVertical = (key: 'tire' | 'mechanic' | 'detailing'): BusinessTypeConfig => ({
  key, displayName: 'stub', shortName: 'stub',
  pricingModel: { kind: 'flat' },
  services: [], jobFields: [], inventoryFields: [],
  copy: { jobNounSingular: 'job', jobNounPlural: 'jobs', emptyJobsHint: '', inventoryLabel: '' },
  defaultExpenseCategories: [],
  features: { inventoryDeduction: false, photoCapture: false, vehicleDiagnostics: false, vehicleSizeMultiplier: false, roadsideAddons: false },
  invoiceTemplateKey: key, dashboardMetrics: [],
} as BusinessTypeConfig);

const resolved = resolveLifecycle(stubVertical('tire'));
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

// Recommended transition (scheduled → dispatched)
{
  const job = baseJob({ lifecycleStage: 'scheduled' });
  const next = transitionJobStage({
    job, toStage: 'dispatched', byUid: 'owner', resolved, settings,
  });
  check('stamps lifecycleStage', next.lifecycleStage === 'dispatched');
  check('appends transition entry', next.transitions?.length === 1);
  check('entry has fromStage', next.transitions?.[0].fromStage === 'scheduled');
  check('entry has byUid', next.transitions?.[0].byUid === 'owner');
  check('recommended transition: no outOfFlow flag', next.transitions?.[0].outOfFlow === undefined);
  check('updates lastEditedAt', !!next.lastEditedAt);
}

// Out-of-flow transition (lead → in_progress, skipping multiple stages)
{
  const job = baseJob({ lifecycleStage: 'lead' });
  const next = transitionJobStage({
    job, toStage: 'in_progress', byUid: 'owner', resolved, settings,
  });
  check('out-of-flow: outOfFlow=true on entry', next.transitions?.[0].outOfFlow === true);
  check('out-of-flow: still applies the transition', next.lifecycleStage === 'in_progress');
}

// Substage included
{
  const job = baseJob({ lifecycleStage: 'in_progress' });
  const next = transitionJobStage({
    job, toStage: 'waiting_parts', toSubstage: 'mechanic.parts_on_order',
    byUid: 'tech', resolved, settings,
  });
  check('stamps lifecycleSubstage', next.lifecycleSubstage === 'mechanic.parts_on_order');
  check('entry has toSubstage', next.transitions?.[0].toSubstage === 'mechanic.parts_on_order');
}

// Legacy dual-write: paid stage stamps Completed + Paid + invoiceGenerated
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
  check('invoiced: preserves prior paymentStatus', next.paymentStatus === 'Pending Payment');
}

// Legacy dual-write: canceled
{
  const job = baseJob({ lifecycleStage: 'in_progress' });
  const next = transitionJobStage({
    job, toStage: 'canceled', byUid: 'owner', resolved, settings,
  });
  check('canceled: status=Cancelled', next.status === 'Cancelled');
}

// Append accumulates: multi-transition chain
{
  let job = baseJob({ lifecycleStage: 'scheduled' });
  job = transitionJobStage({ job, toStage: 'dispatched', byUid: 'owner', resolved, settings });
  job = transitionJobStage({ job, toStage: 'enroute', byUid: 'tech', resolved, settings });
  job = transitionJobStage({ job, toStage: 'onsite', byUid: 'tech', resolved, settings });
  check('three sequential transitions: 3 entries', job.transitions?.length === 3);
  check('chain preserves order: first is dispatched', job.transitions?.[0].toStage === 'dispatched');
  check('chain preserves order: last is onsite', job.transitions?.[2].toStage === 'onsite');
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
  // deriveLifecycleStage on the legacy job: Completed + Paid → 'paid'
  check('legacy job: derives fromStage via deriveLifecycleStage', next.transitions?.[0].fromStage === 'paid');
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 3: Run test + verify build**

```bash
npx tsx tests/transitionJobStage.test.ts
npm run build
```
Expected: tests pass; build clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/jobLifecycle.ts tests/transitionJobStage.test.ts
git commit -m "feat(lifecycle): transitionJobStage helper + comprehensive tests"
```

---

## Task 2: `canTransitionToStage()` helper + test

**Files:**
- Modify: `src/lib/jobPermissions.ts`
- Create: `tests/canTransitionToStage.test.ts`

- [ ] **Step 1: Append helper to jobPermissions.ts**

Add the import at the top:

```ts
import type { JobLifecycleStage } from '@/config/jobs/lifecycle';
```

Append the helper at the end of the file:

```ts
/**
 * Can the given role transition a job to the target stage?
 *
 * - Owner / admin: any stage
 * - Technician: in-field stages + completed + paid (techs collect
 *   payment on-site in mobile-service workflows); cannot transition
 *   to pre-service stages, invoiced, or canceled
 * - Null / undefined role: never
 */
export function canTransitionToStage(
  role: Role | null | undefined,
  stage: JobLifecycleStage,
): boolean {
  if (role === 'owner' || role === 'admin') return true;
  if (role !== 'technician') return false;
  const TECH_STAGES: JobLifecycleStage[] = [
    'dispatched', 'enroute', 'onsite',
    'in_progress', 'waiting_parts', 'awaiting_approval',
    'completed', 'paid',
  ];
  return TECH_STAGES.includes(stage);
}
```

- [ ] **Step 2: Write the test**

```ts
// tests/canTransitionToStage.test.ts
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

// Owner: every stage
for (const s of ALL_STAGES) {
  check(`owner → ${s}: allowed`, canTransitionToStage('owner', s) === true);
}

// Admin: every stage
for (const s of ALL_STAGES) {
  check(`admin → ${s}: allowed`, canTransitionToStage('admin', s) === true);
}

// Technician: in-field + completed + paid
for (const s of TECH_ALLOWED) {
  check(`tech → ${s}: allowed`, canTransitionToStage('technician', s) === true);
}
for (const s of TECH_FORBIDDEN) {
  check(`tech → ${s}: forbidden`, canTransitionToStage('technician', s) === false);
}

// Defensive: null / undefined role
check('null role → in_progress: forbidden', canTransitionToStage(null, 'in_progress') === false);
check('undefined role → paid: forbidden', canTransitionToStage(undefined, 'paid') === false);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 3: Run + verify**

```bash
npx tsx tests/canTransitionToStage.test.ts
npm run build
```
Expected: tests pass; build clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/jobPermissions.ts tests/canTransitionToStage.test.ts
git commit -m "feat(perms): canTransitionToStage role-based gate"
```

---

## Task 3: `historyEntries` + `groupJobsByStage` + tests

**Files:**
- Modify: `src/lib/jobLifecycle.ts` (add `historyEntries`)
- Modify: `src/lib/jobPermissions.ts` (add `groupJobsByStage`)
- Create: `tests/historyEntries.test.ts`
- Create: `tests/groupJobsByStage.test.ts`

- [ ] **Step 1: Add `historyEntries` to jobLifecycle.ts**

```ts
// ─────────────────────────────────────────────────────────────────
//  Timeline rendering helper
// ─────────────────────────────────────────────────────────────────

export interface HistoryRow {
  at: string;
  stageLabel: string;
  fromStageLabel?: string;
  actorLabel: string;
  outOfFlow: boolean;
  note?: string;
}

/**
 * Build the timeline rows for a job, newest-first. Resolves stage
 * labels via the supplied ResolvedLifecycle (so vertical overrides
 * apply) and actor labels via the supplied resolveName function
 * (which mirrors the useMembersDirectory signature). Pure — fully
 * testable without React.
 */
export function historyEntries(
  job: Pick<Job, 'transitions'>,
  resolved: ResolvedLifecycle,
  resolveName: (uid: string | undefined | null) => string | null,
): HistoryRow[] {
  const entries = job.transitions ?? [];
  // Reverse-render: newest first. transitions[] is appended chronologically.
  return entries.slice().reverse().map((e) => ({
    at: e.at,
    stageLabel: resolved.stageById.get(e.toStage)?.label ?? e.toStage,
    fromStageLabel: e.fromStage
      ? (resolved.stageById.get(e.fromStage)?.label ?? e.fromStage)
      : undefined,
    actorLabel: resolveName(e.byUid) ?? 'Unknown',
    outOfFlow: e.outOfFlow === true,
    note: e.note,
  }));
}
```

- [ ] **Step 2: Add `groupJobsByStage` to jobPermissions.ts**

Add the imports at the top:

```ts
import type { JobLifecycleStage, ResolvedLifecycle, StageSpec } from '@/config/jobs/lifecycle';
import { deriveLifecycleStage } from '@/lib/jobLifecycle';
```

Append the helper:

```ts
/**
 * Group jobs into per-stage buckets using deriveLifecycleStage on
 * each job. Stages not in the resolved vertical's applicableStages
 * are skipped (their jobs are dropped from the grouping — empty
 * stages get hidden). Returns canonical-order array of populated
 * buckets only.
 */
export function groupJobsByStage(
  jobs: ReadonlyArray<Job>,
  resolved: ResolvedLifecycle,
): Array<{ stage: StageSpec; jobs: Job[] }> {
  const buckets = new Map<JobLifecycleStage, Job[]>();
  for (const j of jobs) {
    const stage = deriveLifecycleStage(j);
    if (!resolved.stageById.has(stage)) continue;
    let bucket = buckets.get(stage);
    if (!bucket) { bucket = []; buckets.set(stage, bucket); }
    bucket.push(j);
  }
  return resolved.stages
    .filter((s) => buckets.has(s.id))
    .map((s) => ({ stage: s, jobs: buckets.get(s.id)! }));
}
```

- [ ] **Step 3: Write `tests/historyEntries.test.ts`**

```ts
// tests/historyEntries.test.ts
import { historyEntries } from '@/lib/jobLifecycle';
import { resolveLifecycle } from '@/config/jobs';
import type { Job } from '@/types';
import type { BusinessTypeConfig } from '@/config/businessTypes/types';
import type { LifecycleTransition } from '@/config/jobs/lifecycle';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const stubVertical: BusinessTypeConfig = {
  key: 'tire', displayName: 'stub', shortName: 'stub',
  pricingModel: { kind: 'flat' },
  services: [], jobFields: [], inventoryFields: [],
  copy: { jobNounSingular: 'job', jobNounPlural: 'jobs', emptyJobsHint: '', inventoryLabel: '' },
  defaultExpenseCategories: [],
  features: { inventoryDeduction: false, photoCapture: false, vehicleDiagnostics: false, vehicleSizeMultiplier: false, roadsideAddons: false },
  invoiceTemplateKey: 'tire', dashboardMetrics: [],
};
const resolved = resolveLifecycle(stubVertical);
const directory: Record<string, string> = { 'u1': 'Alice', 'u2': 'Owner' };
const resolveName = (uid: string | undefined | null): string | null =>
  uid ? directory[uid] ?? null : null;

const t = (over: Partial<LifecycleTransition> = {}): LifecycleTransition => ({
  toStage: 'dispatched', at: '2026-05-21T10:00:00Z', byUid: 'u1', ...over,
});

console.log('\n┌─ historyEntries ──────────────────────────────────');

// Empty / undefined
check('undefined transitions → empty array',
  historyEntries({} as Pick<Job, 'transitions'>, resolved, resolveName).length === 0);
check('empty transitions → empty array',
  historyEntries({ transitions: [] }, resolved, resolveName).length === 0);

// Single entry
{
  const rows = historyEntries(
    { transitions: [t({ toStage: 'dispatched', byUid: 'u2' })] },
    resolved, resolveName,
  );
  check('single entry: 1 row', rows.length === 1);
  check('stage label resolved', rows[0].stageLabel === 'Dispatched');
  check('actor resolved', rows[0].actorLabel === 'Owner');
  check('outOfFlow false by default', rows[0].outOfFlow === false);
}

// Newest first
{
  const rows = historyEntries({
    transitions: [
      t({ at: '2026-05-21T08:00:00Z', toStage: 'scheduled' }),
      t({ at: '2026-05-21T09:00:00Z', toStage: 'dispatched' }),
      t({ at: '2026-05-21T10:00:00Z', toStage: 'enroute' }),
    ],
  }, resolved, resolveName);
  check('3 entries returned', rows.length === 3);
  check('newest-first ordering (enroute first)', rows[0].stageLabel === 'En route');
  check('newest-first ordering (scheduled last)', rows[2].stageLabel === 'Scheduled');
}

// fromStage label
{
  const rows = historyEntries({
    transitions: [t({ toStage: 'in_progress', fromStage: 'onsite' })],
  }, resolved, resolveName);
  check('fromStage label resolved', rows[0].fromStageLabel === 'On-site');
}

// Unknown uid → "Unknown"
{
  const rows = historyEntries({
    transitions: [t({ byUid: 'ghost' })],
  }, resolved, resolveName);
  check('unknown uid falls back to "Unknown"', rows[0].actorLabel === 'Unknown');
}

// outOfFlow flag carries
{
  const rows = historyEntries({
    transitions: [t({ outOfFlow: true })],
  }, resolved, resolveName);
  check('outOfFlow true carries through', rows[0].outOfFlow === true);
}

// note carries
{
  const rows = historyEntries({
    transitions: [t({ note: 'customer paused' })],
  }, resolved, resolveName);
  check('note carries through', rows[0].note === 'customer paused');
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 4: Write `tests/groupJobsByStage.test.ts`**

```ts
// tests/groupJobsByStage.test.ts
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
    baseJob({ id: 'd', status: 'Pending', lifecycleStage: undefined }), // derives to in_progress
    baseJob({ id: 'e', status: 'Completed', paymentStatus: 'Paid', lifecycleStage: undefined }), // derives to paid
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
    baseJob({ id: 'a', lifecycleStage: 'waiting_parts' }), // not applicable for detailing
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
```

- [ ] **Step 5: Run all + verify**

```bash
npx tsx tests/historyEntries.test.ts
npx tsx tests/groupJobsByStage.test.ts
npm run build
```
Expected: all pass; build clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/jobLifecycle.ts src/lib/jobPermissions.ts tests/historyEntries.test.ts tests/groupJobsByStage.test.ts
git commit -m "feat(lifecycle,perms): historyEntries + groupJobsByStage helpers + tests"
```

---

## Task 4: `StagePicker` component

**Files:**
- Create: `src/components/JobDetailModal/StagePicker.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/JobDetailModal/StagePicker.tsx
// ═══════════════════════════════════════════════════════════════════
//  Stage picker for JobDetailModal. Renders the applicable stages
//  grouped by category (pre-service / in-field / post-service /
//  terminal). Each chip is role-gated via canTransitionToStage and
//  marked with "→" when in the current stage's recommendedNext set.
//  Tapping a stage with declared substages opens an inline secondary
//  row; tap "Skip" to leave substage undefined.
//
//  Out-of-flow taps are allowed silently — the transition writer
//  stamps outOfFlow: true and the History section surfaces a badge.
// ═══════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import type { Job, Role } from '@/types';
import type {
  JobLifecycleStage,
  ResolvedLifecycle,
  StageSpec,
  SubStageSpec,
} from '@/config/jobs/lifecycle';
import { deriveLifecycleStage, isRecommendedNext } from '@/lib/jobLifecycle';
import { canTransitionToStage } from '@/lib/jobPermissions';

interface Props {
  job: Job;
  resolved: ResolvedLifecycle;
  role: Role | null;
  onTransition: (toStage: JobLifecycleStage, toSubstage?: string) => void;
}

export function StagePicker({ job, resolved, role, onTransition }: Props) {
  const currentStage = job.lifecycleStage ?? deriveLifecycleStage(job);

  // Pending-substage state: when user taps a stage with substages,
  // we defer the transition until they pick a substage or "Skip".
  const [pendingStage, setPendingStage] = useState<JobLifecycleStage | null>(null);

  const grouped = useMemo(() => {
    const groups: Record<StageSpec['category'], StageSpec[]> = {
      pre_service: [], in_field: [], post_service: [], terminal: [],
    };
    for (const s of resolved.stages) groups[s.category].push(s);
    return groups;
  }, [resolved]);

  const handleStageTap = (stage: JobLifecycleStage): void => {
    const subs = resolved.substagesByParent.get(stage);
    if (subs && subs.length > 0) {
      setPendingStage(stage);
      return;
    }
    onTransition(stage);
  };

  const handleSubstagePick = (sub: SubStageSpec | null): void => {
    if (pendingStage) {
      onTransition(pendingStage, sub?.id);
      setPendingStage(null);
    }
  };

  const pendingSubs = pendingStage ? (resolved.substagesByParent.get(pendingStage) ?? []) : [];

  return (
    <div className="form-group" style={{ marginBottom: 12 }}>
      <div className="form-group-title">Stage</div>
      {(['pre_service', 'in_field', 'post_service', 'terminal'] as const).map((cat) => {
        const stages = grouped[cat];
        if (stages.length === 0) return null;
        return (
          <div key={cat} style={{ marginBottom: 8 }}>
            <div style={{
              fontSize: 10, color: 'var(--t3)', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4,
            }}>
              {CATEGORY_LABELS[cat]}
            </div>
            <div className="chip-grid">
              {stages.map((s) => {
                const isCurrent = s.id === currentStage;
                const isRecommended = isRecommendedNext(currentStage, s.id, resolved);
                const allowed = canTransitionToStage(role, s.id);
                const label = (isRecommended && !isCurrent ? '→ ' : '') + (s.shortLabel || s.label);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={'chip' + (isCurrent ? ' active' : '')}
                    style={{
                      opacity: allowed ? 1 : 0.4,
                      cursor: allowed ? 'pointer' : 'not-allowed',
                    }}
                    onClick={() => { if (allowed && !isCurrent) handleStageTap(s.id); }}
                    disabled={!allowed}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {pendingStage && pendingSubs.length > 0 && (
        <div style={{
          marginTop: 8, padding: 10,
          background: 'var(--s2)', border: '1px solid var(--brand-primary)',
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 11, color: 'var(--t2)', marginBottom: 6 }}>
            Substage for {resolved.stageById.get(pendingStage)?.label}:
          </div>
          <div className="chip-grid">
            {pendingSubs.map((sub) => (
              <button
                key={sub.id}
                type="button"
                className="chip"
                onClick={() => handleSubstagePick(sub)}
              >
                {sub.label}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              onClick={() => handleSubstagePick(null)}
              style={{ opacity: 0.7 }}
            >
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const CATEGORY_LABELS: Record<StageSpec['category'], string> = {
  pre_service: 'Pre-service',
  in_field: 'In-field',
  post_service: 'Post-service',
  terminal: 'Terminal',
};
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/JobDetailModal/StagePicker.tsx
git commit -m "feat(jobmodal): StagePicker component with role-gated chips + substage row"
```

---

## Task 5: `StageHistory` component

**Files:**
- Create: `src/components/JobDetailModal/StageHistory.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/JobDetailModal/StageHistory.tsx
// ═══════════════════════════════════════════════════════════════════
//  Collapsible transition timeline for JobDetailModal. Reads
//  job.transitions[] via the historyEntries() pure helper which
//  resolves stage labels + actor names. Empty-state when no
//  transitions yet. Newest-first.
// ═══════════════════════════════════════════════════════════════════

import { useState } from 'react';
import type { Job } from '@/types';
import type { ResolvedLifecycle } from '@/config/jobs/lifecycle';
import { historyEntries } from '@/lib/jobLifecycle';

interface Props {
  job: Job;
  resolved: ResolvedLifecycle;
  resolveName: (uid: string | undefined | null) => string | null;
}

export function StageHistory({ job, resolved, resolveName }: Props) {
  const [open, setOpen] = useState(false);
  const rows = historyEntries(job, resolved, resolveName);

  return (
    <div className="form-group" style={{ marginBottom: 12 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', background: 'transparent', border: 0, padding: 0,
          color: 'var(--t1)', cursor: 'pointer',
        }}
      >
        <span className="form-group-title" style={{ margin: 0 }}>
          {open ? '▾' : '▸'} History {rows.length > 0 ? `(${rows.length})` : ''}
        </span>
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          {rows.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--t3)', padding: '8px 0' }}>
              No stage history yet — transitions are recorded as you advance the job.
            </div>
          ) : (
            rows.map((r, i) => (
              <div
                key={i}
                style={{
                  display: 'flex', alignItems: 'baseline', gap: 8,
                  padding: '8px 0',
                  borderTop: i === 0 ? 0 : '1px solid var(--border)',
                  fontSize: 13,
                }}
              >
                <span style={{ color: 'var(--brand-primary)', fontSize: 10 }}>●</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>
                    {r.stageLabel}
                    {r.outOfFlow && (
                      <span style={{ color: 'var(--amber)', fontSize: 11, marginLeft: 6 }}>⚠ skip</span>
                    )}
                  </div>
                  {r.fromStageLabel && (
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>
                      from {r.fromStageLabel}
                    </div>
                  )}
                  {r.note && (
                    <div style={{ fontSize: 11, color: 'var(--t3)', fontStyle: 'italic' }}>
                      {r.note}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--t3)' }}>
                  <div>by {r.actorLabel}</div>
                  <div>{formatTime(r.at)}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/components/JobDetailModal/StageHistory.tsx
git commit -m "feat(jobmodal): StageHistory collapsible transition timeline"
```

---

## Task 6: Mount StagePicker + StageHistory in JobDetailModal

**Files:**
- Modify: `src/components/JobDetailModal.tsx`
- Modify: `src/App.tsx` (add `handleStageTransition` callback)

- [ ] **Step 1: Extend JobDetailModal Props + mount the components**

Open `src/components/JobDetailModal.tsx`. Update the imports:

```ts
import { useActiveLifecycle } from '@/lib/useActiveLifecycle';
import { useMembership } from '@/context/MembershipContext';
import { useBrand } from '@/context/BrandContext';
import { useMembersDirectory } from '@/lib/useMembersDirectory';
import { StagePicker } from '@/components/JobDetailModal/StagePicker';
import { StageHistory } from '@/components/JobDetailModal/StageHistory';
import type { JobLifecycleStage } from '@/config/jobs/lifecycle';
```

Find the existing `interface Props` declaration and append:

```ts
  onStageTransition?: (toStage: JobLifecycleStage, toSubstage?: string) => void;
```

Inside the component, after the existing prop destructuring, add:

```ts
const resolved = useActiveLifecycle();
const { role } = useMembership();
const { businessId } = useBrand();
const { resolveName } = useMembersDirectory(businessId);
```

Find the "Status" form-group block (the one with `<span className={'pill ' + ...`). **Immediately after** that closing `</div>` (the form-group div), insert:

```tsx
{onStageTransition && (
  <>
    <StagePicker
      job={job}
      resolved={resolved}
      role={role}
      onTransition={onStageTransition}
    />
    <StageHistory
      job={job}
      resolved={resolved}
      resolveName={resolveName}
    />
  </>
)}
```

- [ ] **Step 2: Add `handleStageTransition` callback in App.tsx**

Open `src/App.tsx`. Find the existing `saveJob` callback. Add a new callback below it (or above the JobDetailModal render — anywhere in the component body works):

```ts
const handleStageTransition = useCallback(
  async (job: Job, toStage: JobLifecycleStage, toSubstage?: string) => {
    if (!businessId) return;
    const jobsCol = scopedCol(businessId, 'jobs');
    const verticalConfig = getBusinessTypeConfig(settings.businessType);
    const resolvedLifecycle = resolveLifecycle(verticalConfig);
    const next = transitionJobStage({
      job,
      toStage,
      toSubstage,
      byUid: _auth?.currentUser?.uid || '',
      resolved: resolvedLifecycle,
      settings,
    });
    try {
      await fbSetFast(jobsCol, next.id, next);
      // Update local state immediately so the modal re-renders with
      // the new stage without waiting on the snapshot listener.
      setDetailJob(next);
      addToast(`Stage → ${toStage}`, 'success');
    } catch (e) {
      console.error('[handleStageTransition] failed:', e);
      addToast(`Stage update failed: ${humanizeFirestoreError(e)}`, 'error');
    }
  },
  [businessId, settings],
);
```

Add the required imports near the existing lifecycle imports:

```ts
import { transitionJobStage } from '@/lib/jobLifecycle';
import { resolveLifecycle } from '@/config/jobs';
import type { JobLifecycleStage } from '@/config/jobs/lifecycle';
```

(Some of these may already exist — keep one copy each.)

Find where `<JobDetailModal` is rendered in App.tsx. Add the new prop:

```tsx
<JobDetailModal
  job={detailJob}
  settings={settings}
  onClose={() => setDetailJob(null)}
  onEdit={() => handleEditJob(detailJob)}
  onDuplicate={() => handleDuplicate(detailJob)}
  onDelete={() => { void deleteJob(detailJob.id); setDetailJob(null); }}
  onGenerateInvoice={() => handleGenerateInvoice(detailJob)}
  /* ... other existing handlers ... */
  onStageTransition={(toStage, toSubstage) => handleStageTransition(detailJob, toStage, toSubstage)}
/>
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/JobDetailModal.tsx src/App.tsx
git commit -m "feat(jobmodal): mount StagePicker + StageHistory; wire handleStageTransition"
```

---

## Task 7: History tab "Group by stage" toggle

**Files:**
- Modify: `src/pages/History.tsx`

- [ ] **Step 1: Add the grouping toggle UI**

Open `src/pages/History.tsx`. Update the imports:

```ts
import { useActiveLifecycle } from '@/lib/useActiveLifecycle';
import { groupJobsByStage } from '@/lib/jobPermissions';
```

Inside the component function, near the top (after the existing hook calls and the `useScopedJobs` we already added):

```ts
const [groupMode, setGroupMode] = useState<'date' | 'stage'>('date');
const resolved = useActiveLifecycle();
```

Find the existing top-of-page filter UI (search input + status chips). Immediately above or below those, add the toggle:

```tsx
<div className="chip-grid" style={{ marginBottom: 8 }}>
  <button
    type="button"
    className={'chip' + (groupMode === 'date' ? ' active' : '')}
    onClick={() => setGroupMode('date')}
  >
    Date
  </button>
  <button
    type="button"
    className={'chip' + (groupMode === 'stage' ? ' active' : '')}
    onClick={() => setGroupMode('stage')}
  >
    Stage
  </button>
</div>
```

Find the existing job-list rendering block (the one that iterates `filteredJobs` or similar). Wrap it with a conditional:

```tsx
{groupMode === 'date' ? (
  // Leave the existing date-grouped job list rendering AS-IS. Do not
  // remove or refactor it. The toggle just swaps which renderer
  // displays for the user; the date path is unchanged.
  existingDateGroupedJSX
) : (
  <StageGroupedList
    jobs={filteredJobs}
    resolved={resolved}
    onViewJob={onViewJob}
  />
)}
```

Add the `StageGroupedList` component at the bottom of the file:

```tsx
function StageGroupedList({
  jobs, resolved, onViewJob,
}: {
  jobs: Job[];
  resolved: ReturnType<typeof useActiveLifecycle>;
  onViewJob: (j: Job) => void;
}) {
  const groups = groupJobsByStage(jobs, resolved);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (groups.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--t3)', textAlign: 'center' }}>
        No jobs match.
      </div>
    );
  }

  return (
    <>
      {groups.map(({ stage, jobs: bucket }) => {
        const isCollapsed = !!collapsed[stage.id];
        return (
          <div key={stage.id} style={{ marginBottom: 10 }}>
            <button
              onClick={() => setCollapsed((m) => ({ ...m, [stage.id]: !isCollapsed }))}
              className="btn sm secondary"
              style={{ width: '100%', textAlign: 'left', fontWeight: 700 }}
            >
              {isCollapsed ? '▸' : '▾'} {stage.label.toUpperCase()} ({bucket.length})
            </button>
            {!isCollapsed && (
              <div style={{ marginTop: 4 }}>
                {bucket.map((j) => (
                  <button
                    key={j.id}
                    onClick={() => onViewJob(j)}
                    className="card card-pad"
                    style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 4 }}
                  >
                    <div style={{ fontWeight: 600 }}>
                      {j.service} {j.customerName && <span style={{ color: 'var(--t3)', fontSize: 12 }}>· {j.customerName}</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--t2)' }}>
                      {j.date} · {j.vehicleType}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
```

(If the existing History rows have richer per-row content like profit/revenue/pill rendering that the StageGroupedList should mirror, copy the relevant JSX from the date-mode renderer into the bucket map. Keep the row rendering consistent so users don't see jarringly different layouts when toggling.)

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/History.tsx
git commit -m "feat(history): Date/Stage grouping toggle"
```

---

## Task 8: Final smoke + push + tag

- [ ] **Step 1: Re-run every test file**

```bash
npx tsx tests/jobLifecycle.test.ts
npx tsx tests/mechanicJobDerivation.test.ts
npx tsx tests/mechanicDeductionDiff.test.ts
npx tsx tests/mechanicDeductionRollback.test.ts
npx tsx tests/softStockWarning.test.ts
npx tsx tests/mechanicInvoiceLineItems.test.ts
npx tsx tests/technicianPermissions.test.ts
npx tsx tests/scopedJobs.test.ts
npx tsx tests/jobEditPermission.test.ts
npx tsx tests/jobDeletePermission.test.ts
npx tsx tests/assignableMembers.test.ts
npx tsx tests/transitionJobStage.test.ts
npx tsx tests/canTransitionToStage.test.ts
npx tsx tests/historyEntries.test.ts
npx tsx tests/groupJobsByStage.test.ts
```
Expected: each file prints `N passed, 0 failed`.

- [ ] **Step 2: Final clean build**

```bash
npm run build
```

- [ ] **Step 3: Confirm commit log**

```bash
git log --oneline origin/main..HEAD
```
Expected: ~8 commits, focused, granular.

- [ ] **Step 4: Push to origin**

```bash
git push origin main
```

- [ ] **Step 5: Run §15 spec smoke checklist on production**

After deploy lands, hand-execute the spec's smoke checklist:
- 4 owner regression items
- 6 new stage surface (owner) items
- 3 technician account items
- 2 cross-cutting items

- [ ] **Step 6: Tag stable**

```bash
git tag phase-2.2-dispatch-stable $(git rev-parse HEAD)
git push origin phase-2.2-dispatch-stable
```

---

## Phase summary

After all 8 tasks land:

| Surface | State |
|---|---|
| Helpers | `transitionJobStage`, `canTransitionToStage`, `historyEntries`, `groupJobsByStage` |
| Tests | 4 new files, ~80 assertions |
| Components | `StagePicker.tsx`, `StageHistory.tsx` |
| JobDetailModal | Mounts both new components; receives `onStageTransition` callback |
| App.tsx | `handleStageTransition` callback wires picker → `transitionJobStage` → Firestore write |
| History page | Date/Stage grouping toggle; date mode unchanged |
| Backward compat | Owner / admin / tech who don't touch the picker see zero change; legacy status chips in AddJob untouched |
| Schema | No changes (foundation already declared every field) |
| firestore.rules | No changes (jobs/update writes already gated by Sub-Project B) |
