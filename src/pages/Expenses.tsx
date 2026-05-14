import { useMemo, useState } from 'react';
import type { Expense, Job, Settings } from '@/types';
import {
  money,
  uid,
  getWeekStart,
  getMonth,
  formatWeekRange,
  formatMonth,
  monthlyFixed,
} from '@/lib/utils';
import { TODAY } from '@/lib/defaults';

// ─────────────────────────────────────────────────────────────────────
//  Expenses — recurring + historical actuals
//
//  This page is now two-in-one:
//
//    1. RECURRING — the same list of monthly fixed costs the user
//       configures (rent, insurance, subscriptions, etc.). These feed
//       into Payouts' weekly/monthly fixed-cost lines.
//
//    2. HISTORICAL ACTUALS — derived from each job's per-job expense
//       array (j.expenses) which captures one-time costs incurred ON
//       a specific job (parts, fuel for the trip, materials, etc.).
//       Bucketed by week and by month, each row labeled with a date
//       range so the user always knows the period.
//
//  Both sections live on the same screen with a tab switcher at the top
//  so the user picks "Recurring" or "History" without leaving the page.
// ─────────────────────────────────────────────────────────────────────

interface Props {
  expenses: Expense[];
  jobs: Job[];
  settings: Settings;
  onSave: (next: Expense[]) => void;
}

type Tab = 'recurring' | 'history';

