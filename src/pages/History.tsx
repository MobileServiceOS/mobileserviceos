import { useMemo, useState } from 'react';
import type { Job, Settings } from '@/types';
import { fmtDate, jobGrossProfit, money, paymentPillClass, resolvePaymentStatus, serviceIcon } from '@/lib/utils';

interface Props {
  jobs: Job[];
  settings: Settings;
  onViewJob: (j: Job) => void;
}

type Filter = 'all' | 'completed' | 'pending' | 'cancelled' | 'unpaid';

export function History({ jobs, settings, onViewJob }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const filtered = useMemo(() => {
    let list = Array.isArray(jobs) ? [...jobs] : [];
    if (filter === 'completed') list = list.filter((j) => j.status === 'Completed');
    if (filter === 'pending') list = list.filter((j) => j.status === 'Pending');
    if (filter === 'cancelled') list = list.filter((j) => j.status === 'Cancelled');
    if (filter === 'unpaid') list = list.filter((j) => resolvePaymentStatus(j) === 'Pending Payment');
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((j) => {
        const blob = [j.customerName, j.service, j.area, j.tireSize, j.customerPhone, j.fullLocationLabel]
          .filter(Boolean).join(' ').toLowerCase();
        return blob.includes(q);
      });
    }
    list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.id || '').localeCompare(a.id || ''));
    return list;
  }, [jobs, query, filter]);

  return (
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>Job History</div>
      <div className="field" style={{ marginBottom: 10 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, service, location…"
        />
      </div>
      <div className="chip-grid" style={{ marginBottom: 14 }}>
        {(['all', 'completed', 'pending', 'cancelled', 'unpaid'] as Filter[]).map((f) => (
          <button key={f} type="button" className={'chip sm' + (filter === f ? ' active' : '')} onClick={() => setFilter(f)}>
            {f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🗂</div>
          <div className="empty-state-title">No jobs found</div>
          <div className="empty-state-sub">Try a different search or filter.</div>
        </div>
      ) : (
        <div className="stack">
          {filtered.map((j) => {
            const pr = jobGrossProfit(j, settings);
            const ps = resolvePaymentStatus(j);
            return (
              <div key={j.id} className="job-card card-anim" onClick={() => onViewJob(j)}>
                <div className="job-card-main">
                  <div className="job-icon">{serviceIcon(j.service)}</div>
                  <div className="job-main">
                    <div className="job-title">{j.customerName || j.service}</div>
                    <div className="job-meta">
                      {j.service} · {j.fullLocationLabel || j.area || '—'} · {fmtDate(j.date)}
                      {j.tireSize ? ' · ' + j.tireSize : ''}
                    </div>
                  </div>
                  <div className="job-right">
                    <div className="value green">{money(j.revenue)}</div>
                    <div style={{ fontSize: 11, color: pr >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{money(pr)}</div>
                    <span className={'pill ' + paymentPillClass(ps)} style={{ marginTop: 4 }}>{ps}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
