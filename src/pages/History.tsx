import { useEffect, useMemo, useState } from 'react';
import type { Job, Settings } from '@/types';
import { PAYMENT_METHOD_LABELS } from '@/types';
import { fmtDate, fmtDateShort, jobGrossProfit, money, paymentPillClass, resolvePaymentStatus, serviceIcon } from '@/lib/utils';
import { useBrand } from '@/context/BrandContext';
import { useMembersDirectory } from '@/lib/useMembersDirectory';
import { useLongPress } from '@/lib/useLongPress';
import { QuickActionSheet } from '@/components/QuickActionSheet';
import { useScopedJobs } from '@/lib/useScopedJobs';
import { usePermissions } from '@/context/MembershipContext';

interface Props {
  jobs: Job[];
  settings: Settings;
  onViewJob: (j: Job) => void;
  onMarkPaid: (j: Job) => void;
  onEditJob: (j: Job) => void;
  onGenerateInvoice: (j: Job) => void;
  onSendInvoice: (j: Job) => void;
  onSendReview: (j: Job) => void;
  onDuplicate: (j: Job) => void;
}

type Filter = 'all' | 'completed' | 'pending' | 'cancelled' | 'unpaid';

export function History({
  jobs: rawJobs, settings, onViewJob, onMarkPaid, onEditJob,
  onGenerateInvoice, onSendInvoice, onSendReview, onDuplicate,
}: Props) {
  // Phase 2.2 Sub-Project B: scope to what the current member sees.
  const jobs = useScopedJobs(rawJobs);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  // Member directory for "Tech: X" attribution on each row.
  const { businessId } = useBrand();
  const { resolveName } = useMembersDirectory(businessId);

  // Quick-action sheet state (long-press → bottom sheet).
  const [sheetJob, setSheetJob] = useState<Job | null>(null);
  // Render budget. The History page used to render the entire job
  // corpus into the DOM; at 500+ jobs that pushes mobile main-thread
  // scroll past 200ms and produces visible jank. Page in chunks of
  // 50 with an explicit "Load more" CTA — keeps the initial render
  // snappy and gives the user a clear control rather than a
  // mysterious cliff. Reset to 50 whenever the search/filter changes.
  const [renderLimit, setRenderLimit] = useState(50);
  useEffect(() => { setRenderLimit(50); }, [query, filter]);

  const filtered = useMemo(() => {
    let list = Array.isArray(jobs) ? [...jobs] : [];
    if (filter === 'completed') list = list.filter((j) => j.status === 'Completed');
    if (filter === 'pending') list = list.filter((j) => j.status === 'Pending');
    if (filter === 'cancelled') list = list.filter((j) => j.status === 'Cancelled');
    if (filter === 'unpaid') list = list.filter((j) => resolvePaymentStatus(j) === 'Pending Payment');
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((j) => {
        const blob = [j.customerName, j.service, j.area, j.tireSize, j.customerPhone, j.fullLocationLabel]
          .filter(Boolean).join(' ').toLowerCase();
        return blob.includes(q);
      });
    }
    list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.id || '').localeCompare(a.id || ''));
    return list;
  }, [jobs, query, filter]);

  return (
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Job History</div>
      <div className="field" style={{ marginBottom: 10 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, service, location…"
        />
      </div>
      <div className="chip-grid" style={{ marginBottom: 8 }}>
        {(['all', 'completed', 'pending', 'cancelled', 'unpaid'] as Filter[]).map((f) => (
          <button key={f} type="button" className={'chip sm' + (filter === f ? ' active' : '')} onClick={() => setFilter(f)}>
            {f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🗂</div>
          <div className="empty-state-title">No jobs found</div>
          <div className="empty-state-sub">Try a different search or filter.</div>
        </div>
      ) : (
        <div className="stack">
          {filtered.slice(0, renderLimit).map((j) => (
            <HistoryJobCard
              key={j.id}
              job={j}
              settings={settings}
              techName={resolveName(j.createdByUid)}
              onView={() => onViewJob(j)}
              onLongPress={() => setSheetJob(j)}
              onMarkPaid={() => onMarkPaid(j)}
            />
          ))}
          {filtered.length > renderLimit && (
            <button
              type="button"
              className="btn secondary"
              onClick={() => setRenderLimit((n) => n + 50)}
              style={{ marginTop: 6 }}
            >
              Load more ({filtered.length - renderLimit} remaining)
            </button>
          )}
        </div>
      )}

      {sheetJob && (
        <QuickActionSheet
          job={sheetJob}
          onClose={() => setSheetJob(null)}
          onView={() => onViewJob(sheetJob)}
          onEdit={() => onEditJob(sheetJob)}
          onDuplicate={() => onDuplicate(sheetJob)}
          onSendInvoice={() => onSendInvoice(sheetJob)}
          onSendReview={() => onSendReview(sheetJob)}
          onMarkPaid={() => onMarkPaid(sheetJob)}
        />
      )}
    </div>
  );
}

/**
 * History row card with own long-press hook.
 *
 * Tap card body = open job detail. Long-press = open quick-action sheet.
 * Unpaid rows show a Mark Paid footer at the bottom.
 * Tire size renders as a small pill badge in the title row.
 * Technician attribution renders below the meta line when known.
 */
function HistoryJobCard({
  job, settings, techName, onView, onLongPress, onMarkPaid,
}: {
  job: Job;
  settings: Settings;
  techName: string | null;
  onView: () => void;
  onLongPress: () => void;
  onMarkPaid: () => void;
}) {
  const pr = jobGrossProfit(job, settings);
  const ps = resolvePaymentStatus(job);
  // Technicians see revenue but not the per-job profit line.
  const canViewProfit = usePermissions().canViewProfit;
  const lp = useLongPress(onLongPress);

  return (
    <div className="job-card card-anim">
      <div
        className="job-card-main"
        onClick={() => { if (lp.firedRef.current) return; onView(); }}
        {...lp.bind}
      >
        <div className="job-icon">{serviceIcon(job.service)}</div>
        <div className="job-main">
          <div className="job-title" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span>{job.customerName || job.service}</span>
            {job.tireSize && (
              <span
                style={{
                  fontSize: 10, fontWeight: 800, color: 'var(--brand-primary)',
                  letterSpacing: '0.3px',
                  padding: '2px 6px', borderRadius: 99,
                  background: 'rgba(200,164,74,.06)',
                  border: '1px solid rgba(200,164,74,.25)',
                }}
              >
                {job.tireSize}
              </span>
            )}
          </div>
          <div className="job-meta">
            {job.service} · {job.fullLocationLabel || job.area || '—'} · {fmtDateShort(job.date)}
          </div>
          {techName && (
            <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 2 }}>
              Tech: {techName}
            </div>
          )}
        </div>
        <div className="job-right">
          <div className="value green">{money(job.revenue)}</div>
          {canViewProfit && (
            <div style={{ fontSize: 10, color: pr >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{money(pr)}</div>
          )}
          <span className={'pill ' + paymentPillClass(ps)} style={{ marginTop: 3, padding: '3px 7px', fontSize: 10 }}>{ps}</span>
          {/* Method badge under the Paid pill. Helps operators scan
              history for "did this job actually clear via Zelle vs.
              cash?" without opening the detail modal. Hidden when
              unpaid or no method recorded (legacy jobs). */}
          {ps === 'Paid' && job.paymentMethod ? (
            <span style={{
              fontSize: 10, fontWeight: 600, color: 'var(--t3)',
              marginTop: 2, letterSpacing: 0.2,
            }}>
              {PAYMENT_METHOD_LABELS[job.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS] ?? job.paymentMethod}
            </span>
          ) : null}
        </div>
      </div>
      {ps !== 'Paid' && ps !== 'Cancelled' && (
        <div style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--border2)',
          background: 'var(--s2)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ flex: 1, fontSize: 11, color: 'var(--t3)' }}>
            Balance due <strong style={{ color: 'var(--amber)' }}>{money(job.revenue)}</strong>
          </div>
          <button
            className="btn sm success"
            onClick={(e) => { e.stopPropagation(); onMarkPaid(); }}
            style={{ fontWeight: 800, minHeight: 36 }}
          >
            Mark Paid
          </button>
        </div>
      )}
    </div>
  );
}

