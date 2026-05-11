import { useMemo, useState } from 'react';
import type { Job, Settings } from '@/types';
import { fmtDate, jobGrossProfit, money } from '@/lib/utils';

interface Props {
  jobs: Job[];
  settings: Settings;
}

interface CustomerSummary {
  key: string;
  name: string;
  phone: string;
  jobs: Job[];
  revenue: number;
  profit: number;
  lastDate: string;
}

export function Customers({ jobs, settings }: Props) {
  const [query, setQuery] = useState('');

  const customers = useMemo(() => {
    const map = new Map<string, CustomerSummary>();
    (jobs || []).forEach((j) => {
      const key = (j.customerPhone || '').trim() || (j.customerName || '').trim().toLowerCase();
      if (!key) return;
      const prev = map.get(key) || {
        key, name: j.customerName || 'Unknown', phone: j.customerPhone || '',
        jobs: [], revenue: 0, profit: 0, lastDate: '',
      };
      prev.jobs.push(j);
      prev.revenue += Number(j.revenue || 0);
      prev.profit += jobGrossProfit(j, settings);
      if ((j.date || '') > prev.lastDate) prev.lastDate = j.date || '';
      if (!prev.name && j.customerName) prev.name = j.customerName;
      if (!prev.phone && j.customerPhone) prev.phone = j.customerPhone;
      map.set(key, prev);
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [jobs, settings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      c.name.toLowerCase().includes(q) || c.phone.includes(q)
    );
  }, [customers, query]);

  const topThree = customers.slice(0, 3);

  return (
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Customers</div>

      <div className="kpi-grid three">
        <div className="kpi"><div className="kpi-label">Total</div><div className="kpi-value">{customers.length}</div></div>
        <div className="kpi"><div className="kpi-label">Revenue</div><div className="kpi-value">{money(customers.reduce((s, c) => s + c.revenue, 0))}</div></div>
        <div className="kpi"><div className="kpi-label">Profit</div><div className="kpi-value">{money(customers.reduce((s, c) => s + c.profit, 0))}</div></div>
      </div>

      {topThree.length > 0 && (
        <>
          <div className="section-label">Top Customers</div>
          <div className="card card-anim">
            <div className="card-pad">
              {topThree.map((c, i) => (
                <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: i ? '1px solid var(--border2)' : 'none' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>{c.jobs.length} job{c.jobs.length !== 1 ? 's' : ''}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="value green num">{money(c.revenue)}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>profit {money(c.profit)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="field" style={{ marginTop: 14, marginBottom: 10 }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or phone…" />
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">👥</div>
          <div className="empty-state-title">No customers yet</div>
          <div className="empty-state-sub">Customers appear automatically as you log jobs.</div>
        </div>
      ) : (
        <div className="stack">
          {filtered.map((c) => (
            <div key={c.key} className="card card-anim">
              <div className="card-pad">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>{c.phone || 'No phone'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {c.phone && (
                      <>
                        <a className="btn xs secondary" href={`tel:${c.phone.replace(/\D/g, '')}`}>📞</a>
                        <a className="btn xs secondary" href={`sms:${c.phone.replace(/\D/g, '')}`}>💬</a>
                      </>
                    )}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 12 }}>
                  <div><div style={{ color: 'var(--t3)' }}>Jobs</div><div style={{ fontWeight: 700 }}>{c.jobs.length}</div></div>
                  <div><div style={{ color: 'var(--t3)' }}>Revenue</div><div style={{ fontWeight: 700, color: 'var(--green)' }}>{money(c.revenue)}</div></div>
                  <div><div style={{ color: 'var(--t3)' }}>Last</div><div style={{ fontWeight: 700 }}>{c.lastDate ? fmtDate(c.lastDate) : '—'}</div></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
