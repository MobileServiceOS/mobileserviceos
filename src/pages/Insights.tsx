import { useMemo, useState } from 'react';
import type { Job, Settings } from '@/types';
import { money, fmtDate } from '@/lib/utils';
import { TODAY } from '@/lib/defaults';
import { computeInsights } from '@/lib/insights';
import { callAI, isAIConfigured } from '@/lib/aiClient';
import { buildInsightsInput, parseInsightsResponse } from '@/lib/aiInsights';
import { PricingInsightsCard } from '@/components/insights/PricingInsightsCard';
import { BestSellersCard } from '@/components/insights/BestSellersCard';
import { useBrand } from '@/context/BrandContext';

interface Props {
  jobs: Job[];
  settings: Settings;
}

// ─────────────────────────────────────────────────────────────────────
//  Insights — owner/admin business analytics. Everything derives
//  live from jobs via computeInsights(). Charts are hand-rolled with
//  CSS tokens — no charting library.
// ─────────────────────────────────────────────────────────────────────

export function Insights({ jobs, settings }: Props) {
  const { businessId } = useBrand();

  const ins = useMemo(
    () => computeInsights(jobs, settings, TODAY()),
    [jobs, settings],
  );

  // AI Insights — on-demand owner briefing. The digest is derived
  // once from `ins`; `hasData` gates the button so the AI is never
  // asked to summarise an empty business.
  const aiDigest = useMemo(() => buildInsightsInput(ins), [ins]);
  const hasData = aiDigest.totalRevenue8w > 0 || aiDigest.topServices.length > 0;
  const [aiState, setAiState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [aiBullets, setAiBullets] = useState<string[]>([]);

  const handleAiSummary = async () => {
    setAiState('loading');
    setAiBullets([]);
    const res = await callAI('insights', aiDigest);
    if (!res.ok || !res.text) { setAiState('error'); return; }
    const parsed = parseInsightsResponse(res.text, aiDigest);
    if (!parsed.ok) { setAiState('error'); return; }
    setAiBullets(parsed.bullets);
    setAiState('done');
  };

  const trendMax = Math.max(1, ...ins.revenueTrend.map((w) => w.revenue));
  const trendRevenue = ins.revenueTrend.reduce((s, w) => s + w.revenue, 0);
  const trendProfit = ins.revenueTrend.reduce((s, w) => s + w.profit, 0);
  const unpaidTotal = ins.unpaidAging.reduce((s, r) => s + r.total, 0);

  return (
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Insights</div>

      {isAIConfigured() && (
        <div className="ai-summary">
          <button
            className="ai-summary-btn press-scale"
            onClick={handleAiSummary}
            disabled={aiState === 'loading' || !hasData}
          >
            {aiState === 'loading' ? 'Summarising…' : '✨ AI summary'}
          </button>
          {aiState === 'done' && aiBullets.length > 0 && (
            <div className="ai-summary-card card-anim">
              <div className="ai-summary-label">AI summary</div>
              <ul className="ai-summary-list">
                {aiBullets.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
          )}
          {aiState === 'error' && (
            <div className="ai-summary-error">Couldn't generate a summary — try again.</div>
          )}
        </div>
      )}
      <PricingInsightsCard jobs={jobs} settings={settings} businessId={businessId} />
      <BestSellersCard jobs={jobs} />

      {/* ── Daily job stats (Phase 5) ─────────────────────────── */}
      <div className="form-group">
        <div className="form-group-title">Daily Jobs</div>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
          gap: 10, marginBottom: 10,
        }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1 }}>Today</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{ins.dailyJobs.jobsToday}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1 }}>This week</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{ins.dailyJobs.jobsThisWeek}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1 }}>Avg / day</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>
              {ins.dailyJobs.avgPerDay.toFixed(1)}
            </div>
          </div>
        </div>
        {(ins.dailyJobs.bestDayThisWeek || ins.dailyJobs.busiestServiceToday) && (
          <div style={{ paddingTop: 8, borderTop: '1px solid var(--border2)' }}>
            {ins.dailyJobs.bestDayThisWeek && (
              <div className="card-row" style={{ padding: '6px 0', fontSize: 12 }}>
                <span className="label">Best day this week</span>
                <span className="value">
                  {fmtDate(ins.dailyJobs.bestDayThisWeek.date)} ·{' '}
                  <strong>{ins.dailyJobs.bestDayThisWeek.count} job{ins.dailyJobs.bestDayThisWeek.count !== 1 ? 's' : ''}</strong>
                </span>
              </div>
            )}
            {ins.dailyJobs.busiestServiceToday && (
              <div className="card-row" style={{ padding: '6px 0', fontSize: 12 }}>
                <span className="label">Busiest service today</span>
                <span className="value">
                  {ins.dailyJobs.busiestServiceToday.service} ·{' '}
                  <strong>{ins.dailyJobs.busiestServiceToday.count}</strong>
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Revenue trend ──────────────────────────────────────── */}
      <div className="form-group">
        <div className="form-group-title">Revenue — Last 8 Weeks</div>
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 6,
          height: 110, marginBottom: 8,
        }}>
          {ins.revenueTrend.map((w) => (
            <div key={w.weekStart} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: '100%',
                height: Math.max(2, Math.round((w.revenue / trendMax) * 88)),
                background: 'linear-gradient(180deg, var(--brand-primary) 0%, rgba(244,180,0,.35) 100%)',
                borderRadius: '4px 4px 0 0',
              }} title={`${fmtDate(w.weekStart)} · ${money(w.revenue)}`} />
              <div style={{ fontSize: 8, color: 'var(--t3)' }}>
                {fmtDate(w.weekStart).split(' ')[1] || ''}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: 'var(--t3)' }}>8-wk revenue <strong style={{ color: 'var(--green)' }}>{money(trendRevenue)}</strong></span>
          <span style={{ color: 'var(--t3)' }}>profit <strong style={{ color: trendProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{money(trendProfit)}</strong></span>
        </div>
      </div>

      {/* ── Repeat customers ───────────────────────────────────── */}
      <div className="form-group">
        <div className="form-group-title">Repeat Customers</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 34, fontWeight: 800, color: 'var(--green)', lineHeight: 1 }}>
            {ins.repeat.pct}%
          </span>
          <span style={{ fontSize: 12, color: 'var(--t3)' }}>
            {ins.repeat.repeat} of {ins.repeat.total} customer{ins.repeat.total !== 1 ? 's' : ''} booked more than once
          </span>
        </div>
      </div>

      {/* ── Top services ───────────────────────────────────────── */}
      <RankedCard
        title="Top Services — by Profit"
        rows={ins.topServices.slice(0, 6).map((s) => ({
          label: s.service,
          sub: `${s.count} job${s.count !== 1 ? 's' : ''} · ${money(s.revenue)} revenue`,
          value: s.profit,
          valueLabel: money(s.profit),
        }))}
      />

      {/* ── Top lead sources ───────────────────────────────────── */}
      <RankedCard
        title="Top Lead Sources — by Revenue"
        rows={ins.topSources.slice(0, 6).map((s) => ({
          label: s.source,
          sub: `${s.count} job${s.count !== 1 ? 's' : ''}`,
          value: s.revenue,
          valueLabel: money(s.revenue),
        }))}
      />

      {/* ── Top cities ─────────────────────────────────────────── */}
      <RankedCard
        title="Most Profitable Cities"
        rows={ins.topCities.slice(0, 6).map((c) => ({
          label: c.city,
          sub: `${c.count} job${c.count !== 1 ? 's' : ''}`,
          value: c.profit,
          valueLabel: money(c.profit),
        }))}
      />

      {/* ── Unpaid aging ───────────────────────────────────────── */}
      <div className="form-group">
        <div className="form-group-title">Unpaid Invoice Aging</div>
        {unpaidTotal === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--t3)' }}>
            Nothing outstanding — every job is paid.
          </div>
        ) : (
          <>
            {ins.unpaidAging.map((r) => (
              <div key={r.bucket} className="card-row" style={{ padding: '7px 0' }}>
                <span className="label">{r.bucket}</span>
                <span className="value" style={{ fontWeight: 600 }}>
                  {r.count} job{r.count !== 1 ? 's' : ''}
                  <span style={{
                    color: r.bucket === '60d+' && r.total > 0 ? 'var(--red)' : 'var(--t1)',
                    marginLeft: 8, fontWeight: 700,
                  }}>{money(r.total)}</span>
                </span>
              </div>
            ))}
            <div className="card-row total" style={{ padding: '8px 0 0' }}>
              <span className="label">Total outstanding</span>
              <span className="value red" style={{ fontWeight: 800 }}>{money(unpaidTotal)}</span>
            </div>
          </>
        )}
      </div>

      {/* ── Expense analysis (Phase 5) ─────────────────────────── */}
      <div className="form-group">
        <div className="form-group-title">Expenses — Last 8 Weeks</div>
        <div className="card-row" style={{ padding: '6px 0' }}>
          <span className="label">Business net profit</span>
          <span
            className="value"
            style={{
              fontWeight: 800,
              color: ins.expenseAnalysis.netProfit8w >= 0 ? 'var(--green)' : 'var(--red)',
            }}
          >
            {money(ins.expenseAnalysis.netProfit8w)}
          </span>
        </div>
        <div className="card-row" style={{ padding: '6px 0' }}>
          <span className="label">Recurring monthly burden</span>
          <span className="value" style={{ fontWeight: 700 }}>
            {money(ins.expenseAnalysis.monthlyRecurringBurden)}/mo
          </span>
        </div>

        {/* Cost trend bars — mirror the Revenue trend visual so the
            two charts read side-by-side. */}
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, marginBottom: 6 }}>
            Weekly cost trend
          </div>
          {(() => {
            const max = Math.max(1, ...ins.expenseAnalysis.weeklyExpenseTrend.map((w) => w.total));
            return (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80 }}>
                {ins.expenseAnalysis.weeklyExpenseTrend.map((w) => (
                  <div key={w.weekStart} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div
                      style={{
                        width: '100%',
                        height: Math.max(2, Math.round((w.total / max) * 64)),
                        background: 'linear-gradient(180deg, rgba(239,68,68,.85) 0%, rgba(239,68,68,.30) 100%)',
                        borderRadius: '4px 4px 0 0',
                      }}
                      title={`${fmtDate(w.weekStart)} · ${money(w.total)}`}
                    />
                    <div style={{ fontSize: 8, color: 'var(--t3)' }}>
                      {fmtDate(w.weekStart).split(' ')[1] || ''}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>

      {/* ── Top cost categories (Phase 5) ──────────────────────── */}
      <RankedCard
        title="Top Cost Categories"
        rows={ins.expenseAnalysis.topCategoriesByCost.slice(0, 6).map((c) => ({
          label: c.label,
          sub: `${money(c.total)} over 8 weeks`,
          value: c.total,
          valueLabel: money(c.total),
        }))}
      />
    </div>
  );
}

// ─── Ranked list card — proportional bars ──────────────────────────
interface RankedRow {
  label: string;
  sub: string;
  value: number;
  valueLabel: string;
}

function RankedCard({ title, rows }: { title: string; rows: RankedRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="form-group">
      <div className="form-group-title">{title}</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--t3)' }}>Not enough data yet.</div>
      ) : (
        rows.map((r, i) => (
          <div key={r.label + i} style={{ padding: '7px 0', position: 'relative' }}>
            {/* proportional bar behind the row */}
            <div style={{
              position: 'absolute', left: 0, top: 4, bottom: 4,
              width: `${Math.max(3, Math.round((r.value / max) * 100))}%`,
              background: 'rgba(244,180,0,.10)',
              borderRadius: 6,
            }} />
            <div style={{
              position: 'relative', display: 'flex',
              justifyContent: 'space-between', alignItems: 'center', gap: 8,
            }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.label}
                </span>
                <span style={{ display: 'block', fontSize: 10, color: 'var(--t3)' }}>{r.sub}</span>
              </span>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--green)', flexShrink: 0 }}>
                {r.valueLabel}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
