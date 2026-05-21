# Job Lifecycle Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the type contracts, registry, helpers, and per-vertical wiring for the shared 13-stage job lifecycle described in [docs/superpowers/specs/2026-05-20-job-lifecycle-architecture-design.md](../specs/2026-05-20-job-lifecycle-architecture-design.md). Pure additive change — no existing reader or writer is modified.

**Architecture:** Universal stage data + types live under `src/config/jobs/`. Per-vertical extension data lives on `BusinessTypeConfig.lifecycle?`. Pure runtime helpers live in `src/lib/jobLifecycle.ts`. A React hook `useActiveLifecycle()` (parallel to the existing `useActiveVertical()`) returns the merged config for the active business. `Job` type widens with three optional fields (`lifecycleStage`, `lifecycleSubstage`, `transitions`). No saveJob edits, no Firestore migration, no rules changes.

**Tech Stack:** TypeScript strict mode (already on), React 18, no test runner currently configured. Future-runner test files land in `tests/` (excluded from `tsc --noEmit` via `tsconfig.exclude`) so they ship as vitest-shaped assertions inert today and executable the moment a runner is wired up.

**Testing approach (read this before starting):** The repo has no `npm test` script. Per Phase 2.1 precedent we verify by `npm run build` (strict TypeScript + Vite build) plus optional inline assertions. Helper functions are designed pure so future formal tests slot in without refactor — Task 9 ships a vitest-shaped test file in `tests/` that runs no-op today but encodes every invariant from the spec.

---

## Task 1: Type contracts

**Files:**
- Create: `src/config/jobs/lifecycle.ts`

- [ ] **Step 1: Create the type contracts file**

Write the full file with these contents (no implementations yet — pure type contracts):

