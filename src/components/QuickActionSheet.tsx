import type { Job } from '@/types';
import { resolvePaymentStatus } from '@/lib/utils';

interface Props {
  job: Job;
  onClose: () => void;
  onView: () => void;
  onEdit: () => void;
  onSendInvoice: () => void;
  onSendReview: () => void;
  onMarkPaid: () => void;
}

interface ActionDef {
  key: string;
  icon: string;
  label: string;
  handler: () => void;
  /** When true, render with green/primary styling. Used for Mark Paid. */
  emphasize?: boolean;
}

/**
 * Bottom-sheet quick-action menu for jobs.
 *
 * Triggered by long-pressing a job card in Dashboard's Recent Completed
 * Jobs or in the Jobs History list. Renders 4-5 action tiles depending
 * on the job's state (Mark Paid only appears when payment is pending).
 *
 * Design parallels the PaymentMethodSheet bottom-sheet used previously:
 * tap outside to dismiss, gold handle for affordance, 56px+ row height
 * for one-thumb roadside use.
 */
export function QuickActionSheet({
  job, onClose, onView, onEdit, onSendInvoice, onSendReview, onMarkPaid,
}: Props) {
  const ps = resolvePaymentStatus(job);
  const canMarkPaid = ps !== 'Paid' && ps !== 'Cancelled';

  const actions: ActionDef[] = [
    ...(canMarkPaid
      ? [{ key: 'paid', icon: '💰', label: 'Mark Paid', handler: onMarkPaid, emphasize: true }]
      : []),
    { key: 'view',    icon: '👁',  label: 'View Job',     handler: onView },
    { key: 'edit',    icon: '✏️', label: 'Edit Job',     handler: onEdit },
    { key: 'invoice', icon: '📤', label: 'Send Invoice', handler: onSendInvoice },
    { key: 'review',  icon: '⭐', label: 'Send Review',  handler: onSendReview },
  ];

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Quick actions"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--s1)',
          border: '1px solid var(--border)',
          borderRadius: '20px 20px 0 0',
          width: '100%',
          maxWidth: 480,
          marginTop: 'auto',
          padding: '14px 12px max(20px, var(--safe-bot))',
          boxShadow: '0 -12px 36px rgba(0,0,0,.5)',
        }}
      >
        {/* Sheet handle for visual affordance */}
        <div style={{
          width: 44, height: 4, borderRadius: 99,
          background: 'var(--border2)', margin: '0 auto 12px',
        }} />

        {/* Job context — shows which job the actions apply to, so a
            stray long-press doesn't open an unattributed menu. */}
        <div style={{
          fontSize: 11, fontWeight: 800, color: 'var(--t3)',
          textTransform: 'uppercase', letterSpacing: '1.5px',
          marginBottom: 4, padding: '0 4px',
        }}>
          Quick actions
        </div>
        <div style={{
          fontSize: 14, fontWeight: 700, color: 'var(--t1)',
          marginBottom: 12, padding: '0 4px',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {job.customerName || job.service}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {actions.map(({ key, icon, label, handler, emphasize }) => (
            <button
              key={key}
              onClick={() => { handler(); onClose(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px',
                background: emphasize
                  ? 'linear-gradient(135deg, var(--green) 0%, #16a34a 100%)'
                  : 'var(--s2)',
                border: emphasize ? 'none' : '1px solid var(--border)',
                borderRadius: 12,
                color: emphasize ? '#fff' : 'var(--t1)',
                textAlign: 'left',
                width: '100%',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: emphasize ? 800 : 600,
                minHeight: 52,
              }}
            >
              <span style={{ fontSize: 18, width: 24, textAlign: 'center', flexShrink: 0 }}>
                {icon}
              </span>
              <span>{label}</span>
            </button>
          ))}
        </div>

        <button
          onClick={onClose}
          style={{
            width: '100%', marginTop: 10, padding: '11px',
            background: 'transparent', border: 'none', color: 'var(--t3)',
            fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
