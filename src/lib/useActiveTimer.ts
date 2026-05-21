// src/lib/useActiveTimer.ts
// ═══════════════════════════════════════════════════════════════════
//  React hook returning the current member's active timer (if any)
//  + start/stop callbacks. Enforces the concurrency rule (one active
//  session per tech across all visible jobs) by auto-closing any
//  existing open session on a different job when startTimer fires.
//
//  Callers pass the job list explicitly — this lets us mount the
//  hook in both App.tsx (which holds the full jobs array) and inside
//  JobDetailModal (which only knows about its own job, but doesn't
//  need cross-job visibility to start/stop on that specific job).
// ═══════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { _auth, _db, scopedCol, fbSetFast } from '@/lib/firebase';
import { useMembership } from '@/context/MembershipContext';
import { useActiveVertical } from '@/lib/useActiveVertical';
import { addToast, addActionToast } from '@/lib/toast';
import { humanizeFirestoreError } from '@/lib/firebaseErrors';
import {
  startSession,
  stopActiveSession,
  findActiveSessionAcrossJobs,
  totalElapsedMs,
  suggestedLaborHours,
  formatDuration,
} from '@/lib/jobTime';
import type { Job, TimeSession } from '@/types';

// Silence unused import lint when _auth isn't reached.
void _auth;
void _db;

export interface UseActiveTimerResult {
  active: {
    job: Job;
    session: TimeSession;
    elapsedSeconds: number;
  } | null;
  startTimer: (job: Job) => Promise<void>;
  stopTimer: (job: Job) => Promise<void>;
}

export function useActiveTimer(jobs: ReadonlyArray<Job>): UseActiveTimerResult {
  const { member } = useMembership();
  const uid = member?.uid;
  const businessId = member?.businessId;
  // laborHours feeds the mechanic labor_parts pricing model only.
  // Tire (flat) and detailing (package_multiplier) ignore it — so
  // the "Fill labor hours" action on the stop-timer toast is a
  // no-op for those verticals and shouldn't be offered.
  const isMechanic = useActiveVertical().key === 'mechanic';

  const active = useMemo(
    () => findActiveSessionAcrossJobs(jobs, uid),
    [jobs, uid],
  );

  // Tick every second when there's an active session so elapsedSeconds
  // updates for re-render.
  const [tickCount, setTickCount] = useState(0);
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => setTickCount((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [active]);

  const elapsedSeconds = useMemo(() => {
    if (!active) return 0;
    const start = new Date(active.session.startAt).getTime();
    if (!Number.isFinite(start)) return 0;
    return Math.max(0, Math.floor((Date.now() - start) / 1000));
    // tickCount is intentionally a dep so the memo recomputes each tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tickCount]);

  // Guard against double-writes during async snapshot reconciliation.
  const writingRef = useRef(false);

  const writeJob = useCallback(async (j: Job): Promise<void> => {
    if (!businessId) return;
    const col = scopedCol(businessId, 'jobs');
    if (!col) return;
    await fbSetFast(col, j.id, j);
  }, [businessId]);

  const stopTimer = useCallback(async (job: Job): Promise<void> => {
    if (!uid || writingRef.current) return;
    writingRef.current = true;
    try {
      const stopped = stopActiveSession(job);
      if (stopped === job) return; // no open session — no-op
      await writeJob(stopped);

      const totalMs = totalElapsedMs(stopped);
      const suggested = suggestedLaborHours(totalMs);
      const existing = Number(job.laborHours || 0);
      // Offer the labor-hours autofill ONLY for mechanic jobs —
      // it's a no-op for tire / detailing pricing models.
      if (isMechanic && suggested > existing) {
        addActionToast(
          `Stopped at ${formatDuration(totalMs)}.`,
          {
            label: 'Fill labor hours',
            onTap: () => {
              const withHours: Job = { ...stopped, laborHours: suggested };
              void writeJob(withHours);
            },
          },
          'success',
        );
      } else {
        addToast(`Stopped at ${formatDuration(totalMs)}.`, 'success');
      }
    } catch (e) {
      console.error('[useActiveTimer.stopTimer]', e);
      addToast(`Stop failed: ${humanizeFirestoreError(e)}`, 'error');
    } finally {
      writingRef.current = false;
    }
  }, [uid, writeJob, isMechanic]);

  const startTimer = useCallback(async (job: Job): Promise<void> => {
    if (!uid || writingRef.current) return;
    writingRef.current = true;
    try {
      // Concurrency rule: close any existing open session on a
      // different job for this uid before starting on this one.
      if (active && active.job.id !== job.id) {
        const totalMs = totalElapsedMs(active.job);
        const stoppedPrev = stopActiveSession(active.job);
        await writeJob(stoppedPrev);
        addToast(
          `Stopped ${active.job.service} at ${formatDuration(totalMs)}. Started ${job.service}.`,
          'info',
        );
      } else if (active && active.job.id === job.id) {
        // Already running on this job — silent no-op.
        return;
      }

      const started = startSession(job, uid);
      await writeJob(started);
    } catch (e) {
      console.error('[useActiveTimer.startTimer]', e);
      addToast(`Start failed: ${humanizeFirestoreError(e)}`, 'error');
    } finally {
      writingRef.current = false;
    }
  }, [uid, active, writeJob]);

  return {
    active: active
      ? { job: active.job, session: active.session, elapsedSeconds }
      : null,
    startTimer,
    stopTimer,
  };
}