```ts
// src/config/jobs/lifecycle.ts
// ═══════════════════════════════════════════════════════════════════
//  Job lifecycle type contracts — shared across every business
//  vertical. Implementations + universal data live in sibling files
//  in this directory; per-vertical extensions are declared on
//  BusinessTypeConfig.lifecycle in src/config/businessTypes/.
//
//  See docs/superpowers/specs/2026-05-20-job-lifecycle-architecture-design.md
//  for the full rationale + design decisions.
// ═══════════════════════════════════════════════════════════════════

/**
 * The 13 universal lifecycle stages. Adding a 14th is a deliberate
 * architectural decision — every vertical inherits the new stage
 * via the registry merge. The order below is NOT a state-machine
 * order (the system is advisory, not enforced); it's just the
 * canonical declaration order used for UI rendering of stage
 * pickers + the dispatch board's left-to-right column flow.
 */
export type JobLifecycleStage =
  | 'lead'
  | 'quoted'
  | 'scheduled'
  | 'dispatched'
  | 'enroute'
  | 'onsite'
  | 'in_progress'
  | 'waiting_parts'
  | 'awaiting_approval'
  | 'completed'
  | 'invoiced'
  | 'paid'
  | 'canceled';

/**
 * Optional declarative trigger for the Phase 2.x notification
 * dispatcher. Foundation declares the type only; runtime dispatch
 * happens in a separate phase.
 */
export interface StageNotificationSpec {
  audience: 'customer' | 'technician' | 'owner';
  channel: 'sms' | 'email' | 'push' | 'in_app';
  /** Template id resolved by the Phase 2.x dispatcher's template
   *  registry. The lifecycle layer treats it as opaque. */
  templateId: string;
  /** every_entry — fire on every entry into this stage.
   *  first_entry — fire only the first time the job enters this
   *  stage in its lifetime (tracked via job.transitions[]). */
  fireMode: 'every_entry' | 'first_entry';
}

/**
 * Universal stage metadata. Sparse vertical overrides allowed via
 * LifecycleExtensions.stageOverrides.
 */
export interface StageSpec {
  id: JobLifecycleStage;
  label: string;
  /** Shorter form for chips / pills. Falls back to label when
   *  undefined. */
  shortLabel?: string;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
  /** Whether this stage label is visible to a technician on their
   *  job card + dashboard. Owner / admin always see every stage. */
  technicianVisible: boolean;
  /** Whether this stage label appears in customer-facing surfaces
   *  (invoice rendering, SMS templates referencing the stage,
   *  future customer status page). */
  customerVisible: boolean;
  /** Advisory next-stage suggestions — drives "what's next?" UI
   *  affordances. NOT enforcement; any stage can transition to
   *  any other at runtime. Empty array = terminal stage. */
  recommendedNext: ReadonlyArray<JobLifecycleStage>;
  /** Coarse category for grouping in the timeline / dispatch board. */
  category: 'pre_service' | 'in_field' | 'post_service' | 'terminal';
  /** Notifications fired on entry. Universal baseline declared here;
   *  vertical overrides REPLACE this array via stageOverrides. An
   *  explicit empty array on a vertical override = suppress all. */
  notifications?: ReadonlyArray<StageNotificationSpec>;
}

/**
 * Vertical-specific substage that refines exactly one universal
 * parent stage. Ids follow the `<verticalKey>.<snake_case>`
 * convention so collisions can't happen across tenants (e.g.
 * mechanic.parts_on_order vs detailing.waiting_cure).
 *
 * The resolver does NOT enforce the prefix at runtime — convention
 * only. A console warning fires if two substages share an id.
 */
export interface SubStageSpec {
  id: string;
  parentStage: JobLifecycleStage;
  label: string;
  technicianVisible: boolean;
  customerVisible: boolean;
}

/**
 * Per-vertical contribution to the lifecycle. Every field is
 * OPTIONAL; a vertical with `lifecycle: undefined` inherits the
 * universal defaults intact.
 */
export interface LifecycleExtensions {
  /** Restrict the universal stages to a subset. Detailing omits
   *  'waiting_parts' (no parts); tire / mechanic accept all 13. */
  applicableStages?: ReadonlyArray<JobLifecycleStage>;
  /** Sparse per-stage overrides. Deep-merged on top of the
   *  universal StageSpec at resolve time. */
  stageOverrides?: Partial<Record<JobLifecycleStage, Partial<StageSpec>>>;
  /** Vertical-specific substages. Each refines exactly one
   *  universal parent stage. */
  substages?: ReadonlyArray<SubStageSpec>;
}

/**
 * Post-merge effective lifecycle for the active vertical. Consumed
 * by UI components and the Phase 2.x dispatcher. Built once per
 * vertical change via resolveLifecycle() + memoized in
 * useActiveLifecycle().
 */
export interface ResolvedLifecycle {
  /** Stages effective for this vertical, in canonical order. */
  stages: ReadonlyArray<StageSpec>;
  /** Substages bucketed by their parent universal stage. */
  substagesByParent: ReadonlyMap<JobLifecycleStage, ReadonlyArray<SubStageSpec>>;
  /** O(1) stage lookup. */
  stageById: ReadonlyMap<JobLifecycleStage, StageSpec>;
}

/**
 * One entry in the job's stage-transition history. Stored inline
 * on the Job doc as Job.transitions?: ReadonlyArray<...>. Existing
 * jobs have this undefined; the timeline renderer treats undefined
 * as empty. No data migration required.
 *
 * Append-only by convention. Foundation declares the shape;
 * Phase 2.x writers do the appending.
 */
export interface LifecycleTransition {
  /** The stage entered. */
  toStage: JobLifecycleStage;
  /** Substage entered, if applicable. Vertical-specific id. */
  toSubstage?: string;
  /** The stage left, if known. Captured for analytics ("how often
   *  did jobs skip 'dispatched' and go straight to 'enroute'?"). */
  fromStage?: JobLifecycleStage;
  /** ISO timestamp when the transition was committed. */
  at: string;
  /** Auth uid of the actor who committed the transition. */
  byUid: string;
  /** Optional free-text reason. e.g. "customer paused job" on a
   *  backflow from in_progress to scheduled. */
  note?: string;
  /** True when toStage was NOT in fromStage's recommendedNext set.
   *  Surfaces in future audit dashboards without inferring from
   *  before/after pairs every time. */
  outOfFlow?: boolean;
}

/**
 * Per-business transition retention policy. Foundation ships a
 * single tier (50 inline entries). Phase 2.x can extend by reading
 * settings.plan / billingTier / etc. inside
 * getTransitionRetentionPolicy() without touching call sites.
 */
export interface TransitionRetentionPolicy {
  /** Max LifecycleTransition entries kept inline on the Job doc.
   *  Older entries are dropped during appendTransition() trim. */
  inlineCap: number;
}

/**
 * Context the legacy-mirror inverse function reads to decide which
 * legacy fields to stamp alongside lifecycleStage. Keeps accounting
 * assumptions out of the lifecycle layer — the lifecycle layer
 * never invents a paymentStatus on the operator's behalf.
 */
export interface LegacyMirrorContext {
  /** Does the business have invoice generation enabled? Today all
   *  businesses can generate invoices; the flag exists so future
   *  tiers can disable it. Default treats `undefined` as enabled. */
  invoicingEnabled?: boolean;
  /** Does the business track customer payments? Today all do; the
   *  flag exists so detailing businesses billing cash-on-delivery
   *  can opt out and the inverse function won't invent a
   *  paymentStatus. Default treats `undefined` as enabled. */
  paymentTrackingEnabled?: boolean;
  /** The current Job, so the inverse can preserve pre-existing
   *  flags it shouldn't clobber (e.g. a 'completed'-stage write
   *  should keep a prior invoiceGenerated: true). */
  job?: {
    invoiceGenerated?: boolean;
    paymentStatus?: string;
  };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds. This file has no consumers yet.

- [ ] **Step 3: Commit**

```bash
git add src/config/jobs/lifecycle.ts
git commit -m "feat(job-lifecycle): type contracts for stages, transitions, retention"
```

---

## Task 2: Universal stage data

**Files:**
- Create: `src/config/jobs/universal-stages.ts`

- [ ] **Step 1: Write the universal-stage table**

```ts
// src/config/jobs/universal-stages.ts
// ═══════════════════════════════════════════════════════════════════
//  The 13 universal job-lifecycle stages with their default specs.
//  Per-vertical overrides live on BusinessTypeConfig.lifecycle.
//  stageOverrides; the resolver merges this baseline + the override.
//
//  Adding a 14th universal stage means appending one entry here AND
//  one literal to the JobLifecycleStage union in lifecycle.ts.
//  Every vertical automatically inherits the new stage.
//
//  Notification baseline rationale (see spec §10): platform-wide
//  customer-facing notifications (tech-on-the-way, invoice sent,
//  thank-you) and owner-facing operational ones (technician assigned,
//  job done, payment received) live here. Verticals can replace any
//  stage's notifications array via stageOverrides; an empty array is
//  the explicit "suppress all on this stage" signal.
// ═══════════════════════════════════════════════════════════════════

import type { StageSpec } from './lifecycle';

