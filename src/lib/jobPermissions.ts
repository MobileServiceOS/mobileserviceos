// src/lib/jobPermissions.ts
// ═══════════════════════════════════════════════════════════════════
//  Pure helpers for the multi-user job-scoping + assignment system.
//  See docs/superpowers/specs/2026-05-21-multi-user-foundation-design.md
//  Every function is pure: no I/O, no globals, no React.
// ═══════════════════════════════════════════════════════════════════

import type { Job, Role, MemberDoc } from '@/types';
import type { JobLifecycleStage } from '@/config/jobs/lifecycle';

/**
 * Scope the job list to what the given role + uid is allowed to see.
 * Owner / admin: pass-through (full list, defensively cloned).
 * Technician: union of jobs they're assigned to OR created.
 * No role / null uid: empty (defensive).
 */
export function scopeJobsByRole(
  jobs: ReadonlyArray<Job>,
  role: Role | null | undefined,
  uid: string | null | undefined,
): Job[] {
  if (role === 'owner' || role === 'admin') return [...jobs];
  if (role === 'technician' && uid) {
    return jobs.filter(
      (j) => j.assignedToUid === uid || j.createdByUid === uid,
    );
  }
  return [];
}

/**
 * Can the given role + uid edit this job?
 * Owner / admin: always.
 * Technician: only when they're the assignee or creator.
 */
export function canEditJob(
  job: Pick<Job, 'assignedToUid' | 'createdByUid'>,
  role: Role | null | undefined,
  uid: string | null | undefined,
): boolean {
  if (role === 'owner' || role === 'admin') return true;
  if (role !== 'technician' || !uid) return false;
  return job.assignedToUid === uid || job.createdByUid === uid;
}

/**
 * Can the given role delete jobs? Delete is owner/admin only —
 * techs never delete, regardless of ownership of the job.
 */
export function canDeleteJob(role: Role | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/** Special assignee option representing "no one." Use as the
 *  `Job.assignedToUid` value when the picker is left on Unassigned. */
export const UNASSIGNED = '' as const;

export interface AssigneeOption {
  uid: string; // empty string for UNASSIGNED
  label: string;
  isSelf?: boolean;
}

/**
 * Build the picker options for the assignment dropdown. Returns:
 *   - "Me" first (current uid)
 *   - "Unassigned" second
 *   - Each active technician (sorted alphabetically by displayName /
 *     email / uid)
 *
 * Members with status !== 'active' are filtered out. The current
 * user is excluded from the technician list because they appear as
 * "Me" instead.
 */
export function assignableMembers(
  members: ReadonlyArray<MemberDoc>,
  currentUid: string,
): AssigneeOption[] {
  const techs = members
    .filter((m): m is MemberDoc & { uid: string } =>
      m.status === 'active' &&
      m.role === 'technician' &&
      typeof m.uid === 'string' &&
      m.uid !== '' &&
      m.uid !== currentUid,
    )
    .sort((a, b) =>
      (a.displayName || a.email || a.uid)
        .localeCompare(b.displayName || b.email || b.uid),
    )
    .map<AssigneeOption>((m) => ({
      uid: m.uid,
      label: m.displayName || m.email || m.uid,
    }));

  return [
    { uid: currentUid, label: 'Me', isSelf: true },
    { uid: UNASSIGNED, label: 'Unassigned' },
    ...techs,
  ];
}

// ─────────────────────────────────────────────────────────────────
//  Stage transition gating (Sub-Project C)
// ─────────────────────────────────────────────────────────────────

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
