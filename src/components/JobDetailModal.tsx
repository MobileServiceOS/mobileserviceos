import type { Job, Settings, InventoryDeduction } from '@/types';
import { fmtDate, jobGrossProfit, money, paymentPillClass, resolvePaymentStatus, serviceIcon } from '@/lib/utils';

interface Props {
  job: Job;
  settings: Settings;
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onGenerateInvoice: () => void;
  onSendInvoice: () => void;
  onSendReview: () => void;
}

export function JobDetailModal({
  job, settings, onClose, onEdit, onDuplicate, onDelete,
  onGenerateInvoice, onSendInvoice, onSendReview,
}: Props) {
  const profit = jobGrossProfit(job, settings);
  const ps = resolvePaymentStatus(job);
  const invDeds: InventoryDeduction[] | null = Array.isArray(job.inventoryDeductions)
    ? job.inventoryDeductions
    : null;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-sheet" role="dialog" aria-labelledby="job-modal-title">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>{serviceIcon(job.service)}</span>
            <div>
              <div id="job-modal-title" style={{ fontWeight: 700, fontSize: 16 }}>
                {job.customerName || job.service}
              </div>
              <div style={{ fontSize: 11, color: 'var(--t3)' }}>
                {job.service} · {fmtDate(job.date)}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="modal-close" aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group" style={{ marginBottom: 12 }}>
            <Row label="Revenue" value={money(job.revenue)} className="green" bold />
            <Row label="Tire Cost" value={'-' + money(job.tireCost)} className="red" />
            <Row label="Material Cost" value={'-' + money(job.materialCost || job.miscCost)} className="red" />
            <Row label={`Travel (${job.miles || 0} mi)`} value={'-' + money(Number(job.miles || 0) * Number(settings.costPerMile || 0))} className="red" />
            <Row label="Profit" value={money(profit)} className={profit >= 0 ? 'green' : 'red'} bold />
          </div>

          <div className="form-group" style={{ marginBottom: 12 }}>
            <div className="form-group-title">Customer</div>
            <Row label="Name" value={job.customerName || '—'} />
            <Row label="Phone" value={job.customerPhone || '—'} />
            <Row label="Location" value={job.fullLocationLabel || (job.city && job.state ? `${job.city}, ${job.state}` : job.area || '—')} />
            <Row label="Source" value={job.source || '—'} />
          </div>

          <div className="form-group" style={{ marginBottom: 12 }}>
            <div className="form-group-title">Tire Details</div>
            <Row label="Size" value={job.tireSize || '—'} />
            <Row label="Qty" value={String(job.qty || 0)} />
            <Row label="Source" value={job.tireSource} />
            {job.tireVendor ? <Row label="Vendor" value={job.tireVendor} /> : null}
            {job.tireCondition ? <Row label="Condition" value={job.tireCondition} /> : null}
            {job.tireReceiptUrl ? (
              <div style={{ padding: '6px 0' }}>
                <a href={job.tireReceiptUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand-primary)', fontSize: 12 }}>
                  View receipt →
                </a>
              </div>
            ) : null}
          </div>

          {invDeds && invDeds.length > 0 ? (
            <div className="form-group" style={{ marginBottom: 12 }}>
              <div className="form-group-title">Inventory Used</div>
              {invDeds.map((d, i) => (
                <div key={i}>
                  <Row label={d.size} value={`× ${d.qty}`} />
                </div>
              ))}
            </div>
          ) : null}

          <div className="form-group" style={{ marginBottom: 12 }}>
            <div className="form-group-title">Status</div>
            <div className="card-row" style={{ padding: '10px 0' }}>
              <span className="label">Job</span>
              <span className={'pill ' + (job.status === 'Completed' ? 'green' : job.status === 'Pending' ? 'amber' : 'red')}>
                {job.status}
              </span>
            </div>
            <div className="card-row" style={{ padding: '10px 0' }}>
              <span className="label">Payment</span>
              <span className={'pill ' + paymentPillClass(ps)}>{ps}</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 16 }}>
            <button className="btn secondary" onClick={onGenerateInvoice}>📄 Invoice</button>
            <button className="btn secondary" onClick={onSendInvoice}>📤 Send Invoice</button>
            <button className="btn secondary" onClick={onSendReview}>⭐ Review</button>
            <button className="btn secondary" onClick={onDuplicate}>📋 Duplicate</button>
            <button className="btn secondary" onClick={onEdit}>✏️ Edit</button>
            <button className="btn danger" onClick={onDelete}>🗑 Delete</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, className = '', bold = false }: { label: string; value: string; className?: string; bold?: boolean }) {
  return (
    <div className="card-row" style={{ padding: '8px 0' }}>
      <span className="label">{label}</span>
      <span className={'value ' + className} style={{ fontWeight: bold ? 700 : 500 }}>{value}</span>
    </div>
  );
}