export const UNIVERSAL_STAGES: ReadonlyArray<StageSpec> = [
  {
    id: 'lead',
    label: 'Lead',
    tone: 'neutral',
    technicianVisible: false,
    customerVisible: false,
    recommendedNext: ['quoted', 'scheduled', 'canceled'],
    category: 'pre_service',
  },
  {
    id: 'quoted',
    label: 'Quoted',
    tone: 'info',
    technicianVisible: false,
    customerVisible: true,
    recommendedNext: ['scheduled', 'canceled'],
    category: 'pre_service',
  },
  {
    id: 'scheduled',
    label: 'Scheduled',
    tone: 'info',
    technicianVisible: true,
    customerVisible: true,
    recommendedNext: ['dispatched', 'canceled'],
    category: 'pre_service',
  },
  {
    id: 'dispatched',
    label: 'Dispatched',
    tone: 'info',
    technicianVisible: true,
    customerVisible: false,
    recommendedNext: ['enroute', 'canceled'],
    category: 'in_field',
    notifications: [
      { audience: 'owner', channel: 'in_app', templateId: 'tech_assigned', fireMode: 'first_entry' },
    ],
  },
  {
    id: 'enroute',
    label: 'En route',
    shortLabel: 'En route',
    tone: 'info',
    technicianVisible: true,
    customerVisible: true,
    recommendedNext: ['onsite', 'canceled'],
    category: 'in_field',
    notifications: [
      { audience: 'customer', channel: 'sms', templateId: 'tech_on_the_way', fireMode: 'every_entry' },
    ],
  },
  {
    id: 'onsite',
    label: 'On-site',
    shortLabel: 'On-site',
    tone: 'info',
    technicianVisible: true,
    customerVisible: true,
    recommendedNext: ['in_progress', 'canceled'],
    category: 'in_field',
    notifications: [
      { audience: 'customer', channel: 'sms', templateId: 'tech_arrived', fireMode: 'every_entry' },
    ],
  },
  {
    id: 'in_progress',
    label: 'In progress',
    shortLabel: 'Working',
    tone: 'warning',
    technicianVisible: true,
    customerVisible: true,
    recommendedNext: ['waiting_parts', 'awaiting_approval', 'completed', 'canceled'],
    category: 'in_field',
  },
  {
    id: 'waiting_parts',
    label: 'Waiting on parts',
    shortLabel: 'Parts',
    tone: 'warning',
    technicianVisible: true,
    customerVisible: true,
    recommendedNext: ['in_progress', 'canceled'],
    category: 'in_field',
  },
  {
    id: 'awaiting_approval',
    label: 'Awaiting approval',
    shortLabel: 'Approval',
    tone: 'warning',
    technicianVisible: true,
    customerVisible: true,
    recommendedNext: ['in_progress', 'canceled'],
    category: 'in_field',
  },
  {
    id: 'completed',
    label: 'Completed',
    shortLabel: 'Done',
    tone: 'success',
    technicianVisible: true,
    customerVisible: true,
    recommendedNext: ['invoiced', 'paid'],
    category: 'post_service',
    notifications: [
      { audience: 'owner', channel: 'in_app', templateId: 'job_done', fireMode: 'first_entry' },
    ],
  },
  {
    id: 'invoiced',
    label: 'Invoiced',
    tone: 'success',
    technicianVisible: false,
    customerVisible: true,
    recommendedNext: ['paid'],
    category: 'post_service',
    notifications: [
      { audience: 'customer', channel: 'email', templateId: 'invoice_sent', fireMode: 'every_entry' },
    ],
  },
  {
    id: 'paid',
    label: 'Paid',
    tone: 'success',
    technicianVisible: false,
    customerVisible: true,
    recommendedNext: [],
    category: 'terminal',
    notifications: [
      { audience: 'customer', channel: 'sms', templateId: 'thank_you_review_request', fireMode: 'first_entry' },
      { audience: 'owner', channel: 'in_app', templateId: 'payment_received', fireMode: 'every_entry' },
    ],
  },
  {
    id: 'canceled',
    label: 'Canceled',
    tone: 'danger',
    technicianVisible: true,
    customerVisible: true,
    recommendedNext: [],
    category: 'terminal',
  },
];
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/config/jobs/universal-stages.ts
git commit -m "feat(job-lifecycle): UNIVERSAL_STAGES baseline (13 stages w/ notification defaults)"
```

---

## Task 3: Extend `BusinessTypeConfig` with optional `lifecycle` field

**Files:**
- Modify: `src/config/businessTypes/types.ts`

- [ ] **Step 1: Add the import + extend the interface**

Open `src/config/businessTypes/types.ts`. Find the existing `BusinessTypeConfig` interface and add the `lifecycle?` field at the end. Also import `LifecycleExtensions` from the new lifecycle module.

Add to the imports at the top of the file:

```ts
import type { LifecycleExtensions } from '@/config/jobs/lifecycle';
```

Inside the `BusinessTypeConfig` interface, append after `dashboardMetrics`:

```ts
  /** Optional per-vertical contributions to the universal job
   *  lifecycle (substages, applicable-stages filter, stage overrides).
   *  When undefined, the vertical inherits the universal defaults
   *  declared in src/config/jobs/universal-stages.ts. */
  lifecycle?: LifecycleExtensions;
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds. Every existing config (TIRE_CONFIG, MECHANIC_CONFIG, DETAILING_CONFIG) compiles unchanged because `lifecycle` is optional.

- [ ] **Step 3: Commit**

```bash
git add src/config/businessTypes/types.ts
git commit -m "feat(business-types): add optional lifecycle field to BusinessTypeConfig"
```

---

## Task 4: Extend `Job` with optional lifecycle fields

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Read the file to find the Job interface**

Run: `grep -n "^export interface Job " src/types/index.ts`

Use the resulting line number to locate the interface and add the new optional fields at the end of the field list (after the last existing field, before the closing brace).

- [ ] **Step 2: Add the import + the three new optional fields**

At the top of `src/types/index.ts`, add the lifecycle imports next to the existing type imports:

```ts
import type { JobLifecycleStage, LifecycleTransition } from '@/config/jobs/lifecycle';
```

(If the file already uses `import type` blocks, add to an appropriate spot. Keep file-organization style consistent with the existing imports.)

Inside the `Job` interface, append at the bottom (after the existing tail fields like `mileage?`, `vehicleSize?` etc., before the closing `}`):

