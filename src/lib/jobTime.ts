// src/lib/jobTime.ts
// ═══════════════════════════════════════════════════════════════════
//  Pure helpers for the per-job time-tracking system. Every function
//  is pure (no I/O, no globals). The React hook + UI components in
//  this phase consume these helpers via useActiveTimer.
//
//  Granularity: laborHours auto-fill rounds UP to 0.25-hour
//  increments (15-minute service-billing convention). See
//  suggestedLaborHours().
// ═══════════════════════════════════════════════════════════════════

import type { Job, TimeSession } from '@/types';

/**
 * Return the open session (endAt undefined) on a job, or undefined
 * when none exists. When multiple open sessions exist (defensive —
 * shouldn't happen given the concurrency rule, but the schema
 * doesn't enforce it), returns the most recently started one.
 */
export function activeSession(
  job: Pick<Job, 'timeSessions'>,
): TimeSession | undefined {
  const sessions = job.timeSessions ?? [];
  let latest: TimeSession | undefined;
  for (const s of sessions) {
    if (s.endAt === undefined || s.endAt === null) {
      if (!latest || s.startAt > latest.startAt) {
        latest = s;
      }
    }
  }
  return latest;
}

/**
 * Total elapsed milliseconds across all sessions on this job. Closed
 * sessions contribute (endAt - startAt). The open session (if any)
 * contributes (now - startAt). Empty / undefined sessions → 0.
 */
export function totalElapsedMs(
  job: Pick<Job, 'timeSessions'>,
  now: Date = new Date(),
): number {
  const sessions = job.timeSessions ?? [];
  let total = 0;
  for (const s of sessions) {
    const start = new Date(s.startAt).getTime();
    if (!Number.isFinite(start)) continue;
    const end = s.endAt ? new Date(s.endAt).getTime() : now.getTime();
    if (!Number.isFinite(end)) continue;
    const delta = end - start;
    if (delta > 0) total += delta;
  }
  return total;
}

/**
 * Append a new open session to a job. Returns a NEW job — input is
 * not mutated. Does NOT close any existing open session — caller is
 * responsible for enforcing the concurrency rule.
 */
export function startSession(
  job: Job,
  byUid: string,
  now: Date = new Date(),
): Job {
  const session: TimeSession = {
    startAt: now.toISOString(),
    byUid,
  };
  const existing = job.timeSessions ?? [];
  return { ...job, timeSessions: [...existing, session] };
}

/**
 * Stamp endAt on the most recent open session (if any). Returns a
 * NEW job — input is not mutated. When no open session exists,
 * returns the same job reference unchanged.
 */
export function stopActiveSession(
  job: Job,
  now: Date = new Date(),
): Job {
  const sessions = job.timeSessions ?? [];
  if (sessions.length === 0) return job;
  let openIdx = -1;
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].endAt === undefined || sessions[i].endAt === null) {
      if (openIdx === -1 || sessions[i].startAt > sessions[openIdx].startAt) {
        openIdx = i;
      }
    }
  }
  if (openIdx === -1) return job;
  const updated = sessions.slice();
  updated[openIdx] = { ...sessions[openIdx], endAt: now.toISOString() };
  return { ...job, timeSessions: updated };
}

/**
 * Round elapsed milliseconds UP to 0.25-hour increments. Standard
 * service-billing granularity. 0 ms → 0; 1 ms → 0.25; 15 min → 0.25;
 * 16 min → 0.5; exactly 1 hour → 1.0; 1 hour 1 min → 1.25.
 */
export function suggestedLaborHours(totalMs: number): number {
  if (totalMs <= 0) return 0;
  const hours = totalMs / 3_600_000;
  return Math.ceil(hours * 4) / 4;
}

/**
 * Scan a list of jobs for the first open session whose byUid matches
 * the given uid. Returns null when no match. Closed sessions are
 * ignored. Used by useActiveTimer to derive the "currently working"
 * state across the whole business.
 */
export function findActiveSessionAcrossJobs(
  jobs: ReadonlyArray<Job>,
  uid: string | null | undefined,
): { job: Job; session: TimeSession } | null {
  if (!uid) return null;
  for (const job of jobs) {
    const sessions = job.timeSessions ?? [];
    for (const s of sessions) {
      if (s.byUid === uid && (s.endAt === undefined || s.endAt === null)) {
        return { job, session: s };
      }
    }
  }
  return null;
}

/**
 * Human-readable duration string. "1h 23m" / "42m" / "3s" / "0s".
 * Used by ActiveTimerBar + JobTimer.
 */
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
