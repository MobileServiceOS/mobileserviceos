// src/components/ActiveTimerBar.tsx
// ═══════════════════════════════════════════════════════════════════
//  Sticky top banner that appears when the current member has an
//  active session somewhere. Mounted in App.tsx between Header and
//  the main content. Renders null when no session is active.
// ═══════════════════════════════════════════════════════════════════

import type { Job } from '@/types';
import { useActiveTimer } from '@/lib/useActiveTimer';
import { formatDuration } from '@/lib/jobTime';

interface Props {
  jobs: ReadonlyArray<Job>;
  onJobTap: (job: Job) => void;
}

export function ActiveTimerBar({ jobs, onJobTap }: Props) {
  const { active, stopTimer } = useActiveTimer(jobs);
  if (!active) return null;

  return (
    <div
      role="region"
      aria-label="Active timer"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 10, padding: '8px 14px',
        background: 'rgba(34,197,94,.12)',
        borderBottom: '1px solid rgba(34,197,94,.35)',
        position: 'sticky', top: 0, zIndex: 50,
      }}
    >
      <button
        type="button"
        onClick={() => onJobTap(active.job)}
        style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 10,
          background: 'transparent', border: 0, padding: 0,
          color: 'var(--t1)', cursor: 'pointer', textAlign: 'left',
          minWidth: 0,
        }}
      >
        <span style={{ color: 'var(--green)', fontSize: 12 }}>●</span>
        <span style={{
          flex: 1, minWidth: 0, whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
          fontSize: 13, fontWeight: 600,
        }}>
          Working: {active.job.service}
          {active.job.customerName ? ` — ${active.job.customerName}` : ''}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t1)' }}>
          {formatDuration(active.elapsedSeconds * 1000)}
        </span>
      </button>
      <button
        type="button"
        onClick={() => { void stopTimer(active.job); }}
        className="btn sm primary"
        style={{ flexShrink: 0 }}
      >STOP</button>
    </div>
  );
}