```ts
  // ─── Job-lifecycle fields (Phase 2.x foundation) ─────────────────
  // All optional. Existing job docs omit them entirely; the read
  // path uses deriveLifecycleStage() to compute a stage from legacy
  // status/paymentStatus/invoiceGenerated. Phase 2.x writers stamp
  // these directly AND dual-write the legacy fields via
  // legacyStatusFromStage(). No Firestore migration.
  lifecycleStage?: JobLifecycleStage;
  /** Substage id (vertical-prefixed convention, e.g. mechanic.parts_on_order). */
  lifecycleSubstage?: string;
  /** Append-only stage transition history. Capped per business
   *  tier via getTransitionRetentionPolicy() at write time. */
  transitions?: ReadonlyArray<LifecycleTransition>;
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: succeeds. The three new fields are optional, so every existing Job consumer compiles unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): Job gains optional lifecycleStage / lifecycleSubstage / transitions"
```

---

## Task 5: Pure runtime helpers

**Files:**
- Create: `src/lib/jobLifecycle.ts`

- [ ] **Step 1: Write the helpers file**

```ts
// src/lib/jobLifecycle.ts
// ═══════════════════════════════════════════════════════════════════
//  Pure runtime helpers for the job-lifecycle system.
//  See docs/superpowers/specs/2026-05-20-job-lifecycle-architecture-design.md
//
//  Design constraints (spec §14.1):
//   - Every function is pure: takes its dependencies as arguments,
//     reads no globals, performs no I/O.
//   - Future test runner can exercise these directly with no
//     mocking required. The repo has no `npm test` script today;
//     the test-ready shape is intentional.
// ═══════════════════════════════════════════════════════════════════

import type {
  Job,
  Settings,
  JobStatus,
  PaymentStatus,
} from '@/types';
import type {
  JobLifecycleStage,
  LifecycleTransition,
  ResolvedLifecycle,
  TransitionRetentionPolicy,
  LegacyMirrorContext,
} from '@/config/jobs/lifecycle';

// ─────────────────────────────────────────────────────────────────
//  Retention policy
// ─────────────────────────────────────────────────────────────────

/**
 * Resolve the transition-history retention policy for a given
 * business. Foundation returns a single tier (inlineCap: 50).
 *
 * Phase 2.x will extend by reading settings.plan / billingTier /
 * featureFlags.* and returning a richer policy without touching
 * any call site. Callers always go through this resolver.
 */
export function getTransitionRetentionPolicy(
  _settings: Settings,
): TransitionRetentionPolicy {
  return { inlineCap: 50 };
}

// ─────────────────────────────────────────────────────────────────
//  Read-side compatibility: derive stage from legacy fields
// ─────────────────────────────────────────────────────────────────

/**
 * Compute the lifecycle stage for any Job — including legacy jobs
 * that have never had `lifecycleStage` written. Mirrors the
 * `resolvePaymentStatus(job)` pattern already used elsewhere.
 *
 * Priority:
 *   1. Explicit lifecycleStage on the job (Phase 2.x writes).
 *   2. Legacy 'Cancelled' status → 'canceled'.
 *   3. Legacy 'Pending' status → 'in_progress' (the most useful
 *      collapse target; pre-service stages aren't representable
 *      from legacy fields, so 'in_progress' is the safest default
 *      for an actively-open job).
 *   4. Legacy 'Completed' status branches on paymentStatus +
 *      invoiceGenerated to disambiguate 'paid' / 'invoiced' /
 *      'completed'.
 */
export function deriveLifecycleStage(job: Job): JobLifecycleStage {
  if (job.lifecycleStage) return job.lifecycleStage;
  if (job.status === 'Cancelled') return 'canceled';
  if (job.status === 'Pending')   return 'in_progress';
  // job.status === 'Completed'
  if (job.paymentStatus === 'Paid') return 'paid';
  if (job.invoiceGenerated)         return 'invoiced';
  return 'completed';
}

// ─────────────────────────────────────────────────────────────────
//  Write-side dual-stamp: derive legacy fields from a stage
// ─────────────────────────────────────────────────────────────────

/**
 * Inverse of deriveLifecycleStage(). Phase 2.x writers stamp BOTH
 * lifecycleStage AND the legacy fields returned by this function
 * so old readers (Dashboard `j.status === 'Completed'` checks,
 * JobDetailModal pill, resolvePaymentStatus(), etc.) keep working.
 *
 * Important: the lifecycle layer does NOT invent accounting flags.
 *   - 'invoiced' sets invoiceGenerated only when invoicingEnabled.
 *     It NEVER auto-sets paymentStatus to 'Pending Payment'.
 *   - 'paid' sets paymentStatus only when paymentTrackingEnabled.
 *   - 'completed' preserves any pre-existing invoiceGenerated /
 *     paymentStatus on the job rather than clobbering them.
 */
export function legacyStatusFromStage(
  stage: JobLifecycleStage,
  ctx: LegacyMirrorContext = {},
): {
  status: JobStatus;
  paymentStatus?: PaymentStatus;
  invoiceGenerated?: boolean;
} {
  switch (stage) {
    case 'canceled':
      return { status: 'Cancelled' };

    case 'paid': {
      const next: { status: JobStatus; paymentStatus?: PaymentStatus; invoiceGenerated?: boolean } = {
        status: 'Completed',
      };
      if (ctx.paymentTrackingEnabled !== false) next.paymentStatus = 'Paid';
      if (ctx.invoicingEnabled !== false) next.invoiceGenerated = true;
      return next;
    }

    case 'invoiced': {
      // Important: do NOT auto-assert 'Pending Payment'. A
      // detailing business that bills cash-on-delivery might
      // generate an invoice and immediately collect payment;
      // stamping 'Pending Payment' here would briefly misrepresent
      // the state. The writer can pass ctx.job to preserve any
      // existing paymentStatus.
      const next: { status: JobStatus; paymentStatus?: PaymentStatus; invoiceGenerated?: boolean } = {
        status: 'Completed',
      };
      if (ctx.invoicingEnabled !== false) next.invoiceGenerated = true;
      if (ctx.job?.paymentStatus) {
        next.paymentStatus = ctx.job.paymentStatus as PaymentStatus;
      }
      return next;
    }

    case 'completed': {
      // Preserve any prior flags rather than clobbering.
      const next: { status: JobStatus; paymentStatus?: PaymentStatus; invoiceGenerated?: boolean } = {
        status: 'Completed',
      };
      if (ctx.job?.invoiceGenerated) next.invoiceGenerated = true;
      if (ctx.job?.paymentStatus) {
        next.paymentStatus = ctx.job.paymentStatus as PaymentStatus;
      }
      return next;
    }

    case 'lead':
    case 'quoted':
    case 'scheduled':
    case 'dispatched':
    case 'enroute':
    case 'onsite':
    case 'in_progress':
    case 'waiting_parts':
    case 'awaiting_approval':
      return { status: 'Pending' };
  }
}

// ─────────────────────────────────────────────────────────────────
//  Advisory transition support (NOT enforcement)
// ─────────────────────────────────────────────────────────────────

/**
 * Is `to` listed in `from`'s recommendedNext for the given resolved
 * lifecycle? Used by writers to set the outOfFlow flag on a
 * LifecycleTransition entry, and by UI components to highlight the
 * "expected next" affordance. Never used to reject a transition.
 *
 * Pass the ResolvedLifecycle (from useActiveLifecycle / resolveLifecycle)
 * so this helper has no implicit context dependency.
 */
export function isRecommendedNext(
  from: JobLifecycleStage | undefined,
  to: JobLifecycleStage,
  resolved: ResolvedLifecycle,
): boolean {
  if (!from) return false;
  const spec = resolved.stageById.get(from);
  if (!spec) return false;
  return spec.recommendedNext.includes(to);
}

/**
 * Append a transition entry to a Job's transitions array, trimming
 * to the inlineCap from the supplied retention policy. Returns a
 * new Job object — the input is not mutated. The caller is
 * responsible for writing the returned Job back to Firestore.
 *
 * Why pass retention policy as an argument rather than reading
 * inside this function: per spec §14.1, foundation utilities have
 * no implicit dependencies. The caller resolves the policy via
 * getTransitionRetentionPolicy(settings) and passes it.
 */
export function appendTransition(
  job: Job,
  entry: LifecycleTransition,
  retentionPolicy: TransitionRetentionPolicy,
): Job {
  const existing = job.transitions ?? [];
  const next = [...existing, entry];
  // Trim from the FRONT (oldest first) to keep the most recent
  // history. The dropped entries can be roll-forward written to a
  // jobs/{id}/transitions subcollection by a future Phase 2.x
  // audit-history feature; foundation simply drops them.
  const cap = Math.max(1, retentionPolicy.inlineCap);
  const trimmed = next.length > cap
    ? next.slice(next.length - cap)
    : next;
  return { ...job, transitions: trimmed };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds. The helpers have no consumers yet — they're available for Phase 2.x writers.

- [ ] **Step 3: Commit**

```bash
git add src/lib/jobLifecycle.ts
git commit -m "feat(job-lifecycle): pure helpers (derive/inverse/appendTransition/retention/isRecommendedNext)"
```

---

## Task 6: Resolver + index

**Files:**
- Create: `src/config/jobs/index.ts`

- [ ] **Step 1: Write the resolver + index**

```ts
// src/config/jobs/index.ts
// ═══════════════════════════════════════════════════════════════════
//  Job-lifecycle registry entry point. Resolves the effective
//  lifecycle for a given BusinessTypeConfig by merging the universal
//  stage baseline with the vertical's LifecycleExtensions.
//
//  Pure function — see spec §14.1. Memoize at the caller via
//  useActiveLifecycle() (src/lib/useActiveLifecycle.ts).
// ═══════════════════════════════════════════════════════════════════

