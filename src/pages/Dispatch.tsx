import { useEffect, useMemo, useState } from 'react';
import type { Job, MemberDoc, PresenceDoc, TechStatus, Settings } from '@/types';
import { TECH_STATUS_LABELS, TECH_STATUS_TONE } from '@/types';
import { useBrand } from '@/context/BrandContext';
import { useBusinessMembers } from '@/lib/useBusinessMembers';
import { subscribeToPresence, presenceRelative, isPresenceStale } from '@/lib/presence';
import { fmtDate, money, resolvePaymentStatus, serviceIcon } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────────────
//  Dispatch — owner/admin field-ops dashboard. Groups active jobs by
//  their assigned technician and shows each tech's current work
//  status side-by-side, so the dispatcher can see at a glance:
//
//    • who's available right now
//    • who's en-route / on-site
//    • how many open jobs each tech is carrying
//    • when a tech's status last updated (stale → dim)
//    • unassigned jobs that need a tech
//
//  All data is live — presence via subscribeToPresence,
//  members via useBusinessMembers, jobs from the parent. Mounted
//  via a new "dispatch" tab routed from MoreSheet (owner+admin only).
// ─────────────────────────────────────────────────────────────────────

interface Props {
  jobs: Job[];
  settings: Settings;
  onViewJob?: (j: Job) => void;
}

