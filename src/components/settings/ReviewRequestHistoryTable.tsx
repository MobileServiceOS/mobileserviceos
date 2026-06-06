// src/components/settings/ReviewRequestHistoryTable.tsx
// ═══════════════════════════════════════════════════════════════════
//  ReviewRequestHistoryTable — SP4A history surface.
//
//  Spec: §"8. Review Request History table (addition #4)" in
//        docs/superpowers/specs/2026-06-03-sp4a-review-automation-design.md
//
//  Subscribes to the last 100 reviewRequests by createdAt desc. Five
//  status filter chips (computed for 'scheduled' = pending+future,
//  'pending' = pending+past). Client-side substring search across
//  customer name / phone / jobId. Tap row to expand → full body +
//  error + cancel button.
// ═══════════════════════════════════════════════════════════════════

import {
  memo,
  useEffect,
  useMemo,
  useState,
  type CSSProperties } from 'react';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { requireDb } from '@/lib/firebase';
import { formatPhoneForDisplay } from '@/lib/phone';
import type { ReviewRequest, ReviewRequestStatus } from '@/types';

type FilterKey = 'all' | 'pending' | 'scheduled' | 'sent' | 'failed' | 'cancelled';

interface Props {
  businessId: string;
}

interface CustomerNameMap { [id: string]: string }

function ReviewRequestHistoryTableImpl({ businessId }: Props): JSX.Element {
  const [rows,   setRows]   = useState<ReviewRequest[]>([]);
  const [names,  setNames]  = useState<CustomerNameMap>({});
  const [filter, setFilter] = useState<FilterKey>('all');
  const [searchInput, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    const q = query(
      collection(requireDb(), 'businesses', businessId, 'reviewRequests'),
      orderBy('createdAt', 'desc'),
      limit(100),
    );
    const unsub = onSnapshot(q, (snap) => {
      const next: ReviewRequest[] = [];
      snap.forEach(d => next.push({ id: d.id, ...d.data() } as ReviewRequest));
      setRows(next);
    });
    return () => unsub();
  }, [businessId]);

  // Pull customer names for display. Lightweight — one snapshot for
  // customers in the visible rows.
  useEffect(() => {
    if (!businessId || rows.length === 0) return;
    const ids = Array.from(new Set(rows.map(r => r.customerId).filter(id => id && id !== '__test__')));
    if (ids.length === 0) return;
    // The customers collection isn't huge; subscribe to all and pluck.
    const unsub = onSnapshot(
      collection(requireDb(), 'businesses', businessId, 'customers'),
      (snap) => {
        const next: CustomerNameMap = {};
        snap.forEach(d => { next[d.id] = (d.data() as { name?: string }).name ?? ''; });
        setNames(next);
      },
    );
    return () => unsub();
  }, [businessId, rows.length]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const search = searchInput.trim().toLowerCase();
    return rows.filter(r => {
      // Status filter
      const isFuture = (() => {
        const sa = (r as unknown as { sendAfterAt?: { toMillis?: () => number; _seconds?: number; seconds?: number } }).sendAfterAt;
        if (!sa) return false;
        if (typeof sa.toMillis === 'function') return sa.toMillis() > now;
        const seconds = sa._seconds ?? sa.seconds;
        return typeof seconds === 'number' && seconds * 1000 > now;
      })();
      if (filter === 'pending'   && !(r.status === 'pending' && !isFuture)) return false;
      if (filter === 'scheduled' && !(r.status === 'pending' && isFuture))  return false;
      if (filter === 'sent'      && r.status !== 'sent')      return false;
      if (filter === 'failed'    && r.status !== 'failed')    return false;
      if (filter === 'cancelled' && r.status !== 'cancelled') return false;

      if (search) {
        const hay = [
          names[r.customerId] ?? '',
          r.phoneE164 ?? '',
          r.jobId ?? '',
        ].join(' ').toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }, [rows, filter, searchInput, names]);

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 600, color: 'var(--t1)', marginBottom: 6 }}>Review Request History</div>

      {/* Filter chips */}
      <div style={chipRow}>
        {(['all','pending','scheduled','sent','failed','cancelled'] as FilterKey[]).map(k => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={'btn sm ' + (filter === k ? 'primary' : 'secondary')}
            style={{ textTransform: 'capitalize' }}
          >
            {k}
          </button>
        ))}
      </div>

      <input
        type="text"
        value={searchInput}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name, phone, or job id"
        style={searchInputStyle}
      />

      <div style={{ marginTop: 8 }}>
        {filtered.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--t3)' }}>No matching review requests.</p>
        )}
        {filtered.map(r => {
          const name = names[r.customerId] ?? (r.isTest ? '(test send)' : r.customerId);
          const phoneFmt = r.phoneE164 ? formatPhoneForDisplay(r.phoneE164) : '';
          const isOpen = expanded === r.id;
          return (
            <div key={r.id} style={rowCard}>
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : r.id)}
                style={rowHeader}
                aria-expanded={isOpen}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 13 }}>{name}</strong>
                    <StatusPill status={r.status} />
                    {r.isTest && <span style={badgeTest}>TEST</span>}
                    {r.isManual && <span style={badgeManual}>MANUAL</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
                    {phoneFmt} · job {r.jobId}
                  </div>
                </div>
                <span style={{ fontSize: 11, color: 'var(--t3)' }}>
                  {formatTs((r as unknown as { createdAt?: { toMillis?: () => number } }).createdAt)}
                </span>
              </button>
              {isOpen && (
                <div style={rowExpand}>
                  <div style={{ fontSize: 12, color: 'var(--t2)', whiteSpace: 'pre-wrap', marginBottom: 6 }}>
                    {r.templateRendered}
                  </div>
                  {r.errorMessage && (
                    <div style={{ fontSize: 12, color: 'var(--danger, #f87171)' }}>
                      Error: {r.errorMessage}
                    </div>
                  )}
                  {r.sentAt && (
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>
                      Sent: {formatTs(r.sentAt as unknown as { toMillis?: () => number })}
                      {r.twilioMessageSid ? ` · sid ${r.twilioMessageSid}` : ''}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: ReviewRequestStatus }): JSX.Element {
  const colorMap: Record<ReviewRequestStatus, string> = {
    pending:   '#888',
    sending:   '#3b82f6',
    sent:      '#4ade80',
    failed:    '#f87171',
    cancelled: '#6b7280',
  };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
      color: '#fff', background: colorMap[status] ?? '#666', textTransform: 'uppercase',
      letterSpacing: '0.4px',
    }}>{status}</span>
  );
}