import type { BusinessTypeConfig } from '@/config/businessTypes/registry';
import type {
  JobLifecycleStage,
  ResolvedLifecycle,
  StageSpec,
  SubStageSpec,
} from './lifecycle';
import { UNIVERSAL_STAGES } from './universal-stages';

export function resolveLifecycle(vertical: BusinessTypeConfig): ResolvedLifecycle {
  const ext = vertical.lifecycle;
  const applicable: ReadonlySet<JobLifecycleStage> | null =
    ext?.applicableStages ? new Set(ext.applicableStages) : null;

  // 1. Filter universal stages to those applicable for this vertical.
  // 2. Apply per-stage overrides via shallow merge (deep enough for
  //    our needs — every overridable property is primitive or a
  //    flat array; we never need to merge nested objects).
  const stages: StageSpec[] = UNIVERSAL_STAGES
    .filter((s) => !applicable || applicable.has(s.id))
    .map((base) => {
      const override = ext?.stageOverrides?.[base.id];
      if (!override) return base;
      return {
        ...base,
        ...override,
        id: base.id, // id is never overridable; keep universal
      };
    });

  // Build stageById Map for O(1) lookups by consumers.
  const stageById = new Map<JobLifecycleStage, StageSpec>();
  for (const s of stages) stageById.set(s.id, s);

  // Bucket substages by parent. Substages whose parentStage is NOT
  // in the resolved stages (vertical config error) emit a console
  // warning and get dropped. Substages with duplicate ids also
  // warn; first occurrence wins.
  const substagesByParent = new Map<JobLifecycleStage, SubStageSpec[]>();
  const seenIds = new Set<string>();
  for (const sub of ext?.substages ?? []) {
    if (seenIds.has(sub.id)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[job-lifecycle] duplicate substage id "${sub.id}" in vertical "${vertical.key}" — skipping`,
      );
      continue;
    }
    if (!stageById.has(sub.parentStage)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[job-lifecycle] substage "${sub.id}" refers to parent stage "${sub.parentStage}" which is not active for vertical "${vertical.key}" — skipping`,
      );
      continue;
    }
    seenIds.add(sub.id);
    const bucket = substagesByParent.get(sub.parentStage) ?? [];
    bucket.push(sub);
    substagesByParent.set(sub.parentStage, bucket);
  }

  return {
    stages,
    substagesByParent,
    stageById,
  };
}

