// src/pages/CustomerHub.tsx
// ═══════════════════════════════════════════════════════════════════
//  CustomerHub — the Customers tab landing surface.
//
//  Spec: §"Top-level Navigation (v3.2 user-confirmed)",
//        §"CustomerHub upgrade (SP3)"
//
//  Replaces the SP1 skeleton. Reads from the persisted Customer
//  collection (businesses/{bid}/customers) via onSnapshot. Renders:
//    - Header with KPI summary
//    - Sort toggle (recent / lifetime revenue / name)
//    - Customer cards (name, VIP badge, phone, jobs count, lifetime rev)
//    - Row click → CustomerProfile via onSelectCustomer prop
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  collection, onSnapshot, query, orderBy, limit, type Firestore,
} from 'firebase/firestore';
import { _db } from '@/lib/firebase';
import { formatPhoneForDisplay } from '@/lib/phone';
import type { Customer } from '@/lib/customerEntity';
import type { Job, Settings } from '@/types';

type SortKey = 'recent' | 'revenue' | 'name';

interface Props {
  businessId: string;
  jobs: Job[];           // SP1 legacy fallback — used when persisted customers list is empty
  settings: Settings;
  canViewFinancials?: boolean;
  onSelectCustomer?: (customerId: string) => void;
  onOpenSearch?: () => void;
}

export default function CustomerHub(props: Props): JSX.Element {
  const { businessId } = props;
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!businessId) return;
    const col = collection(_db as Firestore, 'businesses', businessId, 'customers');
    const q = query(col, orderBy('lastJobAt', 'desc'), limit(500));
    const unsub = onSnapshot(q,
      (snap) => {
        const rows: Customer[] = [];
        snap.forEach(d => rows.push({ id: d.id, ...d.data() } as Customer));
        setCustomers(rows);
        setLoading(false);
      },
      (err) => {
        console.warn('[CustomerHub] listen failed', err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [businessId]);

  const sorted = useMemo(() => {
    const list = [...customers];
    if (sortKey === 'recent') {
      list.sort((a, b) => (b.lastJobAt ?? '').localeCompare(a.lastJobAt ?? ''));
    } else if (sortKey === 'revenue') {
      list.sort((a, b) => (b.lifetimeRevenue ?? 0) - (a.lifetimeRevenue ?? 0));
    } else {
      list.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    }
    if (filter.trim()) {
      const f = filter.toLowerCase();
      return list.filter(c =>
        (c.nameLower ?? c.name?.toLowerCase() ?? '').includes(f)
        || (c.phoneKey ?? '').includes(f.replace(/\D/g, ''))
        || (c.cityLower ?? c.city?.toLowerCase() ?? '').includes(f)
      );
    }
    return list;
  }, [customers, sortKey, filter]);

  const totals = useMemo(() => {
    const totalRevenue = customers.reduce((n, c) => n + (Number(c.lifetimeRevenue) || 0), 0);
    const repeatCount = customers.filter(c => (c.jobCount ?? 0) > 1).length;
    return { count: customers.length, revenue: totalRevenue, repeat: repeatCount };
  }, [customers]);

  const canView = props.canViewFinancials ?? false;

  return (
    <div className="page page-enter">
      <header className="form-group card-anim">
        <div className="form-group-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span>Customer Directory</span>
          {props.onOpenSearch && (
            <button type="button" className="btn xs secondary" onClick={props.onOpenSearch}>
              🔍 Search
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={kpiStyle}>
            <div style={kpiLabelStyle}>Customers</div>
            <div style={kpiValueStyle}>{totals.count}</div>
          </div>
          <div style={kpiStyle}>
            <div style={kpiLabelStyle}>Repeat</div>
            <div style={kpiValueStyle}>{totals.repeat}</div>
          </div>
          {canView && (
            <div style={kpiStyle}>
              <div style={kpiLabelStyle}>Lifetime Revenue</div>
              <div style={kpiValueStyle}>${Math.round(totals.revenue).toLocaleString()}</div>
            </div>
          )}
        </div>
        <input
          type="text"
          placeholder="Filter by name, phone, or city…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={inputStyle}
        />
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          {(['recent', 'revenue', 'name'] as SortKey[]).map(k => (
            <button
              key={k}
              type="button"
              className={'chip' + (sortKey === k ? ' active' : '')}
              onClick={() => setSortKey(k)}
            >
              {k === 'recent' ? '🕒 Recent' : k === 'revenue' ? '💰 Revenue' : 'A–Z Name'}
            </button>
          ))}
        </div>
      </header>

      {loading && (
        <div style={{ padding: 20, color: 'var(--t3)' }}>Loading customers…</div>
      )}

      {!loading && customers.length === 0 && (
        <div className="form-group card-anim">
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--t3)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>👥</div>
            <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--t1)' }}>No customers yet</div>
            <div style={{ fontSize: 12 }}>
              Customer profiles are auto-created when you save jobs.
            </div>
          </div>
        </div>
      )}

      {!loading && sorted.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sorted.map(c => (
            <button
              key={c.id}
              type="button"
              style={cardStyle}
              onClick={() => props.onSelectCustomer?.(c.id)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--t1)' }}>{c.name || 'Unnamed'}</span>
                  {c.vipTier && c.vipTier !== 'Standard' && (
                    <span style={{
                      ...badgeStyle,
                      background: c.vipTier === 'Platinum' ? '#b5a5e8' : '#d4af37',
                      color: '#1a1a1a',
                    }}>{c.vipTier}</span>
                  )}
                  {c.kind === 'fleet' && (
                    <span style={{ ...badgeStyle, background: '#3b82f6', color: '#fff' }}>Fleet</span>
                  )}
                </div>
                {canView && c.lifetimeRevenue !== undefined && (
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-primary)' }}>
                    ${Math.round(c.lifetimeRevenue).toLocaleString()}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 4 }}>
                {c.phoneE164 && <span>{formatPhoneForDisplay(c.phoneE164)}</span>}
                {c.city && <span> · {c.city}</span>}
                {(c.jobCount ?? 0) > 0 && <span> · {c.jobCount} job{c.jobCount === 1 ? '' : 's'}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const kpiStyle: CSSProperties = {
  flex: '1 1 80px', minWidth: 80,
  padding: 10, background: 'var(--s2, #1f1f1f)',
  borderRadius: 8, border: '1px solid var(--border, #2a2a2a)',
};
const kpiLabelStyle: CSSProperties = { fontSize: 11, color: 'var(--t3)', marginBottom: 4 };
const kpiValueStyle: CSSProperties = { fontSize: 18, fontWeight: 700, color: 'var(--t1)' };
const inputStyle: CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 14,
  background: 'var(--s2, #1f1f1f)', color: 'var(--t1, #fff)',
  border: '1px solid var(--border, #333)', borderRadius: 6,
};
const cardStyle: CSSProperties = {
  width: '100%', textAlign: 'left', padding: 12,
  background: 'var(--s2, #1f1f1f)',
  border: '1px solid var(--border, #2a2a2a)',
  borderRadius: 10, cursor: 'pointer',
  color: 'inherit',
};
const badgeStyle: CSSProperties = {
  display: 'inline-block', padding: '2px 8px', borderRadius: 10,
  fontSize: 10, fontWeight: 700,
};
