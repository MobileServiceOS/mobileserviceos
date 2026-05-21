// src/components/JobDetailModal/JobTimer.tsx
// ═══════════════════════════════════════════════════════════════════
//  Inline time-tracking block for JobDetailModal. Shows the active
//  session (if any), a START / STOP button gated by canEditJob, and
//  a list of past sessions with actor labels + durations.
// ═══════════════════════════════════════════════════════════════════

import { useMemo, useState, useEffect } from 'react';
import type { Job, TimeSession, Role } from '@/types';
import { activeSession, totalElapsedMs, formatDuration } from '@/lib/jobTime';
import { canEditJob } from '@/lib/jobPermissions';
import { useActiveTimer } from '@/lib/useActiveTimer';

interface Props {
  job: Job;
  role: Role | null;
  uid: string | null;
  resolveName: (uid: string | undefined | null) => string | null;
}

function formatRange(startIso: string, endIso?: string): string {
  const fmt = (iso: string): string =>
    new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  if (!endIso) return `${fmt(startIso)} → now`;
  return `${fmt(startIso)} → ${fmt(endIso)}`;
}

export function JobTimer({ job, role, uid, resolveName }: Props) {
  const { startTimer, stopTimer } = useActiveTimer([job]);
  const open = activeSession(job);
  const isOpenForMe = !!(open && uid && open.byUid === uid);
  const canEdit = canEditJob(job, role, uid);

  // Tick once per second when this job has an open session so the
  // "currently working" line refreshes. The actual tick STATE value
  // (not the setter) must be threaded into the totalMs computation
  // below so the memo recomputes each tick. Previously the deps
  // included `setTick` (the stable setter), so the memo returned
  // its cached value forever and the duration display was frozen
  // at modal-open time.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [open]);

  // Cheap O(n) sum over timeSessions; no memoization needed and
  // dropping useMemo also removes the dep-array trap that caused
  // the freeze bug. `tick` is read here purely to force a recompute
  // on each tick — totalElapsedMs uses Date.now() internally for
  // the open session.
  void tick;
  const totalMs = totalElapsedMs(job);

  const closedSessions = useMemo(
    () => (job.timeSessions ?? []).filter(
      (s: TimeSession) => s.endAt !== undefined && s.endAt !== null,
    ),
    [job.timeSessions],
  );

  return (
    <div className="form-group" style={{ marginBottom: 12 }}>
      <div className="form-group-title">Time on this job</div>

      {open ? (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 12px', marginBottom: 8,
          background: 'rgba(34,197,94,.08)',
          border: '1px solid rgba(34,197,94,.30)',
          borderRadius: 8,
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)' }}>
              ● Currently working
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--t1)' }}>
              {formatDuration(totalMs)}
            </div>
          </div>
          {canEdit && isOpenForMe && (
            <button
              type="button"
              className="btn primary"
              onClick={() => { void stopTimer(job); }}
            >STOP</button>
          )}
        </div>
      ) : (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 12px', marginBottom: 8,
        }}>
          <div style={{ fontSize: 13, color: 'var(--t2)' }}>
            {totalMs > 0
              ? `Past sessions: ${formatDuration(totalMs)} total`
              : 'No time logged yet.'}
          </div>
          {canEdit && (
            <button
              type="button"
              className="btn primary"
              onClick={() => { void startTimer(job); }}
            >▶ START WORK</button>
          )}
        </div>
      )}

      {closedSessions.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Past sessions
          </div>
          {closedSessions.slice().reverse().map((s, i) => {
            const start = new Date(s.startAt).getTime();
            const end = s.endAt ? new Date(s.endAt).getTime() : Date.now();
            const ms = Math.max(0, end - start);
            const name = resolveName(s.byUid) || 'Unknown';
            return (
              <div
                key={i}
                style={{
                  display: 'flex', alignItems: 'baseline', gap: 8,
                  padding: '6px 0',
                  borderTop: i === 0 ? 0 : '1px solid var(--border)',
                  fontSize: 13,
                }}
              >
                <span style={{ fontWeight: 700, minWidth: 64 }}>{formatDuration(ms)}</span>
                <span style={{ flex: 1, color: 'var(--t2)' }}>
                  {name} · {formatRange(s.startAt, s.endAt)}
                </span>
              </div>
            );
          })}
          <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 6, textAlign: 'right' }}>
            Total billed: {formatDuration(totalMs)}
          </div>
        </div>
      )}
    </div>
  );
}
