// src/pages/PaymentsDashboard.tsx
// ═══════════════════════════════════════════════════════════════════
//  Payments — owner/admin only. Job-centric collections view:
//    • Outstanding:  pending count + outstanding $
//    • Collected:    today / week / month sales + transaction counts
//    • Today by method: Card / Cash / Zelle / Venmo
//    • Lifetime:     total collected · payment count · average ticket
//    • Sales by Technician
//
//  Tech-safety: the route is gated to canViewPaymentIntegrations in
//  App.tsx (PaymentsGate).
// ═══════════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import type { Job } from '@/types';
import { money, resolvePaymentStatus } from '@/lib/utils';

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

export function PaymentsDashboard({ jobs, workWeekStartDay }: { jobs: Job[]; workWeekStartDay?: number }) {
  const wk = typeof workWeekStartDay === 'number' ? workWeekStartDay : 1;

  const stats = useMemo(() => {
    const todayMs = startOfTodayMs(), weekMs = startOfWeekMs(wk), monthMs = startOfMonthMs();
    let todaySales = 0, todayTx = 0, weekSales = 0, weekTx = 0, monthSales = 0, monthTx = 0;
    let pendingCount = 0, pendingAmt = 0, lifeGross = 0, lifeCount = 0;
    let tCard = 0, tCash = 0, tZelle = 0, tVenmo = 0;
    const byTech = new Map<string, { amount: number; count: number }>();
    for (const j of jobs) {
      const ps = resolvePaymentStatus(j);
      const rev = Number(j.revenue || 0);
      if (ps === 'Paid') {
        lifeGross += rev; lifeCount++;
        const method = j.paymentMethod;
        const who = j.collectedByName || 'Unattributed';
        const t = byTech.get(who) ?? { amount: 0, count: 0 };
        t.amount += rev; t.count += 1; byTech.set(who, t);
        const paidMs = j.paidAt ? Date.parse(j.paidAt) : 0;
        if (paidMs >= todayMs) {
          todaySales += rev; todayTx++;
          if (method === 'card') tCard += rev;
          else if (method === 'cash') tCash += rev;
          else if (method === 'zelle') tZelle += rev;
          else if (method === 'venmo') tVenmo += rev;
        }
        if (paidMs >= weekMs) { weekSales += rev; weekTx++; }
        if (paidMs >= monthMs) { monthSales += rev; monthTx++; }
      } else if (ps === 'Pending Payment' || ps === 'Partial Payment') {
        pendingCount++; pendingAmt += rev;
      }
    }
    const techRows = [...byTech.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.amount - a.amount);
    return {
      todaySales, todayTx, weekSales, weekTx, monthSales, monthTx,
      todayCard: tCard, todayCash: tCash, todayZelle: tZelle, todayVenmo: tVenmo,
      pendingCount, pendingAmt,
      lifeGross, lifeCount, avgTicket: lifeCount > 0 ? lifeGross / lifeCount : 0,
      techRows,
    };
  }, [jobs, wk]);

  return (
    <div className="page page-enter" style={{ paddingTop: 16 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Payments</h2>
      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 16 }}>Collections · outstanding</div>

      <SectionTitle>Outstanding</SectionTitle>
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <Kpi label="Pending Payments" value={String(stats.pendingCount)} warn={stats.pendingCount > 0} />
        <Kpi label="Outstanding" value={money(stats.pendingAmt)} warn={stats.pendingAmt > 0} />
      </div>

      <SectionTitle>Collected</SectionTitle>
      <div className="kpi-grid" style={{ marginBottom: 8 }}>
        <Kpi label="Today" value={money(stats.todaySales)} accent />
        <Kpi label="This Week" value={money(stats.weekSales)} accent />
        <Kpi label="This Month" value={money(stats.monthSales)} accent />
      </div>
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <Kpi label="Today txns" value={String(stats.todayTx)} />
        <Kpi label="Week txns" value={String(stats.weekTx)} />
        <Kpi label="Month txns" value={String(stats.monthTx)} />
      </div>

      <SectionTitle>Today by method</SectionTitle>
      <div className="kpi-grid" style={{ marginBottom: 24 }}>
        <Kpi label="Card" value={money(stats.todayCard)} />
        <Kpi label="Cash" value={money(stats.todayCash)} />
        <Kpi label="Zelle" value={money(stats.todayZelle)} />
        <Kpi label="Venmo" value={money(stats.todayVenmo)} />
      </div>

      <SectionTitle>Lifetime</SectionTitle>
      <div className="kpi-grid" style={{ marginBottom: 24 }}>
        <Kpi label="Total Collected" value={money(stats.lifeGross)} accent />
        <Kpi label="Payments" value={String(stats.lifeCount)} />
        <Kpi label="Avg Ticket" value={money(stats.avgTicket)} />
      </div>

      {stats.techRows.length > 0 && (
        <>
          <SectionTitle>Sales by Technician</SectionTitle>
          <div className="form-group" style={{ marginBottom: 24 }}>
            {stats.techRows.map((t) => (
              <div key={t.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border, #eee)' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</span>
                <span style={{ fontSize: 12, color: 'var(--t3)' }}>{t.count} job{t.count === 1 ? '' : 's'}</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--green)' }}>{money(t.amount)}</span>
              </div>
            ))}
          </div>
        </>
      )}
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
