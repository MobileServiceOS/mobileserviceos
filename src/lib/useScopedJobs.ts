// src/lib/useScopedJobs.ts
// ═══════════════════════════════════════════════════════════════════
//  React hook returning the job list filtered to what the current
//  member is allowed to see. Pass-through for owner/admin (cloned to
//  preserve the immutability contract). For technicians, applies the
//  assigned-OR-created union filter.
//
//  Memoized on (jobs, role, member.uid) so re-renders don't re-filter
//  when nothing relevant changed.
// ═══════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import type { Job } from '@/types';
import { useMembership } from '@/context/MembershipContext';
import { scopeJobsByRole } from '@/lib/jobPermissions';

export function useScopedJobs(jobs: ReadonlyArray<Job>): Job[] {
  const { role, member } = useMembership();
  return useMemo(
    () => scopeJobsByRole(jobs, role, member?.uid),
    [jobs, role, member?.uid],
  );
}
