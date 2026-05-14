import { useEffect, useMemo, useState } from 'react';
import type { Job, Settings, InventoryItem, QuoteForm, TabId } from '@/types';
import {
  calcQuote, clamp, fmtDate, getWeekStart,
  jobGrossProfit, money, normalizeTireSize, paymentPillClass,
  r2, resolvePaymentStatus, serviceIcon, weekSummary,
} from '@/lib/utils';
import { DEFAULT_SERVICE_PRICING, DEFAULT_VEHICLE_PRICING, TODAY } from '@/lib/defaults';
import { useCountUp } from '@/lib/useCountUp';
import { useMembership } from '@/context/MembershipContext';
import { _auth } from '@/lib/firebase';

// ─────────────────────────────────────────────────────────────────────
//  Dashboard — hybrid premium + operational
//
//  Combines the visual polish of the redesigned hero (circular progress
//  ring, growth %, premium KPI cards) with the operational density of
//  the production dashboard (pending jobs, pending payments, low stock,
//  quick quote, recent jobs).
//
//  Role-aware:
//    OWNER / ADMIN — see company-wide profit, revenue, costs, goal %,
//                    growth vs last week, pending payments, low stock,
//                    lead sources, all jobs in recent feed
//    TECHNICIAN   — see ONLY their own jobs (filtered by createdByUid).
//                   Hero shows completed-jobs progress vs personal
//                   weekly goal, not company $$. Growth % is their own
//                   week-over-week. No pending payments. No company
//                   revenue/costs. Job-count framing throughout.
//
//  Defensive defaults: if membership is loading or role can't be
//  resolved, default to the technician (safer) view to avoid leaking
//  company financials. Owners and admins explicitly need a resolved
//  role to see financial data.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  jobs: Job[];
  settings: Settings;
  inventory: InventoryItem[];
  setTab: (t: TabId) => void;
  onStartJob: (form: QuoteForm) => void;
  onViewJob: (j: Job) => void;
  onGenerateInvoice: (j: Job) => void;
  /** Optional invoice-send handler. Reserved for future per-job
   *  shortcut buttons; declared so the call-site type checks. */
  onSendInvoice?: (j: Job) => void;
  onSendReview: (j: Job) => void;
  onMarkPaid: (j: Job) => void;
  onEditJob: (j: Job) => void;
}

// ────── Circular progress ring (SVG, no library) ────────────────────
//
// Renders a circular ring with track + filled arc and centered content.
// Stroke uses semantic colors: green ≥ 100%, gold 50-99%, amber 25-49%,
// dim < 25%. Standard SVG circumference math (2πr) maps the arc length
// to a 0..100 percentage.
function ProgressRing({
  pct, size = 132, stroke = 10, children,
}: {
  pct: number; size?: number; stroke?: number; children: React.ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const safePct = clamp(pct, 0, 100);
  const dash = (safePct / 100) * circ;
  const color = safePct >= 100
    ? '#22c55e'
    : safePct >= 50
      ? 'var(--brand-primary)'
      : safePct >= 25
        ? '#eab308'
        : 'var(--t3)';

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: 'stroke-dasharray 700ms cubic-bezier(.2,.8,.2,1)' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: 8,
      }}>
        {children}
      </div>
    </div>
  );
}

// Small sub-KPI cell rendered under the hero. Three of these sit
// side-by-side in a 1fr 1fr 1fr grid.
function SubKpi({ label, value, tone }: { label: string; value: string; tone: 'neutral' | 'cost' | 'success' }) {
  const valueColor = tone === 'cost' ? '#ef4444' : tone === 'success' ? '#22c55e' : 'var(--t1)';
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{
        fontSize: 9, fontWeight: 800,
        color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1,
        marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 14, fontWeight: 700,
        color: valueColor,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {value}
      </div>
    </div>
  );
}

