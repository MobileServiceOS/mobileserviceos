import { useMemo, useState } from 'react';
import { useBrand } from '@/context/BrandContext';
import type { Job, Settings } from '@/types';
import { fmtDate, getWeekStart, jobGrossProfit, money, paymentPillClass, resolvePaymentStatus, serviceIcon } from '@/lib/utils';
import { TODAY } from '@/lib/defaults';
import { addToast } from '@/lib/toast';

interface Props {
  jobs: Job[];
  settings: Settings;
  onEdit: (j: Job) => void;
  onViewJob: (j: Job) => void;
  onGenerateInvoice: (j: Job) => void;
  onSendReview: (j: Job) => void;
  onMarkPaid: (j: Job) => void;
}

export function History({ jobs, settings, onEdit, onViewJob, onGenerateInvoice, onSendReview, onMarkPaid }: Props) {
  const { brand } = useBrand();
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const today = TODAY();
  const thisWeek = getWeekStart(today);

  const filtered = useMemo(() => {
    let list = [...safeJobs].sort(
      (a, b) => (b.date || '').localeCompare(a.date || '') || (b.id || '').localeCompare(a.id || '')
    );
    switch (filter) {
      case 'Completed':
        list = list.filter((j) => j.status === 'Completed');
        break;
      case 'Pending Payment':
        list = list.filter((j) => resolvePaymentStatus(j) === 'Pending Payment');
        break;
      case 'Cancelled':
        list = list.filter((j) => j.status === 'Cancelled');
        break;
      case 'today':
        list = list.filter((j) => j.date === today);
        break;
      case 'week':
        list = list.filter((j) => getWeekStart(j.date) === thisWeek);
        break;
    }
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(
        (j) =>
          (j.customerName || '').toLowerCase().includes(s) ||
          (j.service || '').toLowerCase().includes(s) ||
          (j.area || '').toLowerCase().includes(s) ||
          (j.tireSize || '').toLowerCase().includes(s)
      );
    }
    return list;
  }, [safeJobs, filter, search, today, thisWeek]);

  const handleExport = () => {
    const slug = (brand.businessName || 'export').replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const header = 'Date,Service,Customer,Phone,Area,Revenue,TireCost,Miles,Payment,PaymentStatus,Source,Status\n';
    const rows = filtered
      .map((j) =>
        [
          j.date,
          j.service,
          j.customerName,
          j.customerPhone,
          j.area,
          j.revenue,
          j.tireCost,
          j.miles,
          j.payment,
          resolvePaymentStatus(j),
          j.source,
          j.status,
        ]
          .map((v) => '"' + (v || '') + '"')
          .join(',')
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = slug + '-jobs-export.csv';
    a.click();
    addToast('Exported ' + filtered.length + ' jobs', 'success');
  };

  const filters = [
    { id: 'all', label: 'All' },
    { id: 'Completed', label: 'Completed' },
    { id: 'Pending Payment', label: 'Unpaid' },
    { id: 'Cancelled', label: 'Cancelled' },
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'This Week' },
  ];

  return (
    <div className="page page-enter">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Job History</div>
        <button className="btn xs secondary" onClick={handleExport}>
          Export CSV
        </button>
      </div>
      <div className="field" style={{ marginBottom: 10 }}>
        <input placeholder="Search jobs..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 10, WebkitOverflowScrolling: 'touch' }}>
        {filters.map((f) => (
          <button
            key={f.id}
            className={'chip sm' + (filter === f.id ? ' active' : '')}
            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 12 }}>
        {filtered.length} job{filtered.length !== 1 ? 's' : ''}
      </div>
      {filtered.length === 0 && (
        <div className="empty">
          <div className="empty-icon">📋</div>
          <div className="empty-title">No jobs found</div>
          <div className="empty-sub">Jobs you log will appear here</div>
        </div>
      )}
      <div className="stack">
        {filtered.slice(0, 50).map((j) => {
          const pr = jobGrossProfit(j, settings);
          const ps = resolvePaymentStatus(j);
          return (
            <div key={j.id} className="job-card card-anim">
              <div className="job-card-main" onClick={() => onViewJob(j)}>
                <div className="job-icon">{serviceIcon(j.service)}</div>
                <div className="job-main">
                  <div className="job-title">{j.customerName || j.service}</div>
                  <div className="job-meta">
                    {j.service} · {j.area || '—'} · {fmtDate(j.date)}
                    {j.tireSize ? ' · ' + j.tireSize : ''}
                    {j.source ? ' · ' + j.source : ''}
                  </div>
                </div>
                <div className="job-right">
                  <div className="value green" style={{ fontSize: 15 }}>
                    {money(j.revenue)}
                  </div>
                  <div style={{ fontSize: 11, color: pr >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600, marginTop: 2 }}>
                    {money(pr)}
                  </div>
                  <span className={'pill ' + paymentPillClass(ps)} style={{ marginTop: 4 }}>
                    {ps}
                  </span>
                </div>
              </div>
              <div className="job-card-actions">
                <button onClick={() => onGenerateInvoice(j)}>📄 Invoice</button>
                <button onClick={() => onSendReview(j)}>⭐ Review</button>
                <button onClick={() => onEdit(j)}>✏️ Edit</button>
                {ps === 'Pending Payment' && (
                  <button onClick={() => onMarkPaid(j)} style={{ color: 'var(--green)' }}>
                    💰 Paid
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
