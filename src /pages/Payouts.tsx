import { useMemo, useState } from 'react';
import type { Job, Settings } from '@/types';
import { money, monthSummary, r2 } from '@/lib/utils';
import { TODAY } from '@/lib/defaults';

interface Props {
  jobs: Job[];
  settings: Settings;
}

export function Payouts({ jobs, settings }: Props) {
  const safe = Array.isArray(jobs) ? jobs : [];
  const today = TODAY();
  const currentMonth = today.slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const months = useMemo(() => {
    const set = new Set<string>();
    safe.forEach((j) => {
      if (j.date) set.add(j.date.slice(0, 7));
    });
    set.add(currentMonth);
    return Array.from(set).sort().reverse();
  }, [safe, currentMonth]);
  const monthJobs = useMemo(
    () => safe.filter((j) => j.status === 'Completed' && (j.date || '').startsWith(month)),
    [safe, month]
  );
  const sum = monthSummary(monthJobs, settings);
  const o1Active = settings.owner1Active !== false;
  const o2Active = settings.owner2Active !== false;
  const totalSplit = (o1Active ? Number(settings.profitSplit1 || 0) : 0) + (o2Active ? Number(settings.profitSplit2 || 0) : 0);
  const o1Pay = totalSplit > 0 && o1Active ? r2((sum.net * Number(settings.profitSplit1 || 0)) / totalSplit) : 0;
  const o2Pay = totalSplit > 0 && o2Active ? r2((sum.net * Number(settings.profitSplit2 || 0)) / totalSplit) : 0;
  const taxReserve = r2(sum.net * (Number(settings.taxRate || 0) / 100));

  return (
    <div className="page page-enter">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Monthly Payouts</div>
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label>Month</label>
        <select value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>
              {new Date(m + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </option>
          ))}
        </select>
      </div>
      <div className="kpi-grid card-anim">
        <div className="kpi">
          <div className="kpi-label">Revenue</div>
          <div className="kpi-value">{money(sum.revenue)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Direct Cost</div>
          <div className="kpi-value">{money(sum.directCosts)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Gross Profit</div>
          <div className="kpi-value">{money(sum.grossProfit)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Net Profit</div>
          <div className="kpi-value" style={{ color: sum.net >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {money(sum.net)}
          </div>
        </div>
      </div>
      <div className="section-label">Breakdown</div>
      <div className="card card-anim">
        <div className="card-row">
          <span className="label">Tire Costs</span>
          <span className="value">{money(sum.tireCosts)}</span>
        </div>
        <div className="card-row">
          <span className="label">Material Costs</span>
          <span className="value">{money(sum.miscCosts)}</span>
        </div>
        <div className="card-row">
          <span className="label">Travel ({Number(settings.costPerMile || 0.65).toFixed(2)} / mi)</span>
          <span className="value">{money(sum.travelCosts)}</span>
        </div>
        <div className="card-row">
          <span className="label">Fixed Costs</span>
          <span className="value red">{money(sum.fixed)}</span>
        </div>
      </div>
      <div className="section-label">Owner Splits</div>
      <div className="card card-anim">
        {o1Active ? (
          <div className="card-row">
            <span className="label">
              {settings.owner1Name || 'Owner 1'} ({settings.profitSplit1 || 0}%)
            </span>
            <span className="value green">{money(o1Pay)}</span>
          </div>
        ) : null}
        {o2Active ? (
          <div className="card-row">
            <span className="label">
              {settings.owner2Name || 'Owner 2'} ({settings.profitSplit2 || 0}%)
            </span>
            <span className="value green">{money(o2Pay)}</span>
          </div>
        ) : null}
        {!o1Active && !o2Active && (
          <div className="card-row">
            <span className="label">No active owners</span>
            <span className="value">—</span>
          </div>
        )}
      </div>
      {Number(settings.taxRate || 0) > 0 && (
        <div className="tax-box">
          <div className="tax-lbl">Tax Reserve ({settings.taxRate || 0}%)</div>
          <div className="tax-amt">{money(taxReserve)}</div>
        </div>
      )}
      <div style={{ marginTop: 16, fontSize: 11, color: 'var(--t3)', textAlign: 'center' }}>
        Based on {monthJobs.length} completed job{monthJobs.length !== 1 ? 's' : ''} in{' '}
        {new Date(month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
      </div>
    </div>
  );
}