function formatTs(ts: { toMillis?: () => number } | undefined): string {
  if (!ts || typeof ts.toMillis !== 'function') return '—';
  const d = new Date(ts.toMillis());
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const chipRow: CSSProperties = { display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 };
const searchInputStyle: CSSProperties = {
  width: '100%', padding: '6px 8px', fontSize: 13,
  background: 'var(--s2, #1f1f1f)', color: 'var(--t1)',
  border: '1px solid var(--border, #333)', borderRadius: 6,
};
const rowCard: CSSProperties = {
  background: 'var(--s2, #1f1f1f)', borderRadius: 6, marginBottom: 6,
  border: '1px solid var(--border, #333)', overflow: 'hidden',
};
const rowHeader: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  width: '100%', padding: '8px 10px', border: 'none', background: 'transparent',
  cursor: 'pointer', color: 'var(--t1)', textAlign: 'left',
};
const rowExpand: CSSProperties = {
  padding: '0 10px 10px',
  borderTop: '1px solid var(--border, #333)',
};
const badgeBase: CSSProperties = {
  fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 99,
  textTransform: 'uppercase', letterSpacing: '0.5px',
};
const badgeTest: CSSProperties = { ...badgeBase, background: '#facc15', color: '#1a1a1a' };
const badgeManual: CSSProperties = { ...badgeBase, background: '#a78bfa', color: '#1a1a1a' };

export const ReviewRequestHistoryTable = memo(ReviewRequestHistoryTableImpl);