export function Dispatch({ jobs, settings: _settings, onViewJob }: Props) {
  const { businessId } = useBrand();
  const members = useBusinessMembers();
  const [presence, setPresence] = useState<Map<string, PresenceDoc>>(new Map());

  useEffect(() => {
    return subscribeToPresence(businessId, setPresence);
  }, [businessId]);

  // Active jobs = anything not Completed and not Cancelled, so the
  // dispatcher sees the live workload.
  const activeJobs = useMemo(
    () => jobs.filter((j) => j.status !== 'Completed' && j.status !== 'Cancelled'),
    [jobs],
  );

  // Group active jobs by assignedToUid. Anything without an assignee
  // lands in the 'unassigned' bucket and gets surfaced at the top of
  // the board so the dispatcher can place it.
  const jobsByTech = useMemo(() => {
    const m = new Map<string, Job[]>();
    for (const j of activeJobs) {
      const uid = j.assignedToUid || 'unassigned';
      const arr = m.get(uid) || [];
      arr.push(j);
      m.set(uid, arr);
    }
    return m;
  }, [activeJobs]);

  const unassigned = jobsByTech.get('unassigned') || [];

  // Order technicians: active workload first (count desc),
  // then on-status techs without jobs, then off-duty / offline.
  const techMembers = useMemo(() => {
    return members
      .filter((m): m is MemberDoc & { uid: string } => Boolean(m.uid && m.status !== 'disabled'))
      .map((m) => {
        const p = presence.get(m.uid);
        const jobCount = (jobsByTech.get(m.uid) || []).length;
        return { member: m, presence: p, jobCount };
      })
      .sort((a, b) => {
        // Off-duty / offline last
        const aOff = !a.presence || a.presence.status === 'off_duty' ? 1 : 0;
        const bOff = !b.presence || b.presence.status === 'off_duty' ? 1 : 0;
        if (aOff !== bOff) return aOff - bOff;
        // Higher job count first
        if (b.jobCount !== a.jobCount) return b.jobCount - a.jobCount;
        return (a.member.displayName || a.member.email).localeCompare(
          b.member.displayName || b.member.email,
        );
      });
  }, [members, presence, jobsByTech]);

  // Summary KPIs at the top of the board.
  const availableCount = techMembers.filter((t) => t.presence?.status === 'available').length;
  const enrouteCount   = techMembers.filter((t) => t.presence?.status === 'enroute').length;
  const onsiteCount    = techMembers.filter((t) => t.presence?.status === 'onsite').length;

  return (
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Dispatch</div>

      <div className="kpi-grid three" style={{ marginBottom: 14 }}>
        <div className="kpi">
          <div className="kpi-label">Available</div>
          <div className="kpi-value" style={{ color: availableCount > 0 ? 'var(--green)' : 'var(--t2)' }}>
            {availableCount}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">In field</div>
          <div className="kpi-value">{enrouteCount + onsiteCount}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Active jobs</div>
          <div className="kpi-value" style={{ color: activeJobs.length > 0 ? 'var(--brand-primary)' : 'var(--t2)' }}>
            {activeJobs.length}
          </div>
        </div>
      </div>

      {/* Unassigned bucket — surfaced first so the dispatcher's
          eye goes to "who needs a tech" before anything else. */}
      {unassigned.length > 0 && (
        <>
          <div className="section-label" style={{ color: 'var(--red)' }}>
            Unassigned ({unassigned.length})
          </div>
          <div className="stack" style={{ marginBottom: 14 }}>
            {unassigned.map((j) => (
              <JobRow key={j.id} job={j} onTap={() => onViewJob?.(j)} />
            ))}
          </div>
        </>
      )}

      <div className="section-label">Technicians</div>
      {techMembers.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">No technicians on the team yet</div>
          <div className="empty-state-sub">Invite techs from Settings → Team Management.</div>
        </div>
      ) : (
        <div className="stack">
          {techMembers.map(({ member, presence: p, jobCount }) => (
            <TechCard
              key={member.uid}
              member={member}
              presence={p}
              jobs={jobsByTech.get(member.uid!) || []}
              jobCount={jobCount}
              onViewJob={onViewJob}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tech card ─────────────────────────────────────────────────────

function TechCard({
  member, presence, jobs, jobCount, onViewJob,
}: {
  member: MemberDoc;
  presence: PresenceDoc | undefined;
  jobs: Job[];
  jobCount: number;
  onViewJob?: (j: Job) => void;
}) {
  const [expanded, setExpanded] = useState(jobCount > 0);
  const status: TechStatus | null = presence?.status || null;
  const tone = status ? TECH_STATUS_TONE[status] : 'neutral';
  const stale = isPresenceStale(presence?.updatedAt);

  return (
    <div className="card card-anim">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          width: '100%', padding: '12px 14px',
          background: 'transparent', border: 'none',
          color: 'var(--t1)', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 12, height: 12, borderRadius: 999, flexShrink: 0,
            opacity: stale ? 0.4 : 1,
            background: tone === 'green'  ? '#22c55e'
                      : tone === 'amber'  ? '#f59e0b'
                      : tone === 'red'    ? '#ef4444'
                      : 'var(--t3)',
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 700,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {member.displayName || member.email}
          </div>
          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
            {status ? TECH_STATUS_LABELS[status] : 'Offline'}
            {presence ? ` · ${presenceRelative(presence.updatedAt)}` : ''}
            {stale && status ? ' · stale' : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontSize: 16, fontWeight: 800,
            color: jobCount > 0 ? 'var(--brand-primary)' : 'var(--t3)',
          }}>
            {jobCount}
          </div>
          <div style={{ fontSize: 9, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1 }}>
            {jobCount === 1 ? 'job' : 'jobs'}
          </div>
        </div>
      </button>

      {expanded && jobs.length > 0 && (
        <div style={{ padding: '0 14px 12px' }}>
          {jobs.map((j) => (
            <JobRow key={j.id} job={j} onTap={() => onViewJob?.(j)} compact />
          ))}
        </div>
      )}
      {expanded && jobs.length === 0 && (
        <div style={{ padding: '0 14px 12px', fontSize: 11, color: 'var(--t3)' }}>
          No active jobs assigned.
        </div>
      )}
    </div>
  );
}

// ─── Job row ───────────────────────────────────────────────────────

function JobRow({
  job, onTap, compact = false,
}: { job: Job; onTap?: () => void; compact?: boolean }) {
  const ps = resolvePaymentStatus(job);
  return (
    <button
      type="button"
      onClick={onTap}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: compact ? '8px 0' : '12px 14px',
        borderTop: compact ? '1px solid var(--border2)' : 'none',
        background: compact ? 'transparent' : 'var(--s2)',
        border: compact ? 'none' : '1px solid var(--border)',
        borderRadius: compact ? 0 : 10,
        marginBottom: compact ? 0 : 8,
        color: 'var(--t1)', cursor: 'pointer', textAlign: 'left',
      }}
    >
      <span style={{ fontSize: 18 }}>{serviceIcon(job.service)}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {job.customerName || job.service}
        </div>
        <div style={{ fontSize: 11, color: 'var(--t3)' }}>
          {job.service} · {job.date ? fmtDate(job.date) : '—'}
          {job.fullLocationLabel ? ` · ${job.fullLocationLabel}` : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="value green num" style={{ fontSize: 13 }}>
          {money(job.revenue)}
        </div>
        <div style={{ fontSize: 9, color: ps === 'Paid' ? 'var(--green)' : 'var(--red)' }}>
          {ps}
        </div>
      </div>
    </button>
  );
}
