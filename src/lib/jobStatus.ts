// ═══════════════════════════════════════════════════════════════════
//  src/lib/jobStatus.ts — job scheduling pipeline (single source of truth)
//
//  The forward pipeline a booked job moves through:
//      Scheduled → En Route → In Progress → Completed
//  plus Cancelled (terminal) and the legacy 'Pending' (work done, unpaid).
//
//  Rules enforced here so every call site agrees:
//    - Status can only move FORWARD along the pipeline (never backward).
//    - Scheduled-pipeline jobs (Scheduled / En Route / In Progress) are
//      "not done yet": excluded from revenue, profit, and inventory
//      deduction until they reach Completed.
//
//  Pure functions only — no React, no Firestore.
// ═══════════════════════════════════════════════════════════════════

import type { JobStatus } from '@/types';

/** Forward order of the scheduling pipeline through to completion. */
export const JOB_STATUS_ORDER: JobStatus[] = ['Scheduled', 'En Route', 'In Progress', 'Completed'];

/** The pre-completion pipeline states — booked/active but not yet done. */
export const SCHEDULED_PIPELINE: JobStatus[] = ['Scheduled', 'En Route', 'In Progress'];

/**
 * True when the job is booked/active but not yet completed. These jobs
 * must NOT count toward revenue, profit, or inventory deduction — they
 * haven't happened yet. Used to extend the deny-list revenue filters
 * (Insights, customer profiles) which previously only excluded Cancelled.
 */
export function isScheduledPipeline(status: JobStatus | null | undefined): boolean {
  return status != null && (SCHEDULED_PIPELINE as readonly string[]).includes(status);
}

/**
 * The next status when advancing one step, or null at the end of the
 * pipeline / for terminal (Completed, Cancelled) and legacy (Pending)
 * states. Drives the one-tap advance button.
 */
export function nextStatus(status: JobStatus | null | undefined): JobStatus | null {
  const i = JOB_STATUS_ORDER.indexOf(status as JobStatus);
  if (i === -1 || i >= JOB_STATUS_ORDER.length - 1) return null;
  return JOB_STATUS_ORDER[i + 1];
}

/**
 * Button copy for the one-tap advance: "Mark En Route" / "Mark In
 * Progress" / "Mark Complete". Null when there's nothing to advance to.
 */
export function nextStatusLabel(status: JobStatus | null | undefined): string | null {
  const next = nextStatus(status);
  if (!next) return null;
  return `Mark ${next === 'Completed' ? 'Complete' : next}`;
}

/**
 * Forward-only transition guard. A move is allowed when the target is
 * strictly later in the pipeline than the current status, OR a non-
 * terminal job is being Cancelled. Backward moves, no-ops, and moves
 * out of a terminal state return false.
 *
 *   canAdvanceStatus('Scheduled', 'En Route')   → true
 *   canAdvanceStatus('En Route', 'Scheduled')   → false (backward)
 *   canAdvanceStatus('Completed', 'In Progress') → false (terminal)
 *   canAdvanceStatus('Scheduled', 'Cancelled')  → true
 */
export function canAdvanceStatus(from: JobStatus | null | undefined, to: JobStatus): boolean {
  if (from === to) return false;
  if (from === 'Completed' || from === 'Cancelled') return false; // terminal — no exit
  if (to === 'Cancelled') return true; // cancel allowed from any non-terminal state
  const toI = JOB_STATUS_ORDER.indexOf(to);
  if (toI === -1) return false; // target not a forward pipeline state (e.g. legacy Pending)
  const fromI = JOB_STATUS_ORDER.indexOf(from as JobStatus);
  // Legacy 'Pending' (outside the pipeline) may only resolve to Completed.
  if (fromI === -1) return to === 'Completed';
  return toI > fromI; // strictly forward
}
