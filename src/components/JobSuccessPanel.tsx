import type { Job, Settings, Brand } from '@/types';
import { jobGrossProfit, money, paymentPillClass, resolvePaymentStatus } from '@/lib/utils';
import { addToast } from '@/lib/toast';

interface Props {
  job: Job;
  settings: Settings;
  brand: Brand;
  onGenerateInvoice: () => void;
  onSendReview: () => void;
  onEditJob: () => void;
  onViewJob: () => void;
  onDuplicate: () => void;
  onClose: () => void;
}

export function JobSuccessPanel({
  job,
  settings,
  brand,
  onGenerateInvoice,
  onSendReview,
  onEditJob,
  onViewJob,
  onDuplicate,
  onClose,
}: Props) {
  const profit = jobGrossProfit(job, settings);
  const ps = resolvePaymentStatus(job);

  return (
    <div className="page page-enter" style={{ paddingTop: 24 }}>
      <div className="success-panel card-anim">
        <div className="success-check">✓</div>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4, color: 'var(--green)' }}>Job Completed</div>
        <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 20 }}>
          {job.customerName || 'Customer'} · {job.service} · {job.area || '—'}
        </div>
        <div className="kpi-grid" style={{ marginBottom: 0 }}>
          <div className="kpi">
            <div className="kpi-label">Revenue</div>
            <div className="kpi-value" style={{ color: 'var(--green)' }}>
              {money(job.revenue)}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Profit</div>
            <div className="kpi-value" style={{ color: profit >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {money(profit)}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Payment</div>
            <div className="kpi-value" style={{ fontSize: 14 }}>
              {job.payment || '—'}
            </div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Status</div>
            <div>
              <span className={'pill ' + paymentPillClass(ps)}>{ps}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="action-grid card-anim">
        <button className="action-btn" onClick={onGenerateInvoice}>
          <span className="action-ico">📄</span>
          <span>Generate Invoice</span>
        </button>
        <button
          className="action-btn"
          onClick={() => {
            if (!brand.reviewUrl) {
              addToast('Set review URL in Settings', 'warn');
              return;
            }
            onSendReview();
          }}
        >
          <span className="action-ico">⭐</span>
          <span>Send Review</span>
        </button>
        <button className="action-btn" onClick={onEditJob}>
          <span className="action-ico">✏️</span>
          <span>Edit Job</span>
        </button>
        <button className="action-btn" onClick={onViewJob}>
          <span className="action-ico">👁</span>
          <span>View Details</span>
        </button>
        <button className="action-btn" onClick={onDuplicate}>
          <span className="action-ico">📋</span>
          <span>Duplicate Job</span>
        </button>
        <button className="action-btn wide" onClick={onClose}>
          <span className="action-ico">🏠</span>
          <span>Back to Dashboard</span>
        </button>
      </div>
    </div>
  );
}
