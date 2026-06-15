import { useMemo, useState } from 'react';
import type { Job, Settings } from '@/types';
import { money, fmtDate } from '@/lib/utils';
import { TODAY } from '@/lib/defaults';
import { computeInsights } from '@/lib/insights';
import { computeBestSellingTires } from '@/lib/bestSellingTires';
import { BestSellersCard } from '@/components/insights/BestSellersCard';
import { AccordionShell } from '@/components/settings/AccordionShell';

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
  const ins = useMemo(
    () => computeInsights(jobs, settings, TODAY()),
    [jobs, settings],
  );

  const trendMax = Math.max(1, ...ins.revenueTrend.map((w) => w.revenue));
  const trendRevenue = ins.revenueTrend.reduce((s, w) => s + w.revenue, 0);
  const trendProfit = ins.revenueTrend.reduce((s, w) => s + w.profit, 0);
  const unpaidTotal = ins.unpaidAging.reduce((s, r) => s + r.total, 0);

  // ─── Accordion open-state for each section ───────────────────────
  // Daily Jobs is the headline → opens by default. Everything else
  // collapses. The dropdown chevron toggles, and multiple sections
  // can be open at once (matches the Settings accordion behavior).
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    dailyJobs: true,
    revenue: false,
    repeat: false,
    topServices: false,
    topSources: false,
    topCities: false,
    bestSellers: false,
    unpaid: false,
    expenses: false,
    topCosts: false,
  });
  const toggle = (key: string) => () =>
    setOpenSections((p) => ({ ...p, [key]: !p[key] }));

  // ─── Summary lines for collapsed-state preview ───────────────────
  // Each accordion shows a short data-line in its summary so the
  // value is visible without expanding. Truncated when no data.
  // This week's #1 tire — drives the Best Sellers accordion summary so
  // the weekly winner is visible without expanding.
  const weeklyTopTire = useMemo(
    () => computeBestSellingTires(jobs, { windowDays: 7, limit: 1 })[0],
    [jobs],
  );
  const topService = ins.topServices[0];
  const topSource = ins.topSources[0];
  const topCity = ins.topCities[0];
  const topCost = ins.expenseAnalysis.topCategoriesByCost[0];

  return (
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Insights</div>

      {/* ── Daily job stats (Phase 5) ─────────────────────────── */}
      <AccordionShell
        title="Daily Jobs"
        icon="📋"
        summary={`${ins.dailyJobs.jobsToday} today · ${ins.dailyJobs.jobsThisWeek} this week · avg ${ins.dailyJobs.avgPerDay.toFixed(1)}/day`}
        open={openSections.dailyJobs}
        onToggle={toggle('dailyJobs')}
      >
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
      </AccordionShell>

      {/* ── Revenue trend ──────────────────────────────────────── */}
      <AccordionShell
        title="Revenue — Last 8 Weeks"
        icon="📈"
        summary={`${money(trendRevenue)} revenue · ${money(trendProfit)} profit`}
        open={openSections.revenue}
        onToggle={toggle('revenue')}
      >
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
      </AccordionShell>

      {/* ── Repeat customers ───────────────────────────────────── */}
      <AccordionShell
        title="Repeat Customers"
        icon="🔁"
        summary={ins.repeat.total > 0 ? `${ins.repeat.pct}% repeat rate · ${ins.repeat.repeat} of ${ins.repeat.total}` : 'No customers yet'}
        open={openSections.repeat}
        onToggle={toggle('repeat')}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 34, fontWeight: 800, color: 'var(--green)', lineHeight: 1 }}>
            {ins.repeat.pct}%
          </span>
          <span style={{ fontSize: 12, color: 'var(--t3)' }}>
            {ins.repeat.repeat} of {ins.repeat.total} customer{ins.repeat.total !== 1 ? 's' : ''} booked more than once
          </span>
        </div>
      </AccordionShell>

      {/* ── Top services ───────────────────────────────────────── */}
      <AccordionShell
        title="Top Services — by Profit"
        icon="⭐"
        summary={topService ? `${topService.service} · ${money(topService.profit)} profit` : 'No completed jobs yet'}
        open={openSections.topServices}
        onToggle={toggle('topServices')}
      >
        <RankedCard
          rows={ins.topServices.slice(0, 6).map((s) => ({
            label: s.service,
            sub: `${s.count} job${s.count !== 1 ? 's' : ''} · ${money(s.revenue)} revenue`,
            value: s.profit,
            valueLabel: money(s.profit),
          }))}
        />
      </AccordionShell>

      {/* ── Top lead sources ───────────────────────────────────── */}
      <AccordionShell
        title="Top Lead Sources — by Revenue"
        icon="📣"
        summary={topSource ? `${topSource.source} · ${money(topSource.revenue)}` : 'No lead-source data yet'}
        open={openSections.topSources}
        onToggle={toggle('topSources')}
      >
        <RankedCard
          rows={ins.topSources.slice(0, 6).map((s) => ({
            label: s.source,
            sub: `${s.count} job${s.count !== 1 ? 's' : ''}`,
            value: s.revenue,
            valueLabel: money(s.revenue),
          }))}
        />
      </AccordionShell>

      {/* ── Top cities ─────────────────────────────────────────── */}
      <AccordionShell
        title="Most Profitable Cities"
        icon="📍"
        summary={topCity ? `${topCity.city} · ${money(topCity.profit)} profit` : 'No city data yet'}
        open={openSections.topCities}
        onToggle={toggle('topCities')}
      >
        <RankedCard
          rows={ins.topCities.slice(0, 6).map((c) => ({
            label: c.city,
            sub: `${c.count} job${c.count !== 1 ? 's' : ''}`,
            value: c.profit,
            valueLabel: money(c.profit),
          }))}
        />
      </AccordionShell>

      {/* ── Best selling tires ─────────────────────────────────── */}
      <AccordionShell
        title="Best Selling Tires"
        icon="🛞"
        summary={weeklyTopTire
          ? `This week: ${weeklyTopTire.tireSize} · ${weeklyTopTire.quantity} sold`
          : 'No tire sales this week yet'}
        open={openSections.bestSellers}
        onToggle={toggle('bestSellers')}
      >
        <BestSellersCard jobs={jobs} />
      </AccordionShell>

      {/* ── Unpaid aging ───────────────────────────────────────── */}
      <AccordionShell
        title="Unpaid Invoice Aging"
        icon="⏰"
        summary={unpaidTotal > 0 ? `${money(unpaidTotal)} outstanding` : 'Everything paid'}
        open={openSections.unpaid}
        onToggle={toggle('unpaid')}
      >
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
      </AccordionShell>

      {/* ── Expense analysis (Phase 5) ─────────────────────────── */}
      <AccordionShell
        title="Expenses — Last 8 Weeks"
        icon="💰"
        summary={`Net ${money(ins.expenseAnalysis.netProfit8w)} · ${money(ins.expenseAnalysis.monthlyRecurringBurden)}/mo recurring`}
        open={openSections.expenses}
        onToggle={toggle('expenses')}
      >
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
      </AccordionShell>

      {/* ── Top cost categories (Phase 5) ──────────────────────── */}
      <AccordionShell
        title="Top Cost Categories"
        icon="📊"
        summary={topCost ? `${topCost.label} · ${money(topCost.total)} over 8 weeks` : 'No expenses logged'}
        open={openSections.topCosts}
        onToggle={toggle('topCosts')}
      >
        <RankedCard
          rows={ins.expenseAnalysis.topCategoriesByCost.slice(0, 6).map((c) => ({
            label: c.label,
            sub: `${money(c.total)} over 8 weeks`,
            value: c.total,
            valueLabel: money(c.total),
          }))}
        />
      </AccordionShell>
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

function RankedCard({ rows }: { rows: RankedRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
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
