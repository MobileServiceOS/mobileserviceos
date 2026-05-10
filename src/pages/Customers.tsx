import { useMemo, useState } from 'react';
import type { Job, Settings } from '@/types';
import { jobGrossProfit, money, serviceIcon } from '@/lib/utils';

interface CustomerEntry {
  key: string;
  name: string;
  phone: string;
  jobs: Job[];
  revenue: number;
  profit: number;
  lastDate: string;
  count: number;
}

interface Props {
  jobs: Job[];
  settings: Settings;
  onViewJob: (j: Job) => void;
}

export function Customers({ jobs, settings, onViewJob }: Props) {
  const [search, setSearch] = useState('');
  const [showRepeatOnly, setShowRepeatOnly] = useState(false);

  const customers = useMemo<CustomerEntry[]>(() => {
    const safe = Array.isArray(jobs) ? jobs : [];
    const map = new Map<string, CustomerEntry>();
    for (const j of safe) {
      const phoneDigits = (j.customerPhone || '').replace(/\D/g, '');
      const key = phoneDigits || (j.customerName || '').trim().toLowerCase();
      if (!key) continue;
      const existing = map.get(key);
      if (existing) {
        existing.jobs.push(j);
        existing.revenue += Number(j.revenue || 0);
        existing.profit += jobGrossProfit(j, settings);
        existing.count += 1;
        if ((j.date || '') > existing.lastDate) existing.lastDate = j.date || '';
        if (!existing.name && j.customerName) existing.name = j.customerName;
        if (!existing.phone && j.customerPhone) existing.phone = j.customerPhone;
      } else {
        map.set(key, {
          key,
          name: j.customerName || '(no name)',
          phone: j.customerPhone || '',
          jobs: [j],
          revenue: Number(j.revenue || 0),
          profit: jobGrossProfit(j, settings),
          lastDate: j.date || '',
          count: 1,
        });
      }
    }
    let list = Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
    if (showRepeatOnly) list = list.filter((c) => c.count > 1);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(s) || c.phone.includes(s));
    }
    return list;
  }, [jobs, settings, search, showRepeatOnly]);

  const totalRevenue = customers.reduce((t, c) => t + c.revenue, 0);
  const repeatCount = customers.filter((c) => c.count > 1).length;

  return (
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Customers</div>
      <div className="kpi-grid three card-anim">
        <div className="kpi">
          <div className="kpi-label">Total</div>
          <div className="kpi-value">{customers.length}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Repeat</div>
          <div className="kpi-value">{repeatCount}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">LTV</div>
          <div className="kpi-value">{money(totalRevenue)}</div>
        </div>
      </div>
      <div className="field" style={{ marginBottom: 10 }}>
        <input placeholder="Search by name or phone..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button className={'chip sm' + (!showRepeatOnly ? ' active' : '')} onClick={() => setShowRepeatOnly(false)}>
          All
        </button>
        <button className={'chip sm' + (showRepeatOnly ? ' active' : '')} onClick={() => setShowRepeatOnly(true)}>
          Repeat Only
        </button>
      </div>
      {customers.length === 0 && (
        <div className="empty">
          <div className="empty-icon">👥</div>
          <div className="empty-title">No customers yet</div>
          <div className="empty-sub">Customers from your jobs will appear here</div>
        </div>
      )}
      <div className="stack">
        {customers.slice(0, 100).map((c) => (
          <div key={c.key} className="card card-anim">
            <div className="card-pad">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>
                    {c.phone || 'No phone'} · {c.count} job{c.count !== 1 ? 's' : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div className="value green">{money(c.revenue)}</div>
                  <div style={{ fontSize: 11, color: c.profit >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                    {money(c.profit)} profit
                  </div>
                </div>
              </div>
              {c.phone && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                  <a
                    href={'tel:' + c.phone.replace(/\D/g, '')}
                    className="btn xs secondary"
                    style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    📞 Call
                  </a>
                  <a
                    href={'sms:' + c.phone.replace(/\D/g, '')}
                    className="btn xs secondary"
                    style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    💬 Text
                  </a>
                </div>
              )}
              <div style={{ borderTop: '1px solid var(--border2)', paddingTop: 8 }}>
                {c.jobs
                  .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                  .slice(0, 3)
                  .map((j) => (
                    <div
                      key={j.id}
                      onClick={() => onViewJob(j)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', cursor: 'pointer' }}
                    >
                      <span style={{ fontSize: 16 }}>{serviceIcon(j.service)}</span>
                      <span style={{ flex: 1, fontSize: 12, color: 'var(--t2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {j.service} · {j.date}
                      </span>
                      <span className="num" style={{ fontSize: 12, fontWeight: 700, color: 'var(--t1)' }}>
                        {money(j.revenue)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
