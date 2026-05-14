import { useMemo } from 'react';
import type { Job, Settings } from '@/types';
import { getWeekStart, jobGrossProfit, money, monthlyFixed, formatWeekRange, formatMonth, getMonth } from '@/lib/utils';
import { TODAY } from '@/lib/defaults';

// ─────────────────────────────────────────────────────────────────────
//  Payouts — owner cash distribution view
//
//  Shows:
//    1. Hero: this week's distributable (with week range)
//    2. This week's profit / fixed / net / tax / distributable breakdown
//    3. Owner split allocations
//    4. Recent Weeks (8 weeks) — each with start→end date range
//    5. Recent Months (6 months) — each with full month name
//
//  All historical rows include start→end dates so the user always
//  knows which period they're looking at.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  jobs: Job[];
  settings: Settings;
}

export function Payouts({ jobs, settings }: Props) {
  const completedJobs = useMemo(() => (jobs || []).filter((j) => j.status === 'Completed'), [jobs]);
  const weekStartDay = typeof settings.workWeekStartDay === 'number' ? settings.workWeekStartDay : 1;
  const thisWeek = getWeekStart(TODAY(), weekStartDay);
  const thisWeekRange = formatWeekRange(thisWeek);
  const weekJobs = completedJobs.filter((j) => getWeekStart(j.date, weekStartDay) === thisWeek);

  const weekProfit = weekJobs.reduce((t, j) => t + jobGrossProfit(j, settings), 0);
  const fixed = monthlyFixed(settings);
  const weeklyFixed = fixed / 4.33;
  const netWeekly = weekProfit - weeklyFixed;
  const taxReserve = netWeekly * Number(settings.taxRate || 0) / 100;
  const distributable = netWeekly - taxReserve;

  const owner1Share = settings.owner1Active ? Number(settings.profitSplit1 || 0) : 0;
  const owner2Share = settings.owner2Active ? Number(settings.profitSplit2 || 0) : 0;
  const totalShare = owner1Share + owner2Share || 100;
  const owner1Cut = distributable * (owner1Share / totalShare);
  const owner2Cut = distributable * (owner2Share / totalShare);

  const weekBreakdown = useMemo(() => {
    const weeks: Record<string, { revenue: number; profit: number; count: number }> = {};
    completedJobs.forEach((j) => {
      const w = getWeekStart(j.date, weekStartDay);
      if (!weeks[w]) weeks[w] = { revenue: 0, profit: 0, count: 0 };
      weeks[w].revenue += Number(j.revenue || 0);
      weeks[w].profit += jobGrossProfit(j, settings);
      weeks[w].count += 1;
    });
    return Object.entries(weeks)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 8);
  }, [completedJobs, settings, weekStartDay]);

  const monthBreakdown = useMemo(() => {
    const months: Record<string, { revenue: number; profit: number; count: number }> = {};
    completedJobs.forEach((j) => {
      const m = getMonth(j.date);
      if (!m) return;
      if (!months[m]) months[m] = { revenue: 0, profit: 0, count: 0 };
      months[m].revenue += Number(j.revenue || 0);
      months[m].profit += jobGrossProfit(j, settings);
      months[m].count += 1;
    });
    return Object.entries(months)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 6)
      .map(([m, d]) => ({
        month: m,
        ...d,
        net: d.profit - fixed,
      }));
  }, [completedJobs, settings, fixed]);

  return (
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Payouts</div>

      <div className="pro-hero card-anim">
        <div className="pro-hero-label">This Week's Distributable</div>
        <div className="hero-amount"><span className="currency">$</span>{Math.floor(Math.max(0, distributable)).toLocaleString()}</div>
        <div className="pro-hero-foot">
          <span>{thisWeekRange}</span>
          <span>Tax reserve {money(taxReserve)} ({settings.taxRate}%)</span>
        </div>
      </div>

      <div className="form-group card-anim">
        <div className="form-group-title">This Week's Breakdown</div>
        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: -8, marginBottom: 8 }}>{thisWeekRange}</div>
        <div className="card-row"><span className="label">Weekly profit</span><span className="value">{money(weekProfit)}</span></div>
        <div className="card-row"><span className="label">Fixed costs (weekly)</span><span className="value red">-{money(weeklyFixed)}</span></div>
        <div className="card-row"><span className="label">Net</span><span className="value">{money(netWeekly)}</span></div>
        <div className="card-row"><span className="label">Tax reserve</span><span className="value red">-{money(taxReserve)}</span></div>
        <div className="card-row total"><span className="label">Distributable</span><span className="value green">{money(distributable)}</span></div>
      </div>

      <div className="form-group card-anim">
        <div className="form-group-title">Owner Splits</div>
        {settings.owner1Active && (
          <div className="card-row"><span className="label">{settings.owner1Name || 'Owner 1'} ({owner1Share}%)</span><span className="value green">{money(owner1Cut)}</span></div>
        )}
        {settings.owner2Active && (
          <div className="card-row"><span className="label">{settings.owner2Name || 'Owner 2'} ({owner2Share}%)</span><span className="value green">{money(owner2Cut)}</span></div>
        )}
        {(!settings.owner1Active && !settings.owner2Active) && (
          <div style={{ fontSize: 12, color: 'var(--t3)' }}>No active owners — enable an owner in Settings.</div>
        )}
      </div>

      {weekBreakdown.length > 0 && (
        <>
          <div className="section-label">Recent Weeks</div>
          <div className="card card-anim">
            <div className="card-pad">
              {weekBreakdown.map(([w, d], i) => (
                <div key={w} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: i ? '1px solid var(--border2)' : 'none' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{formatWeekRange(w)}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>{d.count} job{d.count !== 1 ? 's' : ''}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="value">{money(d.revenue)}</div>
                    <div style={{ fontSize: 11, color: 'var(--green)' }}>profit {money(d.profit)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {monthBreakdown.length > 0 && (
        <>
          <div className="section-label">Recent Months</div>
          <div className="card card-anim">
            <div className="card-pad">
              {monthBreakdown.map((m, i) => (
                <div key={m.month} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: i ? '1px solid var(--border2)' : 'none' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{formatMonth(m.month)}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>{m.count} job{m.count !== 1 ? 's' : ''}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="value">{money(m.revenue)}</div>
                    <div style={{ fontSize: 11, color: m.net >= 0 ? 'var(--green)' : 'var(--red, #ef4444)' }}>
                      net {money(m.net)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
