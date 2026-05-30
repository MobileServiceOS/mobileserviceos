import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { _db } from '@/lib/firebase';
import { useBrand } from '@/context/BrandContext';
import { useMembership } from '@/context/MembershipContext';
import { useMembersDirectory } from '@/lib/useMembersDirectory';
import { addToast } from '@/lib/toast';
import { humanizeFirestoreError } from '@/lib/firebaseErrors';
import { fmtDate, money } from '@/lib/utils';
import type {
  TireQuote,
  TireQuoteOption,
  QuoteOptionTier,
  QuoteServiceType,
  QuoteStatus,
} from '@/lib/tireQuoteTypes';
import {
  computeQuoteAnalytics,
  filterQuotes,
  type QuoteFilters,
} from '@/lib/tireQuoteAnalytics';
import { openSmsForQuote } from '@/lib/tireQuoteMessage';

// ─────────────────────────────────────────────────────────────────────
//  src/pages/TireQuoteHistory.tsx — Phase 4 of the Tire Quote Engine.
//
//  Quote History list + analytics + per-row actions. Tech-accessible
//  but cost/profit fields stay hidden (client-side mask gated on
//  permissions.canEditPricingSettings — same pattern as Phase 3's
//  QuoteOptionCard).
//
//  Data: subscribes to businesses/{bid}/tireQuotes. One listener
//  while the page is mounted; tears down on unmount.
//
//  Filters (AND'd):
//    • Status chip: All / Draft / Sent / Accepted / Declined / Converted
//    • Search across customer name + phone + city
//    • Tire size dropdown (populated from distinct sizes in the data)
//    • Technician dropdown (createdBy uid → display name from members)
//    • Service type dropdown
//
//  Analytics strip at top: quotes count, conversion %, accepted
//  revenue (owner/admin sees revenue; tech sees only count + %).
//
//  Per-row actions: View detail (inline expand), Text Quote re-send,
//  Convert to Job (Phase 3 handoff), Mark Accepted, Mark Declined.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  /** TabId from src/types is the canonical union; relax to never so
   *  callers pass their own setTab signature. This page only calls
   *  setTab('add'). */
  setTab?: (tab: never) => void;
  onCreateJobFromQuote?: (
    quote: TireQuote,
    option: TireQuoteOption,
  ) => void | Promise<void>;
}

const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  convertedToJob: 'Converted',
};

const SERVICE_LABELS: Record<QuoteServiceType, string> = {
  replacement: 'Replacement',
  used_tire: 'Used tire',
  new_tire: 'New tire',
  emergency_replacement: 'Emergency',
};

const TIER_LABEL: Record<QuoteOptionTier, string> = {
  good: 'Good',
  better: 'Better',
  best: 'Best',
  used_economy: 'Used Economy',
  used_premium: 'Used Premium',
};

