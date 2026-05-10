import type { Job, Settings, InventoryDeduction } from '@/types';
import { jobGrossProfit, money, paymentPillClass, r2, resolvePaymentStatus } from '@/lib/utils';

interface Props {
  job: Job;
  settings: Settings;
  onClose: () => void;
  onEdit: (j: Job) => void;
  onDelete: (id: string) => void;
  onGenerateInvoice: (j: Job) => void;
  onSendInvoice: (j: Job) => void;
  onSendReview: (j: Job) => void;
  onMarkPaid: (j: Job) => void;
  onDuplicate: (j: Job) => void;
}

export function JobDetailModal({
  job,
  settings,
  onClose,
  onEdit,
  onDelete,
  onGenerateInvoice,
  onSendInvoice,
  onSendReview,
  onMarkPaid,
  onDuplicate,
}: Props) {
  const profit = jobGrossProfit(job, settings);
  const ps = resolvePaymentStatus(job);
  let invDeds: InventoryDeduction[] | null = null;
  if (job.inventoryDeductions) {
    if (typeof job.inventoryDeductions === 'string') {
      try {
        invDeds = JSON.parse(job.inventoryDeductions);
      } catch {
        invDeds = null;
      }
    } else if (Array.isArray(job.inventoryDeductions)) {
      invDeds = job.inventoryDeductions;
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-sheet">
        <div className="modal-header">
          <h2>Job Details</h2>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 10 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 17, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {job.customerName || 'Customer'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 3 }}>{job.customerPhone || 'No phone'}</div>
              </div>
              <span className={'pill ' + paymentPillClass(ps)} style={{ fontSize: 11, flexShrink: 0 }}>
                {ps}
              </span>
            </div>
            {job.customerPhone && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <a
                  href={'tel:' + job.customerPhone.replace(/\D/g, '')}
                  className="btn sm secondary"
                  style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  📞 Call
                </a>
                <a
                  href={'sms:' + job.customerPhone.replace(/\D/g, '')}
                  className="btn sm secondary"
                  style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  💬 Text
                </a>
              </div>
            )}
            <Row label="Service" value={job.service} />
            <Row label="Date" value={job.date} />
            <Row label="Vehicle" value={job.vehicleType || '—'} />
            {job.tireSize && <Row label="Tire Size" value={`${job.tireSize} × ${job.qty || 1}`} />}
            <Row label="Location" value={job.area || '—'} />
            <Row label="Source" value={job.source || '—'} />
            <Row label="Payment" value={job.payment || '—'} />
          </div>

          <div className="form-group" style={{ marginBottom: 12 }}>
            <div className="form-group-title">Financial Breakdown</div>
            <Row label="Revenue" value={money(job.revenue)} className="green" />
            <Row label="Tire Cost" value={'-' + money(job.tireCost)} className="red" />
            <Row label="Material Cost" value={'-' + money(job.materialCost || job.miscCost)} className="red" />
            <Row
              label={`Travel (${job.miles || 0} mi)`}
              value={'-' + money(r2(Number(job.miles || 0) * Number(settings.costPerMile || 0.65)))}
              className="red"
            />
            <Row label="Gross Profit" value={money(profit)} className={profit >= 0 ? 'green' : 'red'} bold />
          </div>

          {invDeds && invDeds.length > 0 && (
            <div className="form-group" style={{ marginBottom: 12 }}>
              <div className="form-group-title">Inventory Used</div>
              {invDeds.map((d, i) => (
                <Row key={i} label={d.size} value={`× ${d.qty}`} />
              ))}
            </div>
          )}

          <div className="form-group" style={{ marginBottom: 12 }}>
            <div className="form-group-title">Status Tracking</div>
            <div className="card-row" style={{ padding: '10px 0' }}>
              <span className="label">Invoice</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: job.invoiceGenerated ? 'var(--green)' : 'var(--t3)' }}>
                {job.invoiceGenerated ? 'Generated' : 'Not generated'}
              </span>
            </div>
            {job.invoiceNumber && <Row label="Invoice #" value={job.invoiceNumber} />}
            <div className="card-row" style={{ padding: '10px 0' }}>
              <span className="label">Review Request</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: job.reviewRequested ? 'var(--green)' : 'var(--t3)' }}>
                {job.reviewRequested ? 'Sent' : 'Not sent'}
              </span>
            </div>
          </div>

          {job.note && (
            <div className="form-group" style={{ marginBottom: 12 }}>
              <div className="form-group-title">Notes</div>
              <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.5 }}>{job.note}</div>
            </div>
          )}

          <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
            <button
              className="btn primary"
              style={{ width: '100%' }}
              onClick={() => {
                onEdit(job);
                onClose();
              }}
            >
              ✏️ Edit Job
            </button>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button className="btn secondary" onClick={() => onGenerateInvoice(job)}>
                📄 {job.invoiceGenerated ? 'Regenerate' : 'Generate'}
              </button>
              <button className="btn secondary" onClick={() => onSendInvoice(job)}>
                📤 Send Invoice
              </button>
            </div>
            <button
              className="btn secondary"
              style={{ width: '100%' }}
              onClick={() => {
                onSendReview(job);
                onClose();
              }}
            >
              ⭐ Send Review Request
            </button>
            {ps !== 'Paid' && (
              <button
                className="btn success"
                style={{ width: '100%' }}
                onClick={() => {
                  onMarkPaid(job);
                  onClose();
                }}
              >
                💰 Mark as Paid
              </button>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button
                className="btn secondary"
                onClick={() => {
                  onDuplicate(job);
                  onClose();
                }}
              >
                📋 Duplicate
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  if (confirm('Delete this job permanently?')) {
                    onDelete(job.id);
                    onClose();
                  }
                }}
              >
                🗑 Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, className = '', bold = false }: { label: string; value: string; className?: string; bold?: boolean }) {
  return (
    <div className="card-row" style={{ padding: '10px 0', borderTop: bold ? '1px solid var(--border)' : undefined }}>
      <span className="label" style={bold ? { fontWeight: 700 } : undefined}>
        {label}
      </span>
      <span className={'value ' + className} style={{ fontSize: 13 }}>
        {value}
      </span>
    </div>
  );
}