export function Expenses({ expenses, jobs, settings, onSave }: Props) {
  const safe = Array.isArray(expenses) ? expenses : [];
  const [tab, setTab] = useState<Tab>('recurring');
  const [list, setList] = useState<Expense[]>(safe);
  const [dirty, setDirty] = useState(false);

  const update = (next: Expense[]) => { setList(next); setDirty(true); };
  const add = () => update([{ id: uid(), name: '', amount: 0, active: true }, ...list]);
  const remove = (id: string) => update(list.filter((e) => e.id !== id));
  const change = <K extends keyof Expense>(id: string, k: K, v: Expense[K]) =>
    update(list.map((e) => e.id === id ? { ...e, [k]: v } : e));

  const activeTotal = list.filter((e) => e.active).reduce((t, e) => t + Number(e.amount || 0), 0);

  const save = () => {
    const cleaned = list.filter((e) => (e.name || '').trim() || Number(e.amount || 0) > 0);
    onSave(cleaned);
    setDirty(false);
  };

  // ─── History tab math ─────────────────────────────────────────
  // Per-job expense arrays + tireCost roll up into actual operating
  // costs by date. Combined with the user's recurring monthly fixed
  // costs to give a true monthly burn view.
  const weekStartDay = typeof settings.workWeekStartDay === 'number' ? settings.workWeekStartDay : 1;
  const fixedMonthly = monthlyFixed(settings);
  const fixedWeekly = fixedMonthly / 4.33;

  /** Sum of all one-time costs incurred on a single completed job:
   *  tire cost + material cost + misc cost. These are the canonical
   *  per-job cost fields on the Job type. */
  const jobOperatingCost = (j: Job): number => {
    const tire = Number(j.tireCost || 0);
    const material = Number(j.materialCost || 0);
    const misc = Number(j.miscCost || 0);
    return tire + material + misc;
  };

  const completedJobs = useMemo(
    () => (jobs || []).filter((j) => j.status === 'Completed'),
    [jobs],
  );

  // This week's range — for the hero card on the History tab.
  const thisWeek = getWeekStart(TODAY(), weekStartDay);
  const thisWeekRange = formatWeekRange(thisWeek);

  const thisWeekCost = useMemo(() => {
    return completedJobs
      .filter((j) => getWeekStart(j.date, weekStartDay) === thisWeek)
      .reduce((t, j) => t + jobOperatingCost(j), 0);
  }, [completedJobs, thisWeek, weekStartDay]);

  // Weekly history breakdown (8 weeks).
  const weeklyHistory = useMemo(() => {
    const weeks: Record<string, { jobCosts: number; count: number }> = {};
    completedJobs.forEach((j) => {
      const w = getWeekStart(j.date, weekStartDay);
      if (!weeks[w]) weeks[w] = { jobCosts: 0, count: 0 };
      weeks[w].jobCosts += jobOperatingCost(j);
      weeks[w].count += 1;
    });
    return Object.entries(weeks)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 8)
      .map(([w, d]) => ({
        weekStart: w,
        jobCosts: d.jobCosts,
        fixed: fixedWeekly,
        total: d.jobCosts + fixedWeekly,
        count: d.count,
      }));
  }, [completedJobs, weekStartDay, fixedWeekly]);

  // Monthly history breakdown (6 months).
  const monthlyHistory = useMemo(() => {
    const months: Record<string, { jobCosts: number; count: number }> = {};
    completedJobs.forEach((j) => {
      const m = getMonth(j.date);
      if (!m) return;
      if (!months[m]) months[m] = { jobCosts: 0, count: 0 };
      months[m].jobCosts += jobOperatingCost(j);
      months[m].count += 1;
    });
    return Object.entries(months)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 6)
      .map(([m, d]) => ({
        month: m,
        jobCosts: d.jobCosts,
        fixed: fixedMonthly,
        total: d.jobCosts + fixedMonthly,
        count: d.count,
      }));
  }, [completedJobs, fixedMonthly]);

  return (
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Expenses</div>

      {/* ─── Tab switcher ───────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 6,
        background: 'var(--s2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: 4, marginBottom: 14,
      }}>
        <TabButton active={tab === 'recurring'} onClick={() => setTab('recurring')}>
          Recurring
        </TabButton>
        <TabButton active={tab === 'history'} onClick={() => setTab('history')}>
          History
        </TabButton>
      </div>

      {/* ═════════════════════════════════════════════════════════
          RECURRING TAB
          ═════════════════════════════════════════════════════════ */}
      {tab === 'recurring' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t2)' }}>Monthly fixed costs</div>
            <button className="btn xs primary" onClick={add}>＋ Add</button>
          </div>

          <div className="kpi-grid three">
            <div className="kpi"><div className="kpi-label">Active</div><div className="kpi-value">{list.filter((e) => e.active).length}</div></div>
            <div className="kpi"><div className="kpi-label">Monthly</div><div className="kpi-value">{money(activeTotal)}</div></div>
            <div className="kpi"><div className="kpi-label">Yearly</div><div className="kpi-value">{money(activeTotal * 12)}</div></div>
          </div>

          <div className="stack">
            {list.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">💸</div>
                <div className="empty-state-title">No recurring expenses</div>
                <div className="empty-state-sub">Add rent, insurance, subscriptions, etc.</div>
              </div>
            ) : (
              list.map((e) => (
                <div key={e.id} className="card card-anim">
                  <div className="card-pad">
                    <div className="field-row">
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Name</label>
                        <input value={e.name} onChange={(ev) => change(e.id, 'name', ev.target.value)} placeholder="Insurance" />
                      </div>
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label>Monthly $</label>
                        <input type="number" inputMode="decimal" value={e.amount} onChange={(ev) => change(e.id, 'amount', Number(ev.target.value))} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                        <input type="checkbox" checked={e.active} onChange={(ev) => change(e.id, 'active', ev.target.checked)} />
                        Active
                      </label>
                      <button className="btn xs danger" onClick={() => remove(e.id)}>Remove</button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {dirty && (
            <div style={{ position: 'sticky', bottom: 0, paddingTop: 12, background: 'linear-gradient(to top, var(--bg) 60%, transparent)' }}>
              <button className="btn primary" style={{ width: '100%' }} onClick={save}>Save Expenses</button>
            </div>
          )}
        </>
      )}

      {/* ═════════════════════════════════════════════════════════
          HISTORY TAB — actual spend by week and month
          ═════════════════════════════════════════════════════════ */}
      {tab === 'history' && (
        <>
          <div className="pro-hero card-anim">
            <div className="pro-hero-label">This Week's Spend</div>
            <div className="hero-amount">
              <span className="currency">$</span>{Math.round(thisWeekCost + fixedWeekly).toLocaleString()}
            </div>
            <div className="pro-hero-foot">
              <span>{thisWeekRange}</span>
              <span>{money(fixedWeekly)} fixed + {money(thisWeekCost)} job costs</span>
            </div>
          </div>

          {weeklyHistory.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon">📊</div>
              <div className="empty-state-title">No history yet</div>
              <div className="empty-state-sub">Log jobs with tire costs and per-job expenses to see weekly and monthly spend breakdowns.</div>
            </div>
          )}

          {weeklyHistory.length > 0 && (
            <>
              <div className="section-label">Weekly Spend</div>
              <div className="card card-anim">
                <div className="card-pad">
                  {weeklyHistory.map((w, i) => (
                    <div key={w.weekStart} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: i ? '1px solid var(--border2)' : 'none' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{formatWeekRange(w.weekStart)}</div>
                        <div style={{ fontSize: 11, color: 'var(--t3)' }}>
                          {w.count} job{w.count !== 1 ? 's' : ''} · {money(w.jobCosts)} job costs
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="value">{money(w.total)}</div>
                        <div style={{ fontSize: 11, color: 'var(--t3)' }}>incl. {money(w.fixed)} fixed</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {monthlyHistory.length > 0 && (
            <>
              <div className="section-label">Monthly Spend</div>
              <div className="card card-anim">
                <div className="card-pad">
                  {monthlyHistory.map((m, i) => (
                    <div key={m.month} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderTop: i ? '1px solid var(--border2)' : 'none' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{formatMonth(m.month)}</div>
                        <div style={{ fontSize: 11, color: 'var(--t3)' }}>
                          {m.count} job{m.count !== 1 ? 's' : ''} · {money(m.jobCosts)} job costs
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="value">{money(m.total)}</div>
                        <div style={{ fontSize: 11, color: 'var(--t3)' }}>incl. {money(m.fixed)} fixed</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '10px 12px',
        background: active ? 'var(--s1)' : 'transparent',
        border: active ? '1px solid var(--border2)' : '1px solid transparent',
        borderRadius: 8,
        color: active ? 'var(--t1)' : 'var(--t3)',
        fontSize: 13, fontWeight: 700,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