export function TireQuoteHistory({ setTab, onCreateJobFromQuote }: Props) {
  const { businessId } = useBrand();
  const { permissions } = useMembership();
  const { resolveName } = useMembersDirectory(businessId);
  const canViewCost = permissions.canEditPricingSettings;

  // ─── Live data ────────────────────────────────────────────────
  const [quotes, setQuotes] = useState<TireQuote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId || !_db) { setLoading(false); return; }
    const col = collection(_db, 'businesses', businessId, 'tireQuotes');
    const unsub = onSnapshot(col, (snap) => {
      const rows: TireQuote[] = [];
      snap.forEach((d) => {
        rows.push({ id: d.id, ...(d.data() as Omit<TireQuote, 'id'>) });
      });
      // Most-recent-first by createdAt (descending).
      rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setQuotes(rows);
      setLoading(false);
    }, (err) => {
      console.warn('[TireQuoteHistory] listener error:', err);
      setLoading(false);
    });
    return () => unsub();
  }, [businessId]);

  // ─── Filters ──────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [sizeFilter, setSizeFilter] = useState<string>('all');
  const [techFilter, setTechFilter] = useState<string>('all');
  const [serviceFilter, setServiceFilter] = useState<QuoteServiceType | 'all'>('all');

  const filters: QuoteFilters = useMemo(() => ({
    search: search || undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
    tireSize: sizeFilter === 'all' ? undefined : sizeFilter,
    createdBy: techFilter === 'all' ? undefined : techFilter,
    serviceType: serviceFilter === 'all' ? undefined : serviceFilter,
  }), [search, statusFilter, sizeFilter, techFilter, serviceFilter]);

  const filtered = useMemo(() => filterQuotes(quotes, filters), [quotes, filters]);

  // Analytics computed over the FILTERED set so the strip reflects
  // the operator's current view, not the unfiltered total.
  const analytics = useMemo(() => computeQuoteAnalytics(filtered), [filtered]);

  // Build dropdown option lists from the data — only show options
  // that actually exist in the current quote set (no dead choices).
  const distinctSizes = useMemo(() => {
    const set = new Set<string>();
    for (const q of quotes) {
      if (q.search.kind === 'size') set.add(q.search.tireSize);
    }
    return Array.from(set).sort();
  }, [quotes]);

  const distinctTechs = useMemo(() => {
    const set = new Set<string>();
    for (const q of quotes) {
      if (q.createdBy) set.add(q.createdBy);
    }
    return Array.from(set);
  }, [quotes]);

  // ─── Row expansion (view detail) ──────────────────────────────
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ─── Row actions ──────────────────────────────────────────────
  const [busyId, setBusyId] = useState<string | null>(null);

  const setStatus = async (quote: TireQuote, next: QuoteStatus) => {
    if (!businessId || !_db) return;
    setBusyId(quote.id);
    try {
      const ref = doc(_db, 'businesses', businessId, 'tireQuotes', quote.id);
      await setDoc(ref, { status: next }, { merge: true });
      addToast(`Marked ${STATUS_LABELS[next]}`, 'success');
    } catch (e) {
      addToast(`Update failed: ${humanizeFirestoreError(e)}`, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleTextResend = (quote: TireQuote) => {
    openSmsForQuote({
      phone: quote.customerPhone,
      customerName: quote.customerName,
      tireSize: quote.search.kind === 'size' ? quote.search.tireSize : undefined,
      options: quote.quoteOptions,
      selectedTier: quote.selectedOption,
    });
  };

  const handleConvert = async (quote: TireQuote) => {
    if (!onCreateJobFromQuote || !setTab) {
      addToast('Job creation unavailable', 'warn');
      return;
    }
    const selectedTier = quote.selectedOption;
    const option = selectedTier
      ? quote.quoteOptions.find((o) => o.tier === selectedTier)
      : quote.quoteOptions[0];
    if (!option) {
      addToast('Quote has no options to convert', 'warn');
      return;
    }
    await setStatus(quote, 'convertedToJob');
    await onCreateJobFromQuote(quote, option);
    (setTab as unknown as (t: string) => void)('add');
  };

  return (
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
        Quote History
      </div>
      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 14 }}>
        {quotes.length} quote{quotes.length === 1 ? '' : 's'} · search · filter · convert
      </div>

      {/* ─── Analytics strip ─────────────────────────────────── */}
      <div className="kpi-grid" style={{ marginBottom: 14 }}>
        <div className="kpi">
          <div className="kpi-label">Quotes</div>
          <div className="kpi-value">{analytics.totalQuotes}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Conversion</div>
          <div className="kpi-value">
            {analytics.totalQuotes > 0
              ? `${Math.round(analytics.conversionRate * 100)}%`
              : '—'}
          </div>
        </div>
        {canViewCost ? (
          <div className="kpi">
            <div className="kpi-label">Accepted $</div>
            <div className="kpi-value">{money(analytics.acceptedRevenue)}</div>
          </div>
        ) : (
          <div className="kpi">
            <div className="kpi-label">Accepted</div>
            <div className="kpi-value">{analytics.acceptedCount}</div>
          </div>
        )}
      </div>

      {/* Accepted vs declined breakdown — only if there are any */}
      {analytics.totalQuotes > 0 && (
        <div style={{
          fontSize: 11, color: 'var(--t3)', marginBottom: 12, lineHeight: 1.5,
        }}>
          ✓ {analytics.acceptedCount} accepted · ✗ {analytics.declinedCount} declined ·
          📭 {analytics.byStatus.sent} sent · 📝 {analytics.byStatus.draft} draft
          {canViewCost && analytics.acceptedProfit > 0 && (
            <span> · 💵 {money(analytics.acceptedProfit)} profit on accepted</span>
          )}
        </div>
      )}

      {/* ─── Status filter chips ─────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <StatusChip label="All" count={quotes.length} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
        {(['draft', 'sent', 'accepted', 'declined', 'convertedToJob'] as QuoteStatus[]).map((s) => (
          <StatusChip
            key={s}
            label={STATUS_LABELS[s]}
            count={analytics.byStatus[s]}
            active={statusFilter === s}
            onClick={() => setStatusFilter(s)}
          />
        ))}
      </div>

      {/* ─── Search + dropdown filters ───────────────────────── */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by customer name, phone, or city…"
        style={{
          width: '100%',
          padding: '10px 12px',
          marginBottom: 10,
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--s2)',
          color: 'var(--t1)',
          fontSize: 14,
        }}
      />
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        <FilterDropdown
          label="Tire size" value={sizeFilter}
          options={[{ v: 'all', l: 'All sizes' }, ...distinctSizes.map((s) => ({ v: s, l: s }))]}
          onChange={setSizeFilter}
        />
        <FilterDropdown
          label="Technician" value={techFilter}
          options={[{ v: 'all', l: 'All techs' }, ...distinctTechs.map((uid) => ({ v: uid, l: resolveName(uid) || uid }))]}
          onChange={setTechFilter}
        />
        <FilterDropdown
          label="Service type" value={serviceFilter}
          options={[
            { v: 'all', l: 'All services' },
            ...Object.entries(SERVICE_LABELS).map(([v, l]) => ({ v, l })),
          ]}
          onChange={(v) => setServiceFilter(v as QuoteServiceType | 'all')}
        />
      </div>

      {/* ─── List ────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
          Loading quotes…
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-title">No quotes</div>
          <div className="empty-state-sub">
            {quotes.length === 0
              ? 'Quote history will populate as you save quotes from the Tire Quote Engine.'
              : 'No quotes match your current filters. Clear filters to see all.'}
          </div>
        </div>
      ) : (
        <div className="stack">
          {filtered.map((q) => (
            <QuoteHistoryRow
              key={q.id}
              quote={q}
              techName={resolveName(q.createdBy) || q.createdBy}
              canViewCost={canViewCost}
              busy={busyId === q.id}
              expanded={expandedId === q.id}
              onToggle={() => setExpandedId(expandedId === q.id ? null : q.id)}
              onMarkAccepted={() => setStatus(q, 'accepted')}
              onMarkDeclined={() => setStatus(q, 'declined')}
              onTextResend={() => handleTextResend(q)}
              onConvert={() => handleConvert(q)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Single row ───────────────────────────────────────────────────

interface RowProps {
  quote: TireQuote;
  techName: string;
  canViewCost: boolean;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onMarkAccepted: () => void;
  onMarkDeclined: () => void;
  onTextResend: () => void;
  onConvert: () => void;
}

function QuoteHistoryRow({
  quote: q, techName, canViewCost, busy, expanded, onToggle,
  onMarkAccepted, onMarkDeclined, onTextResend, onConvert,
}: RowProps) {
  const size = q.search.kind === 'size' ? q.search.tireSize
    : q.search.kind === 'brandModel' ? `${q.search.brand} ${q.search.model}`
    : '(custom search)';
  const customer = q.customerName?.trim() || 'No name';
  const selectedTierLabel = q.selectedOption ? TIER_LABEL[q.selectedOption] : undefined;

  return (
    <div className="card card-anim" style={{
      background: 'var(--s1)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      marginBottom: 8,
      overflow: 'hidden',
    }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%', textAlign: 'left',
          padding: '12px 14px',
          background: 'transparent', border: 'none', color: 'var(--t1)',
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{customer}</span>
          <StatusPill status={q.status} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--t3)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span>{size}</span>
          <span>· {fmtDate(q.createdAt)}</span>
          {selectedTierLabel && <span>· {selectedTierLabel}</span>}
          <span>· {money(q.customerPrice)}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
          {techName} · {SERVICE_LABELS[q.serviceType] || q.serviceType}
        </div>
      </button>

      {expanded && (
        <div style={{
          padding: '0 14px 14px',
          borderTop: '1px solid var(--border2)',
        }}>
          <div style={{ marginTop: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
              Quote options
            </div>
            {q.quoteOptions.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--t3)' }}>No options on this quote.</div>
            ) : (
              q.quoteOptions.map((opt) => (
                <div key={opt.tier} style={{
                  fontSize: 12, padding: '6px 0',
                  borderTop: opt.tier !== q.quoteOptions[0].tier ? '1px solid var(--border2)' : 'none',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span>
                      <strong style={{ color: opt.tier === q.selectedOption ? 'var(--brand-primary)' : 'var(--t1)' }}>
                        {TIER_LABEL[opt.tier]}
                      </strong> · {opt.brand} {opt.model}
                    </span>
                    <span style={{ fontWeight: 700 }}>{money(opt.customerPrice)}</span>
                  </div>
                  {canViewCost && (
                    <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
                      {String(opt.supplierName)} · cost {money(opt.costPerTire)}/tire · profit {money(opt.estimatedProfit)}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {q.customerPhone && (
            <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 10 }}>
              📞 {q.customerPhone}
              {q.customerCity && <> · 📍 {q.customerCity}</>}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {q.status !== 'accepted' && q.status !== 'convertedToJob' && (
              <button
                className="btn xs success"
                onClick={onMarkAccepted}
                disabled={busy}
                style={{ flex: 1, minWidth: 110 }}
              >
                ✓ Accepted
              </button>
            )}
            {q.status !== 'declined' && (
              <button
                className="btn xs danger"
                onClick={onMarkDeclined}
                disabled={busy}
                style={{ flex: 1, minWidth: 110 }}
              >
                ✗ Declined
              </button>
            )}
            {q.customerPhone && (
              <button
                className="btn xs secondary"
                onClick={onTextResend}
                disabled={busy}
                style={{ flex: 1, minWidth: 110 }}
              >
                Text again
              </button>
            )}
            {q.status !== 'convertedToJob' && q.quoteOptions.length > 0 && (
              <button
                className="btn xs primary"
                onClick={onConvert}
                disabled={busy}
                style={{ flex: 1, minWidth: 110 }}
              >
                Create Job →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tiny presentational helpers ───────────────────────────────────

function StatusChip({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={'chip sm' + (active ? ' active' : '')}
      style={count === 0 && !active ? { opacity: .55 } : undefined}
    >
      {label} {count > 0 && `(${count})`}
    </button>
  );
}

function StatusPill({ status }: { status: QuoteStatus }) {
  const cls =
    status === 'accepted' || status === 'convertedToJob' ? 'green'
    : status === 'declined' ? 'red'
    : status === 'sent' ? 'amber'
    : '';
  return (
    <span className={'pill ' + cls} style={{ fontSize: 9, padding: '2px 6px' }}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function FilterDropdown({
  label, value, options, onChange,
}: {
  label: string;
  value: string;
  options: { v: string; l: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      style={{
        padding: '6px 8px',
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: 'var(--s2)',
        color: 'var(--t1)',
        fontSize: 12, fontWeight: 600,
        minWidth: 110,
      }}
    >
      {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}
