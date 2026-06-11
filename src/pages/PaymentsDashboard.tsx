// src/pages/PaymentsDashboard.tsx
// ═══════════════════════════════════════════════════════════════════
//  Payments — Zettle sales dashboard (owner/admin only).
//
//  Reads the gated zettleSecure/{businessId}/payments collection and the
//  review queue, then derives:
//    • Today / week / month Zettle sales
//    • Total transactions · matched · unmatched · paid jobs · review queue
//    • Monthly breakdown: gross · count · average · matched/unmatched ·
//      payment method
//
//  Tech-safety is rule-enforced: a technician's read of zettleSecure is
//  denied, so listZettlePayments returns [] and this page shows zeros.
//  The route is also gated to owner/admin in App.tsx (PaymentsGate).
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState, useCallback } from 'react';
import { money } from '@/lib/utils';
import { useBrand } from '@/context/BrandContext';
import {
  listZettlePayments, listZettleReviewQueue, type ZettlePaymentRow,
} from '@/lib/zettlePayments';
import { syncZettlePayments } from '@/lib/zettleTakePayment';

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfWeekMs(weekStartDay: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = (day - weekStartDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.getTime();
}
function startOfMonthMs(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}
function monthKey(ts: string): string {
  // YYYY-MM from an ISO timestamp; '' when unparseable.
  return ts && ts.length >= 7 ? ts.slice(0, 7) : '';
}
function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

interface MonthRow {
  key: string;
  gross: number;
  count: number;
  matched: number;
  unmatched: number;
  methods: Record<string, number>;
}

export function PaymentsDashboard({ workWeekStartDay }: { workWeekStartDay?: number }) {
  const { businessId } = useBrand();
  const [payments, setPayments] = useState<ZettlePaymentRow[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const [rows, queue] = await Promise.all([
      listZettlePayments(businessId),
      listZettleReviewQueue(businessId),
    ]);
    setPayments(rows);
    setReviewCount(queue.length);
    setLoading(false);
  }, [businessId]);

  useEffect(() => { void load(); }, [load]);

  const onSync = useCallback(async () => {
    if (!businessId) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await syncZettlePayments(businessId, '365');
      setSyncMsg(`Synced · ${r.imported} imported · ${r.matched} matched · ${r.review} need review.`);
      await load();
    } catch (e) {
      setSyncMsg((e as Error).message || 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  }, [businessId, load]);

  const stats = useMemo(() => {
    const todayMs = startOfTodayMs();
    const weekMs = startOfWeekMs(typeof workWeekStartDay === 'number' ? workWeekStartDay : 1);
    const monthMs = startOfMonthMs();
    let today = 0, week = 0, month = 0, matched = 0;
    const paidJobIds = new Set<string>();
    const months = new Map<string, MonthRow>();

    for (const p of payments) {
      const ms = Date.parse(p.timestamp) || 0;
      if (ms >= todayMs) today += p.amount;
      if (ms >= weekMs) week += p.amount;
      if (ms >= monthMs) month += p.amount;
      const isMatched = !!p.jobId;
      if (isMatched) { matched++; paidJobIds.add(p.jobId as string); }

      const key = monthKey(p.timestamp);
      if (key) {
        const row = months.get(key) ?? { key, gross: 0, count: 0, matched: 0, unmatched: 0, methods: {} };
        row.gross += p.amount;
        row.count += 1;
        if (isMatched) row.matched += 1; else row.unmatched += 1;
        const method = p.cardBrand || p.paymentType || 'Card';
        row.methods[method] = (row.methods[method] ?? 0) + 1;
        months.set(key, row);
      }
    }

    const monthRows = [...months.values()].sort((a, b) => (a.key < b.key ? 1 : -1)).slice(0, 12);
    return {
      today, week, month,
      total: payments.length,
      matched,
      unmatched: payments.length - matched,
      paidJobs: paidJobIds.size,
      monthRows,
    };
  }, [payments, workWeekStartDay]);

  return (
    <div className="page page-enter" style={{ paddingTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Payments</h2>
        <button type="button" className="btn" disabled={syncing} onClick={onSync}>
          {syncing ? 'Syncing…' : 'Sync Zettle Payments'}
        </button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 16 }}>PayPal Zettle sales</div>
      {syncMsg && (
        <div className="card" style={{ padding: 10, marginBottom: 12, fontSize: 13, color: 'var(--brand-primary)' }}>
          {syncMsg}
        </div>
      )}

      {/* Sales windows */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <Kpi label="Today" value={money(stats.today)} accent />
        <Kpi label="This Week" value={money(stats.week)} accent />
        <Kpi label="This Month" value={money(stats.month)} accent />
      </div>

      {/* Counts */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <Kpi label="Transactions" value={String(stats.total)} />
        <Kpi label="Matched" value={String(stats.matched)} />
        <Kpi label="Unmatched" value={String(stats.unmatched)} />
        <Kpi label="Paid Jobs" value={String(stats.paidJobs)} />
        <Kpi label="Review Queue" value={String(reviewCount)} warn={reviewCount > 0} />
      </div>

      {/* Monthly breakdown */}
      <div className="form-group" style={{ marginTop: 4 }}>
        <div className="form-group-title" style={{ marginBottom: 10 }}>Monthly Sales</div>
        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--t3)', padding: '12px 0' }}>Loading…</div>
        ) : stats.monthRows.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--t3)', padding: '12px 0' }}>
            No Zettle payments yet. Tap <strong>Sync Zettle Payments</strong> to pull your history.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {stats.monthRows.map((m) => {
              const avg = m.count > 0 ? m.gross / m.count : 0;
              const methodStr = Object.entries(m.methods)
                .sort((a, b) => b[1] - a[1])
                .map(([k, n]) => `${k} ×${n}`)
                .join(' · ');
              return (
                <div key={m.key} className="card" style={{ padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <strong style={{ fontSize: 14 }}>{monthLabel(m.key)}</strong>
                    <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--green)' }}>{money(m.gross)}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 12, color: 'var(--t2)' }}>
                    <span>{m.count} txns</span>
                    <span>avg {money(avg)}</span>
                    <span>{m.matched} matched · {m.unmatched} unmatched</span>
                  </div>
                  {methodStr && (
                    <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>{methodStr}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div
        className="kpi-value"
        style={{ color: warn ? 'var(--amber)' : accent ? 'var(--green)' : undefined, fontSize: accent ? undefined : 18 }}
      >
        {value}
      </div>
    </div>
  );
}

export default PaymentsDashboard;
