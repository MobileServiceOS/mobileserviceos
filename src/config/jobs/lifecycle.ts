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
