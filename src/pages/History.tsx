import { useEffect, useMemo, useState } from 'react';
import type { Job, Settings } from '@/types';
import { PAYMENT_METHOD_LABELS } from '@/types';
import { fmtDate, fmtDateShort, jobGrossProfit, money, paymentPillClass, resolvePaymentStatus } from '@/lib/utils';
import { ServiceIcon } from '@/components/ServiceIcon';
import { useBrand } from '@/context/BrandContext';
import { useMembersDirectory } from '@/lib/useMembersDirectory';
import { useLongPress } from '@/lib/useLongPress';
import { useSwipeAction } from '@/lib/useSwipeAction';
import { QuickActionSheet } from '@/components/QuickActionSheet';
import { useScopedJobs } from '@/lib/useScopedJobs';
import { normalizeTireSizeQuery } from '@/lib/inventoryNotesParser';
import { usePermissions, useMembership } from '@/context/MembershipContext';

interface Props {
  jobs: Job[];
  settings: Settings;
  onViewJob: (j: Job) => void;
  onMarkPaid: (j: Job) => void;
  onComplete: (j: Job) => void;
  onEditJob: (j: Job) => void;
  onGenerateInvoice: (j: Job) => void;
  onSendInvoice: (j: Job) => void;
  onSendReview: (j: Job) => void;
  onDuplicate: (j: Job) => void;
}

type Filter = 'all' | 'completed' | 'pending' | 'cancelled' | 'unpaid';

