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

// ─────────────────────────────────────────────────────────────────
//  Stage transition writer (Sub-Project C)
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

// ─────────────────────────────────────────────────────────────────
//  Timeline rendering helper (Sub-Project C)
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
 * Build timeline rows for a job, newest-first. Resolves stage labels
 * via the supplied ResolvedLifecycle (so vertical overrides apply)
 * and actor labels via the supplied resolveName function (which
 * mirrors the useMembersDirectory signature). Pure — fully testable
 * without React.
 */
export function historyEntries(
  job: Pick<Job, 'transitions'>,
  resolved: ResolvedLifecycle,
  resolveName: (uid: string | undefined | null) => string | null,
): HistoryRow[] {
  const entries = job.transitions ?? [];
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
