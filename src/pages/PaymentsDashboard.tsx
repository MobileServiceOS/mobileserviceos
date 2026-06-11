// src/pages/PaymentsDashboard.tsx
// ═══════════════════════════════════════════════════════════════════
//  Payments — owner/admin only. Two sections on one page:
//
//  1) PAYMENTS (job-centric, from the jobs log):
//       • Outstanding: pending count + outstanding $
//       • Collected:  today / week / month sales + transaction counts
//       • Lifetime:   gross revenue · payment count · average ticket
//
//  2) ZETTLE (card-processor, from the gated zettleSecure collection):
//       • today / week / month Zettle sales
//       • transactions · auto-matched · unmatched · review queue · sync
//       • monthly breakdown (gross · count · avg · method)
//       • owner-only recent-transaction table (id · date · amount · match)
//
//  Tech-safety: route gated to canViewPaymentIntegrations; the Zettle
//  reads return [] when firestore.rules denies a tech.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState, useCallback } from 'react';
import type { Job } from '@/types';
import { money, resolvePaymentStatus } from '@/lib/utils';
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
  const diff = (d.getDay() - weekStartDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.getTime();
}
function startOfMonthMs(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}
function monthKey(ts: string): string {
  return ts && ts.length >= 7 ? ts.slice(0, 7) : '';
}
function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}
function fmtShort(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

interface MonthRow { key: string; gross: number; count: number; matched: number; unmatched: number; methods: Record<string, number>; }

export function PaymentsDashboard({ jobs, workWeekStartDay }: { jobs: Job[]; workWeekStartDay?: number }) {
  const { businessId } = useBrand();
  const [payments, setPayments] = useState<ZettlePaymentRow[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [showTxns, setShowTxns] = useState(false);

  const wk = typeof workWeekStartDay === 'number' ? workWeekStartDay : 1;

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
      setSyncMsg(`Synced · ${r.imported} imported · ${r.matched} auto-matched · ${r.review} need review.`);
      await load();
    } catch (e) {
      setSyncMsg((e as Error).message || 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  }, [businessId, load]);

  // ── Section 1: job-centric payment metrics ──────────────────────
  const jobStats = useMemo(() => {
    const todayMs = startOfTodayMs(), weekMs = startOfWeekMs(wk), monthMs = startOfMonthMs();
    let todaySales = 0, todayTx = 0, weekSales = 0, weekTx = 0, monthSales = 0, monthTx = 0;
    let pendingCount = 0, pendingAmt = 0, lifeGross = 0, lifeCount = 0;
    for (const j of jobs) {
      const ps = resolvePaymentStatus(j);
      const rev = Number(j.revenue || 0);
      if (ps === 'Paid') {
        lifeGross += rev; lifeCount++;
        const paidMs = j.paidAt ? Date.parse(j.paidAt) : 0;
        if (paidMs >= todayMs) { todaySales += rev; todayTx++; }
        if (paidMs >= weekMs) { weekSales += rev; weekTx++; }
        if (paidMs >= monthMs) { monthSales += rev; monthTx++; }
      } else if (ps === 'Pending Payment' || ps === 'Partial Payment') {
        pendingCount++; pendingAmt += rev;
      }
    }
    return {
      todaySales, todayTx, weekSales, weekTx, monthSales, monthTx,
      pendingCount, pendingAmt,
      lifeGross, lifeCount, avgTicket: lifeCount > 0 ? lifeGross / lifeCount : 0,
    };
  }, [jobs, wk]);

  // ── Section 2: Zettle metrics ───────────────────────────────────
  const zStats = useMemo(() => {
    const todayMs = startOfTodayMs(), weekMs = startOfWeekMs(wk), monthMs = startOfMonthMs();
    let today = 0, week = 0, month = 0, matched = 0;
    const months = new Map<string, MonthRow>();
    for (const p of payments) {
      const ms = Date.parse(p.timestamp) || 0;
      if (ms >= todayMs) today += p.amount;
      if (ms >= weekMs) week += p.amount;
      if (ms >= monthMs) month += p.amount;
      const isMatched = !!p.jobId;
      if (isMatched) matched++;
      const key = monthKey(p.timestamp);
      if (key) {
        const row = months.get(key) ?? { key, gross: 0, count: 0, matched: 0, unmatched: 0, methods: {} };
        row.gross += p.amount; row.count += 1;
        if (isMatched) row.matched += 1; else row.unmatched += 1;
        const method = p.cardBrand || p.paymentType || 'Card';
        row.methods[method] = (row.methods[method] ?? 0) + 1;
        months.set(key, row);
      }
    }
    const total = payments.length;
    return {
      today, week, month, total, matched, unmatched: total - matched,
      avgTxn: total > 0 ? payments.reduce((s, p) => s + p.amount, 0) / total : 0,
      monthRows: [...months.values()].sort((a, b) => (a.key < b.key ? 1 : -1)).slice(0, 12),
    };
  }, [payments, wk]);

  const recentTxns = useMemo(() => payments.slice(0, 30), [payments]);

  return (
    <div className="page page-enter" style={{ paddingTop: 16 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Payments</h2>
      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 16 }}>Collections · outstanding · Zettle reporting</div>

      {/* ═══ Section 1 — Payments (jobs) ═══ */}
      <SectionTitle>Outstanding</SectionTitle>
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <Kpi label="Pending Payments" value={String(jobStats.pendingCount)} warn={jobStats.pendingCount > 0} />
        <Kpi label="Outstanding" value={money(jobStats.pendingAmt)} warn={jobStats.pendingAmt > 0} />
      </div>

      <SectionTitle>Collected</SectionTitle>
      <div className="kpi-grid" style={{ marginBottom: 8 }}>
        <Kpi label="Today" value={money(jobStats.todaySales)} accent />
        <Kpi label="This Week" value={money(jobStats.weekSales)} accent />
        <Kpi label="This Month" value={money(jobStats.monthSales)} accent />
      </div>
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <Kpi label="Today txns" value={String(jobStats.todayTx)} />
        <Kpi label="Week txns" value={String(jobStats.weekTx)} />
        <Kpi label="Month txns" value={String(jobStats.monthTx)} />
      </div>

      <SectionTitle>Lifetime</SectionTitle>
      <div className="kpi-grid" style={{ marginBottom: 24 }}>
        <Kpi label="Gross Revenue" value={money(jobStats.lifeGross)} accent />
        <Kpi label="Payments" value={String(jobStats.lifeCount)} />
        <Kpi label="Avg Ticket" value={money(jobStats.avgTicket)} />
      </div>

      {/* ═══ Section 2 — Zettle ═══ */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <SectionTitle>Zettle</SectionTitle>
        <button type="button" className="btn" disabled={syncing} onClick={onSync}>
          {syncing ? 'Syncing…' : 'Sync Zettle Payments'}
        </button>
      </div>
      {syncMsg && (
        <div className="card" style={{ padding: 10, marginBottom: 12, fontSize: 13, color: 'var(--brand-primary)' }}>{syncMsg}</div>
      )}

      <div className="kpi-grid" style={{ marginBottom: 12 }}>
        <Kpi label="Today" value={money(zStats.today)} accent />
        <Kpi label="This Week" value={money(zStats.week)} accent />
        <Kpi label="This Month" value={money(zStats.month)} accent />
      </div>
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <Kpi label="Transactions" value={String(zStats.total)} />
        <Kpi label="Auto-matched" value={String(zStats.matched)} />
        <Kpi label="Unmatched" value={String(zStats.unmatched)} warn={zStats.unmatched > 0} />
        <Kpi label="Avg Txn" value={money(zStats.avgTxn)} />
        <Kpi label="Review Queue" value={String(reviewCount)} warn={reviewCount > 0} />
        <Kpi label="Sync Status" value={loading ? '…' : 'Ready'} />
      </div>

      {/* Owner-only recent-transaction table */}
      {recentTxns.length > 0 && (
        <div className="form-group" style={{ marginBottom: 16 }}>
          <button
            type="button" onClick={() => setShowTxns((v) => !v)}
            style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <span className="form-group-title" style={{ margin: 0 }}>Recent transactions</span>
            <span style={{ fontSize: 12, color: 'var(--brand-primary)', fontWeight: 700 }}>{showTxns ? 'Hide' : 'Show'}</span>
          </button>
          {showTxns && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
              {recentTxns.map((p) => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, fontSize: 12, borderBottom: '1px solid var(--border, #eee)', paddingBottom: 6 }}>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, color: 'var(--t3)', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.id}</span>
                  <span style={{ color: 'var(--t3)' }}>{fmtShort(p.timestamp)}</span>
                  <span style={{ fontWeight: 700 }}>{money(p.amount)}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: p.jobId ? 'var(--green, #16a34a)' : 'var(--amber, #d97706)' }}>
                    {p.jobId ? 'Auto-matched' : 'Review'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Monthly Zettle breakdown */}
      <div className="form-group" style={{ marginTop: 4 }}>
        <div className="form-group-title" style={{ marginBottom: 10 }}>Monthly Zettle Sales</div>
        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--t3)', padding: '12px 0' }}>Loading…</div>
        ) : zStats.monthRows.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--t3)', padding: '12px 0' }}>
            No Zettle payments yet. Tap <strong>Sync Zettle Payments</strong> to pull your history.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {zStats.monthRows.map((m) => {
              const avg = m.count > 0 ? m.gross / m.count : 0;
              const methodStr = Object.entries(m.methods).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join(' · ');
              return (
                <div key={m.key} className="card" style={{ padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <strong style={{ fontSize: 14 }}>{monthLabel(m.key)}</strong>
                    <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--green)' }}>{money(m.gross)}</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 12, color: 'var(--t2)' }}>
                    <span>{m.count} txns</span>
                    <span>avg {money(avg)}</span>
                    <span>{m.matched} auto-matched · {m.unmatched} unmatched</span>
                  </div>
                  {methodStr && <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>{methodStr}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>{children}</div>;
}

function Kpi({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color: warn ? 'var(--amber)' : accent ? 'var(--green)' : undefined, fontSize: accent ? undefined : 18 }}>{value}</div>
    </div>
  );
}

export default PaymentsDashboard;