export function History({
  jobs: rawJobs, settings, onViewJob, onMarkPaid, onComplete, onEditJob,
  onGenerateInvoice, onSendInvoice, onSendReview, onDuplicate,
}: Props) {
  // Phase 2.2 Sub-Project B: scope to what the current member sees.
  const jobs = useScopedJobs(rawJobs);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  // Bulk delete/edit gates on canDeleteJobs — the destructive end of
  // the bulk surface. Owners + admins have it by default; techs don't.
  // Reading from permissions instead of comparing role directly means
  // future permission tweaks (e.g. promoting a tech to "lead tech"
  // with delete rights) automatically flow through.
  const { permissions } = useMembership();
  const canBulk = permissions.canDeleteJobs;

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

  // Bulk selection — owner/admin only. Toggling the mode resets the
  // selected set; toggling individual cards while selecting flips
  // membership in the set. Tap-out of select mode (Done button or
  // when zero jobs selected and user re-taps Select) clears.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSelected = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const exitSelecting = (): void => {
    setSelecting(false);
    setSelected(new Set());
  };
  // Bulk-mark-paid: fire onMarkPaid for every selected job that's
  // still unpaid, then exit selection mode. Filters paid/cancelled
  // defensively (selection state could include them if filter shifts
  // mid-selection). Parallel via Promise.all — onMarkPaid is a write
  // that returns void; concurrent writes are safe because each job
  // is a different Firestore doc.
  const bulkMarkPaid = async (): Promise<void> => {
    const targets = jobs.filter((j) => selected.has(j.id)
      && resolvePaymentStatus(j) === 'Pending Payment');
    await Promise.all(targets.map((j) => onMarkPaid(j)));
    exitSelecting();
  };
  // How many of the currently-selected jobs are actually mark-paid-able?
  // Drives the bottom bar's count + disabled state.
  const eligibleSelectedCount = useMemo(
    () => jobs.filter((j) => selected.has(j.id)
      && resolvePaymentStatus(j) === 'Pending Payment').length,
    [jobs, selected],
  );

  const filtered = useMemo(() => {
    let list = Array.isArray(jobs) ? [...jobs] : [];
    if (filter === 'completed') list = list.filter((j) => j.status === 'Completed');
    if (filter === 'pending') list = list.filter((j) => j.status === 'Pending');
    if (filter === 'cancelled') list = list.filter((j) => j.status === 'Cancelled');
    if (filter === 'unpaid') list = list.filter((j) => resolvePaymentStatus(j) === 'Pending Payment');
    const qRaw = query.trim().toLowerCase();
    if (qRaw) {
      // Tire-size queries canonicalize: "215/55/17" matches jobs
      // stored as "215/55R17" and vice versa. Non-size queries
      // (customer name, service, phone, etc.) pass through.
      const q = normalizeTireSizeQuery(qRaw).toLowerCase();
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div className="chip-grid" style={{ marginBottom: 0, flex: 1, minWidth: 0 }}>
          {(['all', 'completed', 'pending', 'cancelled', 'unpaid'] as Filter[]).map((f) => (
            <button key={f} type="button" className={'chip sm' + (filter === f ? ' active' : '')} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        {/* Owner/admin can flip into multi-select mode to mark several
            jobs paid in one batch. Hidden for techs (canBulk gate)
            since they typically don't have visibility across a
            payment backlog. */}
        {canBulk && (
          <button
            type="button"
            onClick={() => (selecting ? exitSelecting() : setSelecting(true))}
            style={{
              flexShrink: 0,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 700,
              background: selecting ? 'var(--brand-primary)' : 'transparent',
              color: selecting ? '#0a0a0a' : 'var(--brand-primary)',
              border: '1px solid var(--brand-primary)',
              borderRadius: 99,
              cursor: 'pointer',
              minHeight: 32,
            }}
          >
            {selecting ? 'Done' : 'Select'}
          </button>
        )}
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
              selecting={selecting}
              isSelected={selected.has(j.id)}
              onToggleSelect={() => toggleSelected(j.id)}
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
          onComplete={() => onComplete(sheetJob)}
        />
      )}

      {/* Bulk action bar — fixed bottom, only when in select mode AND
          at least one job is selected. Honors safe-area-inset-bottom
          so iOS Safari's home indicator doesn't crop the button.
          Reuses the brand-primary CTA styling for visual coherence
          with the existing "Get Founder Access" buttons. */}
      {selecting && selected.size > 0 && (
        <div
          style={{
            position: 'fixed',
            left: 0, right: 0, bottom: 0,
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0) + 12px)',
            paddingTop: 12,
            paddingLeft: 16, paddingRight: 16,
            background: 'linear-gradient(to top, var(--bg) 70%, transparent)',
            zIndex: 20,
            display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t2)', flex: 1 }}>
            {selected.size} selected
            {eligibleSelectedCount !== selected.size && (
              <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 500, marginLeft: 6 }}>
                · {eligibleSelectedCount} unpaid
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={exitSelecting}
            style={{
              padding: '10px 14px',
              fontSize: 13, fontWeight: 700,
              background: 'transparent',
              color: 'var(--t3)',
              border: '1px solid var(--border2)',
              borderRadius: 99,
              cursor: 'pointer',
              minHeight: 40,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { void bulkMarkPaid(); }}
            disabled={eligibleSelectedCount === 0}
            style={{
              padding: '10px 16px',
              fontSize: 13, fontWeight: 800,
              background: eligibleSelectedCount > 0 ? 'var(--green)' : 'var(--s2)',
              color: eligibleSelectedCount > 0 ? '#fff' : 'var(--t3)',
              border: '1px solid ' + (eligibleSelectedCount > 0 ? 'var(--green)' : 'var(--border)'),
              borderRadius: 99,
              cursor: eligibleSelectedCount > 0 ? 'pointer' : 'not-allowed',
              minHeight: 40,
            }}
          >
            Mark {eligibleSelectedCount} paid
          </button>
        </div>
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
  selecting = false, isSelected = false, onToggleSelect,
}: {
  job: Job;
  settings: Settings;
  techName: string | null;
  onView: () => void;
  onLongPress: () => void;
  onMarkPaid: () => void;
  /** When true, the card switches to selection-mode behavior: tap
   *  toggles selection instead of opening the detail modal, swipe-
   *  to-mark-paid is disabled, and a checkbox circle renders on the
   *  left of the card. Owner/admin only — parent gates the prop. */
  selecting?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}) {
  const ps = resolvePaymentStatus(job);
  // Technicians see revenue but not the per-job profit line. Don't even
  // compute profit for them — keeps the cost-derived figure out of the
  // tech's client entirely (defense in depth alongside the UI gate).
  const canViewProfit = usePermissions().canViewProfit;
  const pr = canViewProfit ? jobGrossProfit(job, settings) : 0;
  const lp = useLongPress(onLongPress);

  // Swipe-to-mark-paid (power-user shortcut). Disabled while selecting
  // so the gesture doesn't fire alongside selection toggles. The
  // explicit "Mark Paid" button below still renders for discoverability
  // outside of select mode.
  const canSwipe = !selecting && ps !== 'Paid' && ps !== 'Cancelled';
  const swipe = useSwipeAction({ enabled: canSwipe, onCommit: onMarkPaid });

  return (
    <div className="job-card card-anim" style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Green reveal slides in from the left as the swipe progresses.
          pointer-events off so it never blocks taps on the card above. */}
      {canSwipe && swipe.reveal && (
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(90deg, var(--green) 0%, #16a34a 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
            paddingLeft: 18, color: '#fff', fontWeight: 800,
            fontSize: 14, letterSpacing: 0.2,
            pointerEvents: 'none',
          }}
        >
          {swipe.committed ? '✓ Release to mark paid' : '→ Swipe to mark paid'}
        </div>
      )}
      {/* Swipe-transform container — holds both the card body and the
          unpaid-footer so they slide as one. Explicit bg so the green
          reveal underneath doesn't bleed through the rounded corners. */}
      <div
        {...swipe.bind}
        style={{
          transform: `translateX(${swipe.swipeX}px)`,
          transition: swipe.swipeX === 0 ? 'transform .18s ease' : 'none',
          position: 'relative',
          zIndex: 1,
          background: 'var(--s1)',
        }}
      >
      <div
        className="job-card-main"
        onClick={() => {
          // In select mode, taps toggle selection instead of opening
          // the detail modal. Long-press still works (drops the user
          // into the QuickActionSheet) regardless of mode.
          if (lp.firedRef.current) return;
          if (selecting && onToggleSelect) { onToggleSelect(); return; }
          onView();
        }}
        {...lp.bind}
        style={{
          // Subtle highlight when this card is in the active selection.
          background: isSelected ? 'rgba(200,164,74,.08)' : undefined,
        }}
      >
        {/* Selection checkbox — only renders in select mode. 28px
            circle on the far left, before the service icon. Tap area
            is the whole card; this is just the visual marker. */}
        {selecting && (
          <div
            aria-hidden
            style={{
              flexShrink: 0,
              width: 24, height: 24,
              borderRadius: 99,
              border: '2px solid ' + (isSelected ? 'var(--brand-primary)' : 'var(--border2)'),
              background: isSelected ? 'var(--brand-primary)' : 'transparent',
              color: '#0a0a0a',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 900,
              marginRight: 4,
            }}
          >
            {isSelected ? '✓' : ''}
          </div>
        )}
        <div className="job-icon"><ServiceIcon name={job.service} /></div>
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
      </div> {/* /swipe-transform wrapper */}
    </div>
  );
}

