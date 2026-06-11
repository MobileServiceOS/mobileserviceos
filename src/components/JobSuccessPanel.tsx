import type { Job, Settings, Brand } from '@/types';
import { jobGrossProfit, money, paymentPillClass, resolvePaymentStatus } from '@/lib/utils';
import { addToast } from '@/lib/toast';
import { usePermissions } from '@/context/MembershipContext';
import { useBrand } from '@/context/BrandContext';
import { TakePaymentButton } from '@/components/zettle/TakePaymentButton';
import { IconDollar, IconInvoice, IconStar, IconEdit, IconEye, IconCopy, IconPlus, IconHome } from '@/components/ActionIcons';

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
  onMarkPaid: () => void;
  /** Start a fresh blank job — the continuous-flow path: log a
   *  job, see the success panel, one tap straight into the next. */
  onNewJob: () => void;
}

function buildHeader(job: Job, ps: ReturnType<typeof resolvePaymentStatus>) {
  if (job.status === 'Cancelled')
    return { icon: '✕', title: 'Job Cancelled', color: 'var(--red)', bgClass: 'success-panel cancelled' };
  if (job.status === 'Pending')
    return { icon: '⏳', title: 'Job Pending', color: 'var(--amber)', bgClass: 'success-panel pending' };
  if (ps === 'Pending Payment')
    return { icon: '✓', title: 'Job Completed — Payment Pending', color: 'var(--amber)', bgClass: 'success-panel pending-payment' };
  if (ps === 'Partial Payment')
    return { icon: '✓', title: 'Job Completed — Partial Payment', color: 'var(--amber)', bgClass: 'success-panel pending-payment' };
  return { icon: '✓', title: 'Job Completed', color: 'var(--green)', bgClass: 'success-panel' };
}

export function JobSuccessPanel({
  job, settings, brand,
  onGenerateInvoice, onSendReview, onEditJob, onViewJob, onDuplicate, onClose, onMarkPaid, onNewJob,
}: Props) {
  const profit = jobGrossProfit(job, settings);
  const ps = resolvePaymentStatus(job);
  const header = buildHeader(job, ps);
  // Technicians see revenue + payment but not the profit tile.
  const permissions = usePermissions();
  const canViewProfit = permissions.canViewProfit;
  const { businessId } = useBrand();
  const isCompleted = job.status === 'Completed';
  const unpaid = ps !== 'Paid' && ps !== 'Cancelled' && job.status !== 'Cancelled';
  const location =
    job.fullLocationLabel ||
    (job.city && job.state ? `${job.city}, ${job.state}` : job.city || job.area || '—');

  return (
    <div className="page page-enter" style={{ paddingTop: 24 }}>
      <div className={header.bgClass + ' card-anim'}>
        <div className="success-check" style={{ color: header.color }}>{header.icon}</div>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4, color: header.color, letterSpacing: '-.3px' }}>
          {header.title}
        </div>
        <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 20, lineHeight: 1.5 }}>
          {job.customerName || 'Customer'} · {job.service}<br />{location}
        </div>
        <div className="kpi-grid" style={{ marginBottom: 0 }}>
          <div className="kpi">
            <div className="kpi-label">Revenue</div>
            <div className="kpi-value" style={{ color: 'var(--green)' }}>{money(job.revenue)}</div>
          </div>
          {canViewProfit && (
            <div className="kpi">
              <div className="kpi-label">Profit</div>
              <div className="kpi-value" style={{ color: profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{money(profit)}</div>
            </div>
          )}
          <div className="kpi">
            <div className="kpi-label">Payment</div>
            <div className="kpi-value" style={{ fontSize: 14 }}>{job.payment || '—'}</div>
          </div>
          <div className="kpi">
            <div className="kpi-label">Job Status</div>
            <div>
              <span className={'pill ' + (job.status === 'Completed' ? 'green' : job.status === 'Pending' ? 'amber' : 'red')}>
                {job.status}
              </span>
            </div>
          </div>
          <div className="kpi" style={{ gridColumn: 'span 2' }}>
            <div className="kpi-label">Payment Status</div>
            <div><span className={'pill ' + paymentPillClass(ps)}>{ps}</span></div>
          </div>
        </div>
      </div>
      <div className="action-grid card-anim">
        {/* Mark Paid — first action when payment is outstanding.
            Spans both columns. One tap = paid. */}
        {ps !== 'Paid' && ps !== 'Cancelled' && job.status !== 'Cancelled' && (
          <button
            className="action-btn wide"
            onClick={onMarkPaid}
            style={{
              background: 'linear-gradient(135deg, var(--green) 0%, #16a34a 100%)',
              color: '#fff',
              border: 'none',
              boxShadow: '0 6px 20px rgba(34,197,94,.25)',
            }}
          >
            <span className="action-ico"><IconDollar /></span>
            <span style={{ fontWeight: 800 }}>Mark Paid · {money(job.revenue)}</span>
          </button>
        )}
        {isCompleted ? (
          <>
            <button className="action-btn" onClick={onGenerateInvoice}>
              <span className="action-ico"><IconInvoice /></span><span>Generate Invoice</span>
            </button>
            <button className="action-btn" onClick={() => {
              if (!brand.reviewUrl) { addToast('Set review URL in Settings', 'warn'); return; }
              onSendReview();
            }}>
              <span className="action-ico"><IconStar /></span><span>Send Review</span>
            </button>
          </>
        ) : null}
        <button className="action-btn" onClick={onEditJob}>
          <span className="action-ico"><IconEdit /></span><span>Edit Job</span>
        </button>
        <button className="action-btn" onClick={onViewJob}>
          <span className="action-ico"><IconEye /></span><span>View Details</span>
        </button>
        {isCompleted ? (
          <button className="action-btn" onClick={onDuplicate}>
            <span className="action-ico"><IconCopy /></span><span>Duplicate Job</span>
          </button>
        ) : null}
        {/* Continuous flow — straight into the next job, no
            Dashboard detour. */}
        <button
          className="action-btn wide"
          onClick={onNewJob}
          style={{
            background: 'var(--brand-primary)', color: '#0a0a0a',
            border: 'none', fontWeight: 800,
          }}
        >
          <span className="action-ico"><IconPlus /></span><span>Log Another Job</span>
        </button>
        <button className="action-btn wide" onClick={onClose}>
          <span className="action-ico"><IconHome /></span><span>Back to Dashboard</span>
        </button>
      </div>
      {/* Take Payment with Zettle — only when still unpaid and Zettle is
          connected. Charge in the Zettle app, then Sync auto-marks Paid. */}
      {unpaid && settings.zettleConnected && businessId && (
        <div className="card-anim" style={{ marginTop: 12 }}>
          <TakePaymentButton
            businessId={businessId}
            connected={settings.zettleConnected}
            amount={job.revenue}
            canSync={permissions.canViewPaymentIntegrations}
          />
        </div>
      )}
    </div>
  );
}