// Re-export the type contracts + universal data so consumers can
// `import { ... } from '@/config/jobs'` without knowing the file
// layout under the hood.
export type {
  JobLifecycleStage,
  StageSpec,
  SubStageSpec,
  StageNotificationSpec,
  LifecycleExtensions,
  ResolvedLifecycle,
  LifecycleTransition,
  TransitionRetentionPolicy,
  LegacyMirrorContext,
} from './lifecycle';
export { UNIVERSAL_STAGES } from './universal-stages';
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/config/jobs/index.ts
git commit -m "feat(job-lifecycle): resolveLifecycle() merger + module index"
```

---

## Task 7: React hook `useActiveLifecycle()`

**Files:**
- Create: `src/lib/useActiveLifecycle.ts`

- [ ] **Step 1: Write the hook (mirrors useActiveVertical)**

```ts
// src/lib/useActiveLifecycle.ts
// ═══════════════════════════════════════════════════════════════════
//  React hook returning the resolved job lifecycle for the active
//  business. Parallel to useActiveVertical() — same shape, same
//  memoization pattern. UI consumers call this; the active business
//  type is resolved via useActiveVertical() under the hood.
// ═══════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { useActiveVertical } from '@/lib/useActiveVertical';
import { resolveLifecycle } from '@/config/jobs';
import type { ResolvedLifecycle } from '@/config/jobs';

/**
 * Resolves the active business's effective lifecycle (universal
 * stages + per-vertical extensions). Memoized on the vertical
 * reference so re-renders that don't change the active business
 * don't recompute the merger.
 */
export function useActiveLifecycle(): ResolvedLifecycle {
  const vertical = useActiveVertical();
  return useMemo(() => resolveLifecycle(vertical), [vertical]);
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: succeeds. The hook has no consumers yet — it's available for Phase 2.x readers.

- [ ] **Step 3: Commit**

```bash
git add src/lib/useActiveLifecycle.ts
git commit -m "feat(job-lifecycle): useActiveLifecycle() hook (mirrors useActiveVertical)"
```

---

## Task 8: Per-vertical extension data

**Files:**
- Modify: `src/config/businessTypes/mechanic.ts`
- Modify: `src/config/businessTypes/detailing.ts`
- (Tire: NO change — universal default is correct for tire.)

- [ ] **Step 1: Wire MECHANIC_CONFIG.lifecycle**

Open `src/config/businessTypes/mechanic.ts`. Find the closing brace of the `MECHANIC_CONFIG` object literal. Append the `lifecycle` field at the bottom (after `dashboardMetrics`, before the closing `};`):

```ts
  lifecycle: {
    substages: [
      { id: 'mechanic.parts_on_order',    parentStage: 'waiting_parts', label: 'Parts on order',    technicianVisible: true, customerVisible: true },
      { id: 'mechanic.parts_back_order',  parentStage: 'waiting_parts', label: 'Parts back-order',  technicianVisible: true, customerVisible: true },
      { id: 'mechanic.diagnosis_pending', parentStage: 'in_progress',   label: 'Diagnosing',        technicianVisible: true, customerVisible: false },
    ],
  },
```

- [ ] **Step 2: Wire DETAILING_CONFIG.lifecycle**

Open `src/config/businessTypes/detailing.ts`. Same pattern — append the `lifecycle` field:

```ts
  lifecycle: {
    applicableStages: [
      'lead', 'quoted', 'scheduled', 'dispatched', 'enroute', 'onsite',
      'in_progress', 'awaiting_approval', 'completed', 'invoiced', 'paid', 'canceled',
      // 'waiting_parts' intentionally omitted — detailing has no parts.
    ],
    stageOverrides: {
      awaiting_approval: { label: 'Awaiting customer walk-around', shortLabel: 'Walk-around' },
    },
  },
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: succeeds. Tire's config compiles unchanged (no `lifecycle` field; universal default applies).

- [ ] **Step 4: Commit**

```bash
git add src/config/businessTypes/mechanic.ts src/config/businessTypes/detailing.ts
git commit -m "feat(business-types): mechanic + detailing lifecycle extensions"
```

---

## Task 9: Test-ready assertion file (inert today, wires straight in when a runner lands)

**Files:**
- Create: `tests/jobLifecycle.test.ts`

Repo's `tsconfig.json` excludes `tests/`, so this file does NOT affect `tsc --noEmit` and does NOT need to compile against the project's `paths`. The file uses vitest-style assertion shapes (`describe / it / expect`) so a future `npm install -D vitest` + one-line config addition lights it up.

- [ ] **Step 1: Write the assertion file**

```ts
// tests/jobLifecycle.test.ts
// ═══════════════════════════════════════════════════════════════════
//  Vitest-shape assertions covering every invariant from the
//  job-lifecycle architecture spec. INERT today (no `npm test` script
//  is wired up); shipped now so the moment a runner is added these
//  fire without refactor.
//
//  Run later with: `npx vitest run tests/jobLifecycle.test.ts`
//  (requires installing vitest first — out of scope here).
// ═══════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  deriveLifecycleStage,
  legacyStatusFromStage,
  isRecommendedNext,
  appendTransition,
  getTransitionRetentionPolicy,
} from '../src/lib/jobLifecycle';
import { resolveLifecycle, UNIVERSAL_STAGES } from '../src/config/jobs';
import { TIRE_CONFIG } from '../src/config/businessTypes/tire';
import { MECHANIC_CONFIG } from '../src/config/businessTypes/mechanic';
import { DETAILING_CONFIG } from '../src/config/businessTypes/detailing';
import type { Job, Settings } from '../src/types';
import type { LifecycleTransition } from '../src/config/jobs';