export function Dashboard({
  jobs, settings, inventory, setTab,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onStartJob, onViewJob, onGenerateInvoice, onSendInvoice, onSendReview, onMarkPaid, onEditJob,
}: Props) {
  const enabledServices = useMemo(() => {
    const sp = settings.servicePricing || DEFAULT_SERVICE_PRICING;
    return Object.keys(sp).filter((k) => sp[k] && sp[k].enabled !== false);
  }, [settings.servicePricing]);

  const [qqForm, setQqForm] = useState<QuoteForm>(() => ({
    service: enabledServices[0] || 'Flat Tire Repair',
    vehicleType: 'Car',
    miles: '', tireCost: '', materialCost: '',
    qty: 1, revenue: '',
    emergency: false, lateNight: false, highway: false, weekend: false,
  }));

  useEffect(() => {
    if (enabledServices.length && !enabledServices.includes(qqForm.service)) {
      setQqForm((p) => ({ ...p, service: enabledServices[0] }));
    }
  }, [enabledServices, qqForm.service]);

  const [qqMode, setQqMode] = useState<'suggested' | 'premium'>('suggested');
  const qqChange = <K extends keyof QuoteForm>(k: K, v: QuoteForm[K]) => setQqForm((p) => ({ ...p, [k]: v }));

  // ─── Role resolution ─────────────────────────────────────────────
  const membership = useMembership();
  const myUid = _auth?.currentUser?.uid ?? null;
  const isTechnician = membership.role === 'technician';
  // Defensive: only owner/admin see company financials. Loading state
  // OR unresolved role → safer non-financial view.
  const showCompanyData = membership.role === 'owner' || membership.role === 'admin';

  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const today = TODAY();

  // ─── Per-role job visibility ────────────────────────────────────
  const visibleJobs = useMemo(() => {
    if (!isTechnician || !myUid) return safeJobs;
    return safeJobs.filter((j) => j.createdByUid === myUid);
  }, [safeJobs, isTechnician, myUid]);

  // ─── Week math ──────────────────────────────────────────────────
  const weekStartDay = typeof settings.workWeekStartDay === 'number'
    ? settings.workWeekStartDay
    : 1;
  const thisWeek = getWeekStart(today, weekStartDay);

  // Previous week start = subtract 7 days from this week's anchor.
  const lastWeek = useMemo(() => {
    const dt = new Date(thisWeek + 'T12:00:00');
    dt.setDate(dt.getDate() - 7);
    return dt.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  }, [thisWeek]);

  const completedJobs = useMemo(
    () => visibleJobs.filter((j) => j.status === 'Completed'),
    [visibleJobs],
  );
  const weekJobs = useMemo(
    () => completedJobs.filter((j) => getWeekStart(j.date, weekStartDay) === thisWeek),
    [completedJobs, thisWeek, weekStartDay],
  );
  const lastWeekJobs = useMemo(
    () => completedJobs.filter((j) => getWeekStart(j.date, weekStartDay) === lastWeek),
    [completedJobs, lastWeek, weekStartDay],
  );
  const todayJobs = useMemo(() => completedJobs.filter((j) => j.date === today), [completedJobs, today]);

  const totals = useMemo(() => weekSummary(weekJobs, settings), [weekJobs, settings]);
  const lastWeekTotals = useMemo(() => weekSummary(lastWeekJobs, settings), [lastWeekJobs, settings]);
  const avgProfit = weekJobs.length ? r2(totals.grossProfit / weekJobs.length) : 0;

  // Costs = revenue - profit. Visible to owner/admin only.
  const weekCosts = r2(Math.max(0, (totals.revenue || 0) - (totals.grossProfit || 0)));

  // ─── Growth % vs previous week ──────────────────────────────────
  // Owner/admin: profit-based growth. Technician: jobs-count growth.
  // Edge case: when last week was 0 but this week has data, show "New"
  // instead of an infinity %.
  const growth = useMemo(() => {
    if (showCompanyData) {
      const prev = lastWeekTotals.grossProfit || 0;
      const curr = totals.grossProfit || 0;
      if (prev === 0 && curr === 0) return { label: '—', positive: null as boolean | null };
      if (prev === 0) return { label: 'New', positive: true };
      const delta = ((curr - prev) / prev) * 100;
      return { label: `${delta >= 0 ? '+' : ''}${Math.round(delta)}%`, positive: delta >= 0 };
    }
    const prev = lastWeekJobs.length;
    const curr = weekJobs.length;
    if (prev === 0 && curr === 0) return { label: '—', positive: null as boolean | null };
    if (prev === 0) return { label: 'New', positive: true };
    const delta = ((curr - prev) / prev) * 100;
    return { label: `${delta >= 0 ? '+' : ''}${Math.round(delta)}%`, positive: delta >= 0 };
  }, [showCompanyData, totals.grossProfit, lastWeekTotals.grossProfit, weekJobs.length, lastWeekJobs.length]);

  // ─── Progress ring percentage ───────────────────────────────────
  // Owner/admin: profit / weekly $ goal. Technician: jobs / weekly
  // jobs goal (technicianWeeklyJobsGoal, default 5).
  const technicianGoal = Number(settings.technicianWeeklyJobsGoal || 5);
  const progressPct = showCompanyData
    ? clamp((totals.grossProfit / (settings.weeklyGoal || 1)) * 100, 0, 100)
    : clamp((weekJobs.length / Math.max(1, technicianGoal)) * 100, 0, 100);

  const remainingToGoal = showCompanyData
    ? Math.max(0, (settings.weeklyGoal || 0) - totals.grossProfit)
    : Math.max(0, technicianGoal - weekJobs.length);

  // ─── Pending / payments / sources / low stock ────────────────────
  const pendingJobs = useMemo(
    () => visibleJobs.filter((j) => j.status === 'Pending'),
    [visibleJobs],
  );
  const pendingTotal = pendingJobs.reduce((s, j) => s + Number(j.revenue || 0), 0);

  const pendingPaymentJobs = useMemo(
    () => visibleJobs.filter((j) => resolvePaymentStatus(j) === 'Pending Payment'),
    [visibleJobs],
  );
  const pendingPaymentTotal = pendingPaymentJobs.reduce((s, j) => s + Number(j.revenue || 0), 0);

  const sources = useMemo(() => {
    const m: Record<string, number> = {};
    visibleJobs.forEach((j) => { const s = j.source || 'Other'; m[s] = (m[s] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [visibleJobs]);
  const maxSrc = sources.length ? sources[0][1] : 1;

  const recentCompleted = useMemo(
    () => [...completedJobs]
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.id || '').localeCompare(a.id || ''))
      .slice(0, 5),
    [completedJobs],
  );

  const lowStock = useMemo(() => {
    const inv = Array.isArray(inventory) ? inventory : [];
    const top5Tires = (() => {
      const c: Record<string, number> = {};
      visibleJobs.forEach((j) => { if (j.tireSize) c[j.tireSize] = (c[j.tireSize] || 0) + Number(j.qty || 1); });
      return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([size, sold]) => ({ size, sold }));
    })();
    const byN: Record<string, number> = {};
    inv.forEach((i) => { const n = normalizeTireSize(i.size); if (n) byN[n] = (byN[n] || 0) + Number(i.qty || 0); });
    const alerts: { size: string; onHand: number; soldCount: number }[] = [];
    top5Tires.forEach((t) => {
      const n = normalizeTireSize(t.size);
      if (!n) return;
      if ((byN[n] || 0) <= 1) alerts.push({ size: t.size, onHand: byN[n] || 0, soldCount: t.sold });
    });
    return alerts.slice(0, 3);
  }, [visibleJobs, inventory]);

  const quote = useMemo(() => calcQuote(qqForm, settings), [qqForm, settings]);

  // Count-up animation target: profit for owner, jobs count for tech.
  const heroAnimTarget = showCompanyData ? totals.grossProfit : weekJobs.length;
  const heroValue = useCountUp(heroAnimTarget);

  const handleStartJob = () => {
    onStartJob({ ...qqForm, revenue: qqMode === 'suggested' ? quote.suggested : quote.premium });
  };

  // Development-only role-resolution log (spec: defensive check).
  useEffect(() => {
    if (import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.debug('[dashboard] role resolution:', {
        role: membership.role,
        showCompanyData,
        isTechnician,
        myUid,
      });
    }
  }, [membership.role, showCompanyData, isTechnician, myUid]);

  return (
    <div className="page page-enter dashboard-page">
      {/* ─── 1. Pending alert strip ───────────────────────────────── */}
      {pendingJobs.length > 0 && (
        <div className="pending-banner card-anim" onClick={() => setTab('history')}>
          <div>
            <div className="pending-banner-title">
              {pendingJobs.length} {isTechnician ? 'Assigned' : 'Pending'} Job{pendingJobs.length > 1 ? 's' : ''}
            </div>
            <div className="pending-banner-sub">
              {showCompanyData
                ? `${money(pendingTotal)} awaiting completion`
                : `${pendingJobs.length} to complete`}
            </div>
          </div>
          <span style={{ fontSize: 18 }}>→</span>
        </div>
      )}

      {/* ─── 2. Hero KPI card — circular ring + role-aware content ── */}
      <div className="card-anim" style={{
        background: 'linear-gradient(155deg, var(--s2) 0%, var(--s1) 100%)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: '20px 18px',
        marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <ProgressRing pct={progressPct} size={132} stroke={10}>
            <div style={{
              fontSize: 9, fontWeight: 800,
              color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1,
              marginBottom: 2,
            }}>
              {showCompanyData ? "This Week" : "Your Week"}
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--t1)', lineHeight: 1 }}>
              {Math.round(progressPct)}%
            </div>
            <div style={{ fontSize: 9, color: 'var(--t3)', marginTop: 2 }}>
              {showCompanyData ? 'of goal' : `${weekJobs.length}/${technicianGoal} jobs`}
            </div>
          </ProgressRing>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 10, fontWeight: 800,
              color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1.5,
              marginBottom: 6,
            }}>
              {showCompanyData ? "This Week's Profit" : "Your Earnings"}
            </div>
            <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--t1)', lineHeight: 1.05, marginBottom: 4 }}>
              {showCompanyData
                ? <><span style={{ fontSize: 18, color: 'var(--t3)', marginRight: 2 }}>$</span>{Math.floor(heroValue).toLocaleString()}</>
                : <>{Math.floor(heroValue)} <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--t3)' }}>job{Math.floor(heroValue) !== 1 ? 's' : ''}</span></>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, flexWrap: 'wrap' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '2px 7px', borderRadius: 12, fontWeight: 700,
                background: growth.positive === null
                  ? 'var(--s3)'
                  : growth.positive
                    ? 'rgba(34,197,94,.15)'
                    : 'rgba(239,68,68,.15)',
                color: growth.positive === null
                  ? 'var(--t3)'
                  : growth.positive ? '#22c55e' : '#ef4444',
              }}>
                {growth.positive === null ? '' : growth.positive ? '↑' : '↓'} {growth.label}
              </span>
              <span style={{ color: 'var(--t3)' }}>vs last week</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 6 }}>
              {showCompanyData
                ? (remainingToGoal > 0
                    ? `${money(remainingToGoal)} to ${money(settings.weeklyGoal || 0)} goal`
                    : '🎯 Goal hit')
                : (remainingToGoal > 0
                    ? `${remainingToGoal} more to hit weekly goal`
                    : '🎯 Weekly goal hit')}
            </div>
          </div>
        </div>

        {/* Sub-metrics — three small cells beneath the ring/copy. */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
          gap: 8, marginTop: 16,
          paddingTop: 14, borderTop: '1px solid var(--border)',
        }}>
          {showCompanyData ? (
            <>
              <SubKpi label="Revenue" value={money(totals.revenue)} tone="neutral" />
              <SubKpi label="Costs" value={money(weekCosts)} tone="cost" />
              <SubKpi label="Avg / Job" value={money(avgProfit)} tone="neutral" />
            </>
          ) : (
            <>
              <SubKpi label="Today" value={`${todayJobs.length}`} tone="neutral" />
              <SubKpi label="Pending" value={`${pendingJobs.length}`} tone="neutral" />
              <SubKpi label="Avg / Job" value={money(avgProfit)} tone="neutral" />
            </>
          )}
        </div>
      </div>

      {/* ─── 3. Quick actions row ────────────────────────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 10, marginBottom: 14,
      }}>
        <button
          className="press-scale"
          onClick={() => setTab('add')}
          style={{
            padding: '14px 12px',
            background: 'var(--brand-primary)',
            color: '#000',
            border: 'none', borderRadius: 12,
            fontSize: 14, fontWeight: 800,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          ＋ Log Job
        </button>
        <button
          className="press-scale"
          onClick={() => setTab('history')}
          style={{
            padding: '14px 12px',
            background: 'var(--s2)',
            color: 'var(--t1)',
            border: '1px solid var(--border)', borderRadius: 12,
            fontSize: 14, fontWeight: 700,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          📋 {isTechnician ? 'Assigned' : 'All Jobs'}
        </button>
      </div>

      {/* ─── 4. Pending Payments — owner/admin only ──────────────── */}
      {showCompanyData && pendingPaymentJobs.length > 0 && (
        <>
          <div className="section-label">Pending Payments</div>
          <div className="card card-anim">
            <div className="card-pad" style={{ paddingBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gold)' }}>Total Due</span>
                <span className="num" style={{ fontSize: 15, fontWeight: 700, color: 'var(--gold)' }}>{money(pendingPaymentTotal)}</span>
              </div>
              {pendingPaymentJobs.slice(0, 5).map((j) => (
                <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--border2)', gap: 10 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {j.customerName || j.service}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>{j.service} · {fmtDate(j.date)}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span className="num" style={{ fontSize: 14, fontWeight: 700, color: 'var(--gold)' }}>{money(j.revenue)}</span>
                    <button className="btn xs success" onClick={() => onMarkPaid(j)}>Paid</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ─── 5. Low Stock — owner/admin only ─────────────────────── */}
      {showCompanyData && lowStock.length > 0 && (
        <div className="card card-anim" style={{ borderColor: 'rgba(245,158,11,.2)' }}>
          <div className="card-pad">
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--amber)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>
              ⚠ Low Stock Alert
            </div>
            {lowStock.map((ls) => (
              <div key={ls.size} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', color: 'var(--t2)' }}>
                <span style={{ fontWeight: 700 }}>{ls.size}</span>
                <span>{ls.onHand} left (sold {ls.soldCount})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── 6. Quick Quote ─────────────────────────────────────── */}
      <div className="section-label with-action">
        <span>Quick Quote</span>
        <span className="section-label-hint">Suggested pricing feeds straight into Log Job</span>
      </div>
      <div className="quote-box card-anim">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Service</label>
            <select value={qqForm.service} onChange={(e) => qqChange('service', e.target.value)}>
              {enabledServices.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Vehicle</label>
            <select value={qqForm.vehicleType} onChange={(e) => qqChange('vehicleType', e.target.value)}>
              {Object.keys(settings.vehiclePricing || DEFAULT_VEHICLE_PRICING).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Miles</label>
            <input type="number" inputMode="decimal" value={qqForm.miles} onChange={(e) => qqChange('miles', e.target.value)} placeholder="0" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Tire $</label>
            <input type="number" inputMode="decimal" value={qqForm.tireCost} onChange={(e) => qqChange('tireCost', e.target.value)} placeholder="0" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Qty</label>
            <input type="number" inputMode="numeric" value={qqForm.qty} onChange={(e) => qqChange('qty', e.target.value)} placeholder="1" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {([
            ['emergency', '🚨 Emergency'],
            ['lateNight', '🌙 Late'],
            ['highway', '🛣 Hwy'],
            ['weekend', '📅 Wknd'],
          ] as const).map(([k, l]) => (
            <button key={k} className={'chip sm' + (qqForm[k] ? ' active' : '')} onClick={() => qqChange(k, !qqForm[k])}>{l}</button>
          ))}
        </div>
        <div className="qq-pricing-row">
          <div className={'qq-price-tile' + (qqMode === 'suggested' ? ' active' : '')}
            onClick={() => setQqMode('suggested')} role="button">
            <div className="qq-price-tile-label">Suggested</div>
            <div className="qq-price-tile-amount">{money(quote.suggested)}</div>
          </div>
          <div className={'qq-price-tile premium' + (qqMode === 'premium' ? ' active' : '')}
            onClick={() => setQqMode('premium')} role="button">
            <div className="qq-price-tile-label">Premium</div>
            <div className="qq-price-tile-amount">{money(quote.premium)}</div>
          </div>
        </div>
        <div className="qq-meta">Direct cost {money(quote.directCosts)} · target profit {money(quote.targetProfit)}</div>
        <button className="cta-btn press-scale qq-cta" onClick={handleStartJob}>
          Start Job at {money(qqMode === 'suggested' ? quote.suggested : quote.premium)} →
        </button>
      </div>

      {/* ─── 7. Lead Sources — owner/admin only ──────────────────── */}
      {showCompanyData && sources.length > 0 && (
        <>
          <div className="section-label">Lead Sources</div>
          <div className="card card-anim">
            <div className="card-pad">
              {sources.slice(0, 5).map(([name, count]) => (
                <div key={name} className="source-bar">
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', width: 80, flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                  <div className="source-bar-track"><div className="source-bar-fill" style={{ width: (count / maxSrc) * 100 + '%' }} /></div>
                  <span className="num" style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)', width: 30, textAlign: 'right', flexShrink: 0 }}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ─── 8. Recent Completed Jobs ────────────────────────────── */}
      {recentCompleted.length > 0 && (
        <>
          <div className="section-label">
            {isTechnician ? 'Your Recent Jobs' : 'Recent Completed Jobs'}
          </div>
          <div className="stack">
            {recentCompleted.map((j) => {
              const pr = jobGrossProfit(j, settings);
              const ps = resolvePaymentStatus(j);
              return (
                <div key={j.id} className="job-card card-anim">
                  <div className="job-card-main" onClick={() => onViewJob(j)}>
                    <div className="job-icon">{serviceIcon(j.service)}</div>
                    <div className="job-main">
                      <div className="job-title">{j.customerName || j.service}</div>
                      <div className="job-meta">
                        {j.service} · {j.fullLocationLabel || j.area || '—'} · {fmtDate(j.date)}
                        {j.tireSize ? ' · ' + j.tireSize : ''}
                      </div>
                    </div>
                    <div className="job-right">
                      {/* Revenue is owner/admin-only on the job card.
                          Technicians see profit + payment pill but
                          not company revenue. */}
                      {showCompanyData && (
                        <div className="value green">{money(j.revenue)}</div>
                      )}
                      <div style={{ fontSize: 11, color: pr >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                        {money(pr)} profit
                      </div>
                      <span className={'pill ' + paymentPillClass(ps)} style={{ marginTop: 4 }}>{ps}</span>
                    </div>
                  </div>
                  <div className="job-card-actions">
                    <button onClick={() => onGenerateInvoice(j)}>📄 Invoice</button>
                    <button onClick={() => onSendReview(j)}>⭐ Review</button>
                    <button onClick={() => onEditJob(j)}>✏️ Edit</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div style={{ marginTop: 28, marginBottom: 4 }}>
        <button className="cta-btn press-scale" onClick={() => setTab('add')}>
          ＋ Log New Job
        </button>
      </div>
    </div>
  );
}
