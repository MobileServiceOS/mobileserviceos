import { useEffect, useMemo, useState } from 'react';
import type { Job, Settings, InventoryItem, QuoteForm, TabId } from '@/types';
import {
  calcQuote, clamp, fmtDate, getWeekStart,
  jobGrossProfit, money, monthlyFixed, normalizeTireSize, paymentPillClass,
  r2, resolvePaymentStatus, serviceIcon, weekSummary,
} from '@/lib/utils';
import { DEFAULT_SERVICE_PRICING, DEFAULT_VEHICLE_PRICING, TODAY } from '@/lib/defaults';
import { useCountUp } from '@/lib/useCountUp';

interface Props {
  jobs: Job[];
  settings: Settings;
  inventory: InventoryItem[];
  setTab: (t: TabId) => void;
  onStartJob: (form: QuoteForm) => void;
  onViewJob: (j: Job) => void;
  onGenerateInvoice: (j: Job) => void;
  onSendReview: (j: Job) => void;
  onMarkPaid: (j: Job) => void;
  onEditJob: (j: Job) => void;
}

export function Dashboard({
  jobs, settings, inventory, setTab,
  onStartJob, onViewJob, onGenerateInvoice, onSendReview, onMarkPaid, onEditJob,
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

  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const today = TODAY();
  const thisWeek = getWeekStart(today);
  const completedJobs = useMemo(() => safeJobs.filter((j) => j.status === 'Completed'), [safeJobs]);
  const weekJobs = useMemo(() => completedJobs.filter((j) => getWeekStart(j.date) === thisWeek), [completedJobs, thisWeek]);
  const todayJobs = useMemo(() => completedJobs.filter((j) => j.date === today), [completedJobs, today]);
  const totals = useMemo(() => weekSummary(weekJobs, settings), [weekJobs, settings]);
  const avgProfit = weekJobs.length ? r2(totals.grossProfit / weekJobs.length) : 0;
  const goalPct = clamp((totals.grossProfit / (settings.weeklyGoal || 1)) * 100, 0, 100);
  const jobsNeeded = avgProfit > 0 ? Math.max(0, Math.ceil(((settings.weeklyGoal || 0) - totals.grossProfit) / avgProfit)) : '—';
  const weeklyExpenses = r2(monthlyFixed(settings) / 4.33);

  const sources = useMemo(() => {
    const m: Record<string, number> = {};
    safeJobs.forEach((j) => { const s = j.source || 'Other'; m[s] = (m[s] || 0) + 1; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [safeJobs]);
  const maxSrc = sources.length ? sources[0][1] : 1;

  const pendingPaymentJobs = useMemo(
    () => safeJobs.filter((j) => resolvePaymentStatus(j) === 'Pending Payment'),
    [safeJobs]
  );
  const pendingPaymentTotal = pendingPaymentJobs.reduce((s, j) => s + Number(j.revenue || 0), 0);
  const pendingJobs = useMemo(() => safeJobs.filter((j) => j.status === 'Pending'), [safeJobs]);
  const pendingTotal = pendingJobs.reduce((s, j) => s + Number(j.revenue || 0), 0);

  const recentCompleted = useMemo(() =>
    [...completedJobs]
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.id || '').localeCompare(a.id || ''))
      .slice(0, 5),
    [completedJobs]
  );

  const lowStock = useMemo(() => {
    const inv = Array.isArray(inventory) ? inventory : [];
    const top5Tires = (() => {
      const c: Record<string, number> = {};
      safeJobs.forEach((j) => { if (j.tireSize) c[j.tireSize] = (c[j.tireSize] || 0) + Number(j.qty || 1); });
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
  }, [safeJobs, inventory]);

  const quote = useMemo(() => calcQuote(qqForm, settings), [qqForm, settings]);
  const heroValue = useCountUp(totals.grossProfit);

  const handleStartJob = () => {
    onStartJob({ ...qqForm, revenue: qqMode === 'suggested' ? quote.suggested : quote.premium });
  };

  return (
    <div className="page page-enter dashboard-page">
      {pendingJobs.length > 0 && (
        <div className="pending-banner card-anim" onClick={() => setTab('history')}>
          <div>
            <div className="pending-banner-title">{pendingJobs.length} Pending Job{pendingJobs.length > 1 ? 's' : ''}</div>
            <div className="pending-banner-sub">{money(pendingTotal)} awaiting completion</div>
          </div>
          <span style={{ fontSize: 18 }}>→</span>
        </div>
      )}

      <div className="pro-hero card-anim">
        <div className="pro-hero-head">
          <div className="pro-hero-label">This Week's Profit</div>
          <div className={'pro-hero-goal-pct ' + (goalPct >= 100 ? 'full' : goalPct >= 50 ? 'mid' : 'low')}>
            {Math.round(goalPct)}%
          </div>
        </div>
        <div className="hero-amount">
          <span className="currency">$</span>{Math.floor(heroValue).toLocaleString()}
        </div>
        <div className="goal-track">
          <div className={'goal-fill ' + (goalPct >= 100 ? 'full' : goalPct >= 50 ? 'mid' : 'low')}
            style={{ width: goalPct + '%' }} />
        </div>
        <div className="pro-hero-foot">
          <span>{money(settings.weeklyGoal || 0)} weekly goal</span>
          <span>
            {jobsNeeded === '—' || jobsNeeded === 0
              ? goalPct >= 100 ? 'Goal hit ✓' : '—'
              : `${jobsNeeded} more job${jobsNeeded === 1 ? '' : 's'} to goal`}
          </span>
        </div>
        <div className="pro-hero-strip">
          <div className="pro-hero-stat">
            <div className="pro-hero-stat-label">Revenue</div>
            <div className="pro-hero-stat-value">{money(totals.revenue)}</div>
          </div>
          <div className="pro-hero-stat">
            <div className="pro-hero-stat-label">Expenses</div>
            <div className="pro-hero-stat-value red">{money(weeklyExpenses)}</div>
          </div>
          <div className="pro-hero-stat">
            <div className="pro-hero-stat-label">Pending</div>
            <div className={'pro-hero-stat-value ' + (pendingPaymentTotal > 0 ? 'amber' : '')}>
              {money(pendingPaymentTotal)}
            </div>
          </div>
        </div>
      </div>

      <div className="kpi-grid kpi-grid-tight card-anim">
        <div className="kpi">
          <div className="kpi-label">Today</div>
          <div className="kpi-value">{todayJobs.length}</div>
          <div className="kpi-sub">job{todayJobs.length !== 1 ? 's' : ''} completed</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">This Week</div>
          <div className="kpi-value">{weekJobs.length}</div>
          <div className="kpi-sub">job{weekJobs.length !== 1 ? 's' : ''} done</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Avg Job</div>
          <div className="kpi-value">{money(weekJobs.length ? totals.revenue / weekJobs.length : 0)}</div>
          <div className="kpi-sub">revenue / job</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Avg Profit</div>
          <div className="kpi-value green">{money(avgProfit)}</div>
          <div className="kpi-sub">per completed job</div>
        </div>
      </div>

      {pendingPaymentJobs.length > 0 && (
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

      {lowStock.length > 0 && (
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

      <div className="section-label with-action">
        <span>Quick Quote</span>
        <span className="section-label-hint">Tap a price to start the job</span>
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

      {sources.length > 0 && (
        sources.length === 1 ? (
          <div className="insight-card card-anim">
            <div className="insight-card-icon">📈</div>
            <div className="insight-card-body">
              <div className="insight-card-label">Top Lead Source</div>
              <div className="insight-card-value">
                {sources[0][0]} <span className="insight-card-meta">· {sources[0][1]} job{sources[0][1] !== 1 ? 's' : ''}</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="section-label">Top Lead Sources</div>
            <div className="card card-anim">
              <div className="card-pad lead-sources-pad">
                {sources.slice(0, 3).map(([name, count]) => (
                  <div key={name} className="source-bar">
                    <span className="source-bar-name">{name}</span>
                    <div className="source-bar-track">
                      <div className="source-bar-fill" style={{ width: (count / maxSrc) * 100 + '%' }} />
                    </div>
                    <span className="source-bar-count num">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )
      )}

      {recentCompleted.length > 0 && (
        <>
          <div className="section-label with-action">
            <span>Recent Jobs</span>
            <button className="section-label-action" onClick={() => setTab('history')}>View all →</button>
          </div>
          <div className="stack">
            {recentCompleted.map((j) => {
              const pr = jobGrossProfit(j, settings);
              const ps = resolvePaymentStatus(j);
              const locDisplay = j.fullLocationLabel || j.area || '';
              return (
                <div key={j.id} className="job-card premium card-anim">
                  <div className="job-card-main" onClick={() => onViewJob(j)}>
                    <div className="job-icon">{serviceIcon(j.service)}</div>
                    <div className="job-main">
                      <div className="job-title">{j.customerName || 'Customer'}</div>
                      <div className="job-meta">
                        <span className="job-meta-service">{j.service}</span>
                        {locDisplay ? <span className="job-meta-dot">·</span> : null}
                        {locDisplay ? <span>{locDisplay}</span> : null}
                        <span className="job-meta-dot">·</span>
                        <span>{fmtDate(j.date)}</span>
                      </div>
                    </div>
                    <div className="job-right">
                      <div className="job-revenue">{money(j.revenue)}</div>
                      <div className={'job-profit ' + (pr >= 0 ? 'green' : 'red')}>
                        +{money(pr)} profit
                      </div>
                      <span className={'pill ' + paymentPillClass(ps)}>{ps}</span>
                    </div>
                  </div>
                  <div className="job-card-actions premium">
                    <button onClick={() => onGenerateInvoice(j)} className="job-action">
                      <span className="job-action-ico">📄</span>
                      <span>Invoice</span>
                    </button>
                    <button onClick={() => onSendReview(j)} className="job-action">
                      <span className="job-action-ico">⭐</span>
                      <span>Review</span>
                    </button>
                    <button onClick={() => onEditJob(j)} className="job-action">
                      <span className="job-action-ico">✏️</span>
                      <span>Edit</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="dashboard-cta-spacer">
        <button className="cta-btn press-scale" onClick={() => setTab('add')}>＋ Log New Job</button>
      </div>
    </div>
  );
}