// Helper: a minimal Job stub. Real Job has many more required
// fields; this cast suffices for the lifecycle helpers under test
// because they only read the lifecycle-relevant subset.
function jobStub(over: Partial<Job> = {}): Job {
  return {
    id: 'test', date: '2026-05-20', service: 'Test',
    vehicleType: 'Car', area: '', payment: 'Cash', status: 'Pending',
    source: 'Test', customerName: '', customerPhone: '',
    tireSize: '', qty: 1, revenue: 0, tireCost: 0, materialCost: 0,
    miles: 0, note: '', emergency: false, lateNight: false,
    highway: false, weekend: false, tireSource: 'Inventory',
    inventoryDeductions: null, paymentStatus: 'Paid',
    invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
    ...over,
  } as Job;
}

describe('UNIVERSAL_STAGES', () => {
  it('has exactly 13 entries', () => {
    expect(UNIVERSAL_STAGES.length).toBe(13);
  });

  it('every stage has a unique id', () => {
    const ids = UNIVERSAL_STAGES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('terminal stages have empty recommendedNext', () => {
    const paid = UNIVERSAL_STAGES.find((s) => s.id === 'paid')!;
    const canceled = UNIVERSAL_STAGES.find((s) => s.id === 'canceled')!;
    expect(paid.recommendedNext.length).toBe(0);
    expect(canceled.recommendedNext.length).toBe(0);
  });
});

describe('resolveLifecycle', () => {
  it('tire inherits all 13 universal stages (no extensions)', () => {
    const r = resolveLifecycle(TIRE_CONFIG);
    expect(r.stages.length).toBe(13);
    expect(r.substagesByParent.size).toBe(0);
  });

  it('mechanic inherits all 13 + 3 substages', () => {
    const r = resolveLifecycle(MECHANIC_CONFIG);
    expect(r.stages.length).toBe(13);
    // 2 substages under waiting_parts + 1 under in_progress
    expect(r.substagesByParent.get('waiting_parts')?.length).toBe(2);
    expect(r.substagesByParent.get('in_progress')?.length).toBe(1);
  });

  it('detailing omits waiting_parts (12 stages) + has override label', () => {
    const r = resolveLifecycle(DETAILING_CONFIG);
    expect(r.stages.length).toBe(12);
    expect(r.stageById.has('waiting_parts')).toBe(false);
    const approval = r.stageById.get('awaiting_approval');
    expect(approval?.label).toBe('Awaiting customer walk-around');
  });
});

describe('deriveLifecycleStage (read-side compat)', () => {
  it('explicit lifecycleStage wins', () => {
    const j = jobStub({ lifecycleStage: 'enroute' });
    expect(deriveLifecycleStage(j)).toBe('enroute');
  });

  it("legacy 'Cancelled' status maps to canceled", () => {
    expect(deriveLifecycleStage(jobStub({ status: 'Cancelled' }))).toBe('canceled');
  });

  it("legacy 'Pending' status maps to in_progress", () => {
    expect(deriveLifecycleStage(jobStub({ status: 'Pending' }))).toBe('in_progress');
  });

  it("legacy 'Completed' + paymentStatus 'Paid' maps to paid", () => {
    const j = jobStub({ status: 'Completed', paymentStatus: 'Paid' });
    expect(deriveLifecycleStage(j)).toBe('paid');
  });

  it("legacy 'Completed' + invoiceGenerated maps to invoiced", () => {
    const j = jobStub({
      status: 'Completed',
      paymentStatus: 'Pending Payment',
      invoiceGenerated: true,
    });
    expect(deriveLifecycleStage(j)).toBe('invoiced');
  });

  it("legacy 'Completed' with no payment / invoice maps to completed", () => {
    const j = jobStub({
      status: 'Completed',
      paymentStatus: 'Pending Payment',
      invoiceGenerated: false,
    });
    expect(deriveLifecycleStage(j)).toBe('completed');
  });
});

describe('legacyStatusFromStage (write-side dual-stamp)', () => {
  it("'canceled' → status: 'Cancelled', no payment fields", () => {
    const r = legacyStatusFromStage('canceled');
    expect(r.status).toBe('Cancelled');
    expect(r.paymentStatus).toBeUndefined();
    expect(r.invoiceGenerated).toBeUndefined();
  });

  it("'paid' with default context → Completed + Paid + invoiceGenerated", () => {
    const r = legacyStatusFromStage('paid');
    expect(r.status).toBe('Completed');
    expect(r.paymentStatus).toBe('Paid');
    expect(r.invoiceGenerated).toBe(true);
  });

  it("'paid' with paymentTracking disabled → only status", () => {
    const r = legacyStatusFromStage('paid', { paymentTrackingEnabled: false });
    expect(r.status).toBe('Completed');
    expect(r.paymentStatus).toBeUndefined();
  });

  it("'invoiced' does NOT auto-set paymentStatus", () => {
    const r = legacyStatusFromStage('invoiced');
    expect(r.status).toBe('Completed');
    expect(r.invoiceGenerated).toBe(true);
    expect(r.paymentStatus).toBeUndefined();
  });

  it("'invoiced' preserves prior paymentStatus via ctx.job", () => {
    const r = legacyStatusFromStage('invoiced', {
      job: { paymentStatus: 'Partial Payment' },
    });
    expect(r.paymentStatus).toBe('Partial Payment');
  });

  it("'completed' preserves prior invoiceGenerated", () => {
    const r = legacyStatusFromStage('completed', {
      job: { invoiceGenerated: true },
    });
    expect(r.invoiceGenerated).toBe(true);
  });

  it('every pre-service / in-field stage maps to Pending', () => {
    const stages = ['lead', 'quoted', 'scheduled', 'dispatched', 'enroute',
                    'onsite', 'in_progress', 'waiting_parts', 'awaiting_approval'] as const;
    for (const s of stages) {
      expect(legacyStatusFromStage(s).status).toBe('Pending');
    }
  });
});

describe('isRecommendedNext', () => {
  const r = resolveLifecycle(TIRE_CONFIG);

  it('scheduled → dispatched is recommended', () => {
    expect(isRecommendedNext('scheduled', 'dispatched', r)).toBe(true);
  });

  it('paid → in_progress is NOT recommended (terminal)', () => {
    expect(isRecommendedNext('paid', 'in_progress', r)).toBe(false);
  });

  it('undefined from-stage returns false', () => {
    expect(isRecommendedNext(undefined, 'lead', r)).toBe(false);
  });
});

describe('appendTransition', () => {
  const policy = { inlineCap: 3 };
  const entry = (toStage: 'lead' | 'quoted' | 'scheduled', at: string): LifecycleTransition => ({
    toStage, at, byUid: 'u',
  });

  it('appends to undefined transitions', () => {
    const j = jobStub({});
    const out = appendTransition(j, entry('lead', '2026-01-01T00:00:00Z'), policy);
    expect(out.transitions?.length).toBe(1);
    expect(out.transitions?.[0].toStage).toBe('lead');
  });

  it('preserves immutability (returns new object)', () => {
    const j = jobStub({ transitions: [entry('lead', '2026-01-01T00:00:00Z')] });
    const out = appendTransition(j, entry('quoted', '2026-01-02T00:00:00Z'), policy);
    expect(out).not.toBe(j);
    expect(j.transitions?.length).toBe(1);
    expect(out.transitions?.length).toBe(2);
  });

  it('trims to inlineCap from the front (oldest first)', () => {
    const j = jobStub({
      transitions: [
        entry('lead',      '2026-01-01T00:00:00Z'),
        entry('quoted',    '2026-01-02T00:00:00Z'),
        entry('scheduled', '2026-01-03T00:00:00Z'),
      ],
    });
    const out = appendTransition(j, entry('lead', '2026-01-04T00:00:00Z'), policy);
    expect(out.transitions?.length).toBe(3);
    expect(out.transitions?.[0].at).toBe('2026-01-02T00:00:00Z'); // oldest dropped
    expect(out.transitions?.[2].at).toBe('2026-01-04T00:00:00Z'); // new at end
  });
});

describe('getTransitionRetentionPolicy', () => {
  it('returns inlineCap: 50 for every account in this phase', () => {
    const s = {} as Settings;
    expect(getTransitionRetentionPolicy(s).inlineCap).toBe(50);
  });
});
```

- [ ] **Step 2: Verify the file doesn't break the production build**

Run: `npm run build`
Expected: succeeds. `tests/` is excluded from `tsconfig` so the vitest import is harmless to production builds — it never runs through `tsc`.

- [ ] **Step 3: Commit**

```bash
git add tests/jobLifecycle.test.ts
git commit -m "test(job-lifecycle): vitest-shape assertion suite (inert until runner wired)"
```

---

## Task 10: Final build + smoke verification

- [ ] **Step 1: Final build from a clean slate**

Run: `npm run build`
Expected: 
- TypeScript `--noEmit` exits 0.
- Vite production build emits all chunks.
- No new console warnings besides the existing chunk-size note.

- [ ] **Step 2: Hand-verify the resolver shape via a one-off Node script**

(Optional — useful for sanity but not strictly required since Task 9 encodes the same checks for a future runner.)

```bash
node --experimental-vm-modules --input-type=module -e "
  // This script imports built output to assert shape — only works
  // if you've built. Skip if you trust the type checks.
  import('./dist/assets/index-' + (await import('fs')).readdirSync('./dist/assets').find(f => f.startsWith('index-') && f.endsWith('.js')))
    .then(() => console.log('build imports cleanly'))
    .catch(e => { console.error('import failed:', e); process.exit(1); });
"
```

Expected: prints `build imports cleanly`. Skip on environments without Node's `--experimental-vm-modules` flag.

- [ ] **Step 3: Confirm working tree state**

Run: `git status`
Expected: clean working tree for tracked files. `functions/lib/` and `package-lock.json` remain untracked (pre-existing state from prior phases).

- [ ] **Step 4: Run a final overall commit log review**

Run: `git log --oneline origin/main..HEAD`
Expected: ~10 commits, each focused, each with a descriptive `feat(job-lifecycle):` / `feat(business-types):` / `feat(types):` / `test(job-lifecycle):` prefix.

No final commit needed — verification only.

---

## Phase summary (no code; for reference)

After all 9 implementation tasks land:

| Surface | State |
|---|---|
| `src/config/jobs/lifecycle.ts` | type contracts (8 interfaces / 1 union) |
| `src/config/jobs/universal-stages.ts` | 13-stage baseline with notification defaults |
| `src/config/jobs/index.ts` | `resolveLifecycle()` + re-exports |
| `src/lib/jobLifecycle.ts` | 5 pure helpers |
| `src/lib/useActiveLifecycle.ts` | React hook |
| `src/types/index.ts` | Job gains 3 optional fields |
| `src/config/businessTypes/types.ts` | BusinessTypeConfig gains optional `lifecycle?` |
| `src/config/businessTypes/mechanic.ts` | 3 substages declared |
| `src/config/businessTypes/detailing.ts` | applicableStages filter + 1 stage label override |
| `tests/jobLifecycle.test.ts` | vitest-shape assertions, inert until runner wired |

**Zero behavioral changes for any existing reader or writer.** The foundation is purely additive. Phase 2.x consumers (mechanic full slice, dispatch board, notification dispatcher, technician scheduling, audit reports) all start by importing from `@/lib/jobLifecycle` and `@/lib/useActiveLifecycle`.
