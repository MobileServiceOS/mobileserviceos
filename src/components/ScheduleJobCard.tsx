// src/components/ScheduleJobCard.tsx
// ═══════════════════════════════════════════════════════════════════
//  Compact, mobile-first card for a booked job in the scheduling
//  pipeline (Scheduled / En Route / In Progress). Shared by the home
//  screen's "Today's Schedule" (time only) and the Jobs tab's
//  "Upcoming" list (full date+time). Tap opens the job detail so the
//  operator can advance its status as the day moves.
// ═══════════════════════════════════════════════════════════════════

import type { Job, JobStatus } from '@/types';
import { fmtApptTime, fmtApptDateTime } from '@/lib/utils';

// Status badge palette — readable on the dark app surface at a glance.
const STATUS_BADGE: Record<string, { bg: string; fg: string }> = {
  'Scheduled':   { bg: 'rgba(59,130,246,.16)',  fg: '#60a5fa' }, // blue
  'En Route':    { bg: 'rgba(242,106,33,.18)',  fg: '#f6a04d' }, // orange
  'In Progress': { bg: 'rgba(34,197,94,.16)',   fg: '#4ade80' }, // green
};

export function ScheduledStatusBadge({ status }: { status: JobStatus }) {
  const c = STATUS_BADGE[status] || { bg: 'var(--s3)', fg: 'var(--t2)' };
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase',
      padding: '3px 8px', borderRadius: 999, background: c.bg, color: c.fg,
      whiteSpace: 'nowrap', flexShrink: 0,
    }}>{status}</span>
  );
}

export function ScheduleJobCard({ job, onTap, showDate = false }: {
  job: Job;
  onTap: () => void;
  /** Upcoming list shows the full date; Today's Schedule shows time only. */
  showDate?: boolean;
}) {
  const when = showDate ? fmtApptDateTime(job.appointmentDate) : fmtApptTime(job.appointmentDate);
  const city = (job.city || job.fullLocationLabel || job.area || '').trim() || 'No location';
  const vehicle = (job.vehicleMakeModel || job.vehicleType || '').trim();
  const size = (job.tireSize || '').trim();
  const sub = [vehicle, size].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      className="press-scale"
      onClick={onTap}
      style={{
        width: '100%', textAlign: 'left', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px', borderRadius: 12,
        background: 'var(--s2)', border: '1px solid var(--border)',
      }}
    >
      {/* Time block — the at-a-glance anchor */}
      <div style={{ flexShrink: 0, minWidth: 64 }}>
        <div style={{ fontSize: showDate ? 13 : 16, fontWeight: 800, color: 'var(--brand-primary)', lineHeight: 1.1 }}>
          {when || '—'}
        </div>
      </div>
      {/* Location + vehicle/size */}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 14, fontWeight: 700, color: 'var(--t1)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{city}</div>
        {sub && (
          <div style={{
            fontSize: 12, color: 'var(--t3)', marginTop: 2,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{sub}</div>
        )}
      </div>
      <ScheduledStatusBadge status={job.status} />
    </button>
  );
}
