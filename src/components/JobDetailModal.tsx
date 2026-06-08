import { useState, type CSSProperties, type ReactNode } from 'react';
import type { Job, Settings, InventoryDeduction, PaymentMethod } from '@/types';
import { useFocusTrap } from '@/lib/useFocusTrap';
import { PAYMENT_METHOD_LABELS } from '@/types';
import { fmtDate, jobGrossProfit, money, paymentPillClass, resolvePaymentStatus } from '@/lib/utils';
import { getLastPaymentMethod } from '@/lib/paymentMethodMemory';
import { ServiceIcon } from '@/components/ServiceIcon';
import { useActiveVertical } from '@/lib/useActiveVertical';
import { useMembership } from '@/context/MembershipContext';
import { RoadsideActions } from '@/components/RoadsideActions';

// Clean inline action icons (premium — replaces emoji on the action row).
const Svg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ flexShrink: 0 }}>{children}</svg>
);
const IcoInvoice  = () => <Svg><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></Svg>;
const IcoSend     = () => <Svg><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></Svg>;
const IcoStar     = () => <Svg><polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2" /></Svg>;
const IcoCopy     = () => <Svg><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></Svg>;
const IcoEdit     = () => <Svg><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></Svg>;
const IcoTrash    = () => <Svg><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></Svg>;
const IcoCheck    = () => <Svg><polyline points="20 6 9 17 4 12" /></Svg>;
const IcoDollar   = () => <Svg><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></Svg>;
const IcoBox      = () => <Svg><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></Svg>;
import { useBrand } from '@/context/BrandContext';
import { useMembersDirectory } from '@/lib/useMembersDirectory';
import { JobTimer } from '@/components/JobDetailModal/JobTimer';
import { JobPhotoCapture } from '@/components/JobPhotoCapture';

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
  onMarkPaid: (method?: PaymentMethod) => void;
  /** Deduct this job's tire stock on demand (Complete Job Command
   *  Center). Inventory-source jobs are normally deducted at save time;
   *  this is the explicit fallback when they weren't. */
  onDeductInventory?: () => void;
  /** Optional patch-update callback used by the Phase-4 photos +
   *  signature surfaces, and the command center's Complete Job action.
   *  Threaded from App.tsx; when absent those actions render disabled. */
  onUpdateJob?: (patch: Partial<Job>) => Promise<void>;
}

export function JobDetailModal({
  job, settings, onClose, onEdit, onDuplicate, onDelete,
  onGenerateInvoice, onSendInvoice, onSendReview, onMarkPaid,
  onDeductInventory, onUpdateJob,
}: Props) {
  // Audit a11y P1-4 (2026-05-31): keep keyboard focus inside the
  // modal while it's open, and return focus to the card that opened
  // it when the user closes.
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const profit = jobGrossProfit(job, settings);
  const ps = resolvePaymentStatus(job);
  const vertical = useActiveVertical();
  // Tire Details block shows only when the active vertical uses
  // tire-style inventory OR the job itself carries tire data
  // (back-compat: a mechanic-account user viewing a legacy tire job
  // — including any historical pre-vertical-system imports — should
  // still see its details). Without this gate, mechanic/detailing
  // accounts saw an empty "Tire Details — Size: — / Qty: 0 /
  // Source:" block on every job.
  const showTireBlock =
    vertical.features.inventoryDeduction ||
    !!(job.tireSize || job.tireBrand || job.tireSource);
  // Method selection for the Mark Paid action. Defaults to cash (the
  // common case for roadside operators); operator can tap a different
  // chip before hitting Mark Paid. Pre-paid jobs (already 'Paid')
  // initialize from the stored method so re-opening the modal shows
  // the recorded value rather than flipping back to cash.
  // Default to the job's own method if set, else the operator's last-used
  // method (memory), else cash — so a Zelle shop isn't re-tapping the chip
  // on every job.
  const [payMethod, setPayMethod] = useState<PaymentMethod>(
    (job.paymentMethod as PaymentMethod | undefined) || getLastPaymentMethod() || 'cash',
  );
  // Edit affordance for a paid job's method. Closed by default —
  // expands to a chip row when the operator taps "Change" next to
  // the timestamp. Fires onMarkPaid(method) which re-runs the same
  // write path (paymentStatus stays 'Paid', paidAt preserved,
  // paymentMethod updated).
  const [editingMethod, setEditingMethod] = useState(false);
  const { role, member, permissions } = useMembership();
  const myUid = member?.uid || null;
  // Technicians see revenue (they set the price) but never the
  // cost breakdown or profit. canViewProfit is the single gate.
  const canViewProfit = permissions.canViewProfit;
  const { businessId } = useBrand();
  const { resolveName } = useMembersDirectory(businessId);
  const invDeds: InventoryDeduction[] | null = Array.isArray(job.inventoryDeductions)
    ? job.inventoryDeductions
    : null;

  // Review is "done" when either flag is set: reviewRequested (the free
  // native-SMS path used everywhere now) or the legacy reviewRequestSent
  // (back-compat for jobs sent via the old backend path).
  type JobWithReview = Job & { reviewRequestSent?: boolean };
  const reviewDone = job.reviewRequested === true || (job as JobWithReview).reviewRequestSent === true;
  // Command-center derived state.
  const isPaid = ps === 'Paid';
  const isCancelled = ps === 'Cancelled' || job.status === 'Cancelled';
  const isInventoryJob = job.tireSource === 'Inventory' && !!job.tireSize;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={trapRef} tabIndex={-1} className="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="job-modal-title">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24, display: 'inline-flex' }}><ServiceIcon name={job.service} /></span>
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
          {/* ─── Complete Job Command Center ──────────────────────────
              Everything to close out a job, on one screen at the top:
              Complete · Mark Paid · Send Invoice · Send Review SMS ·
              Deduct Inventory. Each row shows its done-state so the
              operator sees what's left at a glance. All actions use the
              free native-SMS / on-device handlers — no backend SMS cost.
              Hidden for cancelled jobs (nothing to collect). */}
          {!isCancelled && (
            <div className="form-group" style={cmdWrap}>
              <div className="form-group-title" style={{ marginBottom: 10 }}>Complete &amp; Collect</div>

              {/* 1 · Complete Job */}
              {job.status === 'Completed' ? (
                <CmdDone label="Job completed" />
              ) : (
                <CmdAction
                  label="Complete Job" sub="Mark the work finished" icon={<IcoCheck />} tone="primary"
                  disabled={!onUpdateJob}
                  onClick={() => { void onUpdateJob?.({ status: 'Completed' }); }}
                />
              )}

              {/* 2 · Mark Paid (with method chips when unpaid) */}
              {isPaid ? (
                <CmdDone label={`Paid${job.paymentMethod ? ` · ${PAYMENT_METHOD_LABELS[job.paymentMethod as PaymentMethod] ?? job.paymentMethod}` : ''}`} />
              ) : (
                <div>
                  <div style={cmdChips}>
                    {PAY_METHODS.map((m) => (
                      <button
                        key={m} type="button" onClick={() => setPayMethod(m)} aria-pressed={payMethod === m}
                        style={cmdChip(payMethod === m)}
                      >{PAYMENT_METHOD_LABELS[m]}</button>
                    ))}
                  </div>
                  <CmdAction
                    label={`Mark Paid · ${money(job.revenue)}`} sub={`via ${PAYMENT_METHOD_LABELS[payMethod]}`}
                    icon={<IcoDollar />} tone="green"
                    onClick={() => onMarkPaid(payMethod)}
                  />
                </div>
              )}

              {/* 3 · Send Invoice (generates if needed, then texts it) */}
              {job.invoiceSent ? (
                <CmdDone label="Invoice sent" actionLabel="Resend" onAction={onSendInvoice} />
              ) : (
                <CmdAction label="Send Invoice" sub="Generates + texts the invoice" icon={<IcoSend />} onClick={onSendInvoice} />
              )}

              {/* 4 · Send Review SMS (free native text) */}
              {reviewDone ? (
                <CmdDone label="Review requested" actionLabel="Resend" onAction={onSendReview} />
              ) : (
                <CmdAction label="Send Review SMS" sub="Texts your review link" icon={<IcoStar />} onClick={onSendReview} />
              )}

              {/* 5 · Deduct Inventory — only Inventory-source tire jobs */}
              {isInventoryJob && (
                invDeds && invDeds.length > 0 ? (
                  <CmdDone label={`Stock deducted · ${invDeds.map((d) => `${d.qty}×${d.size}`).join(', ')}`} />
                ) : (
                  <CmdAction
                    label="Deduct Inventory" sub={`${job.qty || 1}× ${job.tireSize} from stock`} icon={<IcoBox />}
                    disabled={!onDeductInventory}
                    onClick={() => onDeductInventory?.()}
                  />
                )
              )}
            </div>
          )}

          {/* Cost breakdown. Technicians (canViewProfit false) see a
              single Revenue row — never costs, travel, or profit.
              Owner/admin see the full reconciling breakdown: each
              cost row renders only when it has a value, so the rows
              always sum to Profit across every vertical. */}
          <div className="form-group" style={{ marginBottom: 12 }}>
            <Row label="Revenue" value={money(job.revenue)} className="green" bold />
            {/* Sales tax — only renders when settings.invoiceTaxRate > 0
                so a non-taxed business sees the same single-line UI it
                always did. Computed on the fly from the same field the
                invoice PDF uses, so the modal and the printed invoice
                are guaranteed to agree on the customer-facing math. */}
            {Number(settings.invoiceTaxRate || 0) > 0 && (() => {
              const rate = Number(settings.invoiceTaxRate || 0) / 100;
              const taxAmt = Math.round(Number(job.revenue || 0) * rate * 100) / 100;
              const total = Math.round((Number(job.revenue || 0) + taxAmt) * 100) / 100;
              return (
                <>
                  <Row label={`Sales Tax (${settings.invoiceTaxRate}%)`} value={'+' + money(taxAmt)} />
                  <Row label="Total Due" value={money(total)} bold />
                </>
              );
            })()}
            {canViewProfit && Number(job.tireCost || 0) > 0 && (
              <Row label="Tire Cost" value={'-' + money(job.tireCost)} className="red" />
            )}
            {canViewProfit && Number(job.partsCost || 0) > 0 && (
              <Row label="Parts Cost" value={'-' + money(job.partsCost)} className="red" />
            )}
            {canViewProfit && Number(job.materialCost || job.miscCost || 0) > 0 && (
              <Row label="Material Cost" value={'-' + money(job.materialCost || job.miscCost)} className="red" />
            )}
            {canViewProfit && (
              <Row label={`Travel (${job.miles || 0} mi)`} value={'-' + money(Number(job.miles || 0) * Number(settings.costPerMile || 0))} className="red" />
            )}
            {canViewProfit && (
              <Row label="Profit" value={money(profit)} className={profit >= 0 ? 'green' : 'red'} bold />
            )}
          </div>

          <div className="form-group" style={{ marginBottom: 12 }}>
            <div className="form-group-title">Customer</div>
            <Row label="Name" value={job.customerName || '—'} />
            <PhoneRow phone={job.customerPhone} />
            <LocationRow
              label={job.fullLocationLabel || (job.city && job.state ? `${job.city}, ${job.state}` : job.area || '—')}
            />
            <Row label="Source" value={job.source || '—'} />
            {/* Roadside — call the customer + navigate to the job site. */}
            <RoadsideActions
              phoneE164={job.customerPhone}
              address={job.fullLocationLabel || [job.city, job.state].filter(Boolean).join(', ') || job.area || null}
              style={{ marginTop: 10, marginBottom: 0 }}
            />
          </div>

          {showTireBlock && (
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
          )}

          {/* Phase 4 — Job photos. Multi-upload, camera capture
              shortcut, in-browser compression. Hides entirely when
              there's no businessId or the update callback wasn't
              threaded (read-only context). */}
          {businessId && onUpdateJob && (
            <div className="form-group" style={{ marginBottom: 12 }}>
              <div className="form-group-title">Photos</div>
              <JobPhotoCapture
                businessId={businessId}
                jobId={job.id}
                photos={job.photos || []}
                onChange={(next) => { void onUpdateJob({ photos: next }); }}
              />
            </div>
          )}

          {/* Mechanic-specific service details. Only renders when the
              job actually carries any of these fields, so a tire job
              accidentally viewed in mechanic mode stays clean. */}
          {vertical.key === 'mechanic' && (
            job.laborHours || job.partsCost || job.diagnosticCode ||
            job.vehicleMakeModel || job.mileage || job.diagnosticFee
          ) ? (
            <div className="form-group" style={{ marginBottom: 12 }}>
              <div className="form-group-title">Service Details</div>
              {job.vehicleMakeModel ? <Row label="Vehicle" value={job.vehicleMakeModel} /> : null}
              {job.mileage ? <Row label="Mileage" value={String(job.mileage)} /> : null}
              {job.diagnosticCode ? <Row label="Diagnostic" value={job.diagnosticCode} /> : null}
              {job.laborHours ? <Row label="Labor (hrs)" value={String(job.laborHours)} /> : null}
              {job.diagnosticFee ? <Row label="Diagnostic Fee" value={money(Number(job.diagnosticFee))} /> : null}
              {Array.isArray(job.parts) && job.parts.length > 0 ? (
                <Row label="Parts" value={`${job.parts.length} line${job.parts.length === 1 ? '' : 's'}`} />
              ) : null}
            </div>
          ) : null}

          {/* Detailing-specific service details. Vehicle size + add-ons. */}
          {vertical.key === 'detailing' && (job.vehicleSize || (Array.isArray(job.detailingAddons) && job.detailingAddons.length > 0)) ? (
            <div className="form-group" style={{ marginBottom: 12 }}>
              <div className="form-group-title">Service Details</div>
              {job.vehicleSize ? <Row label="Vehicle Size" value={job.vehicleSize} /> : null}
              {Array.isArray(job.detailingAddons) && job.detailingAddons.length > 0 ? (
                <Row label="Add-ons" value={job.detailingAddons.join(', ')} />
              ) : null}
            </div>
          ) : null}

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
            {/* Paid metadata: shows after Mark Paid. The method label
                uses PAYMENT_METHOD_LABELS so we render "Cash App" not
                "cashapp" (the canonical lowercase store value). The
                "Change" affordance reopens the chip picker so an
                operator who marked paid with the wrong method (e.g.
                hit Mark Paid on auto-cash before realizing it was
                Zelle) can correct it without leaving the modal. */}
            {ps === 'Paid' && job.paidAt && (
              <>
                <div style={{
                  marginTop: 4,
                  padding: '8px 12px',
                  background: 'rgba(34,197,94,.06)',
                  border: '1px solid rgba(34,197,94,.2)',
                  borderRadius: 8,
                  fontSize: 11,
                  color: 'var(--t2)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                }}>
                  <span>
                    Paid{job.paymentMethod
                      ? ` via ${PAYMENT_METHOD_LABELS[job.paymentMethod as PaymentMethod] ?? job.paymentMethod}`
                      : ''}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: 'var(--t3)' }}>
                      {new Date(job.paidAt).toLocaleString(undefined, {
                        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                      })}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditingMethod((v) => !v)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--brand-primary)',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: '2px 4px',
                      }}
                    >
                      {editingMethod ? 'Done' : 'Change'}
                    </button>
                  </div>
                </div>
                {editingMethod && (
                  <div style={{
                    display: 'flex', flexWrap: 'wrap', gap: 6,
                    marginTop: 6, padding: '8px 0',
                  }}>
                    {(['cash', 'card', 'zelle', 'venmo', 'cashapp', 'check', 'apple_pay', 'google_pay', 'other'] as PaymentMethod[]).map((m) => {
                      const selected = (job.paymentMethod as PaymentMethod | undefined) === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => onMarkPaid(m)}
                          aria-pressed={selected}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 8,
                            background: selected ? 'rgba(34,197,94,.10)' : 'var(--s3)',
                            border: selected ? '1px solid var(--green)' : '1px solid var(--border)',
                            color: selected ? 'var(--green)' : 'var(--t2)',
                            fontSize: 11, fontWeight: selected ? 700 : 600,
                            cursor: 'pointer',
                          }}
                        >
                          {PAYMENT_METHOD_LABELS[m]}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Sub-Project 2.4: time-tracking block. Renders for every
              job; START/STOP gated by canEditJob inside the
              component. */}
          <JobTimer
            job={job}
            role={role}
            uid={myUid}
            resolveName={resolveName}
          />


          {/* Secondary actions. The primary close-out actions (Complete,
              Mark Paid, Invoice, Review, Deduct) live in the command
              center at the top — these are the less-frequent record ops. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 16 }}>
            <button className="btn secondary" onClick={onGenerateInvoice}><IcoInvoice /> Invoice PDF</button>
            <button className="btn secondary" onClick={onDuplicate}><IcoCopy /> Duplicate</button>
            <button className="btn secondary" onClick={onEdit}><IcoEdit /> Edit</button>
            <button className="btn danger" onClick={onDelete}><IcoTrash /> Delete</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Complete Job Command Center helpers ──────────────────────────────
const PAY_METHODS: PaymentMethod[] = ['cash', 'card', 'zelle', 'venmo', 'cashapp', 'check', 'apple_pay', 'google_pay', 'other'];

const cmdWrap: CSSProperties = {
  marginBottom: 14, padding: 12,
  background: 'var(--s2)', border: '1px solid var(--border)', borderRadius: 14,
};
const cmdChips: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 };
function cmdChip(on: boolean): CSSProperties {
  return {
    padding: '6px 10px', borderRadius: 8,
    background: on ? 'rgba(34,197,94,.10)' : 'var(--s3)',
    border: on ? '1px solid var(--green)' : '1px solid var(--border)',
    color: on ? 'var(--green)' : 'var(--t2)',
    fontSize: 11, fontWeight: on ? 700 : 600, cursor: 'pointer', lineHeight: 1.2,
  };
}

/** A tappable command-center action row — icon + label/sub + chevron.
 *  `tone` raises it to a filled primary/green CTA; otherwise it's a
 *  bordered secondary row. Full-width + ≥56px tall for one-thumb use. */
function CmdAction({ label, sub, icon, onClick, disabled, tone }: {
  label: string; sub?: string; icon: ReactNode; onClick: () => void;
  disabled?: boolean; tone?: 'primary' | 'green';
}) {
  const strong = tone === 'green' || tone === 'primary';
  const accent = tone === 'green' ? 'var(--green)' : 'var(--brand-primary)';
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 14px', marginBottom: 8, minHeight: 56,
        background: strong
          ? (tone === 'green' ? 'linear-gradient(135deg, var(--green) 0%, #16a34a 100%)' : 'var(--brand-primary)')
          : 'var(--s1)',
        color: strong ? '#fff' : 'var(--t1)',
        border: strong ? 'none' : '1px solid var(--border)',
        borderRadius: 12, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1, textAlign: 'left',
        boxShadow: tone === 'green' ? '0 6px 18px rgba(34,197,94,.22)' : 'none',
      }}
    >
      <span style={{ display: 'inline-flex', flexShrink: 0, color: strong ? '#fff' : accent }}>{icon}</span>
      <span style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.2 }}>{label}</span>
        {sub ? <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.8, marginTop: 1 }}>{sub}</span> : null}
      </span>
      <span aria-hidden="true" style={{ fontSize: 18, opacity: 0.7, flexShrink: 0 }}>›</span>
    </button>
  );
}

/** A completed command-center row — green check + label, with an
 *  optional "Resend" affordance for invoice / review. */
function CmdDone({ label, actionLabel, onAction }: {
  label: string; actionLabel?: string; onAction?: () => void;
}) {
  return (
    <div style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 12,
      padding: '11px 14px', marginBottom: 8, minHeight: 48,
      background: 'rgba(34,197,94,.06)', border: '1px solid rgba(34,197,94,.22)', borderRadius: 12,
    }}>
      <span style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--green)' }}><IcoCheck /></span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction} style={{
          background: 'transparent', border: 'none', color: 'var(--brand-primary)',
          fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '4px 6px', flexShrink: 0,
        }}>{actionLabel}</button>
      ) : null}
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

// Tap-to-call row. iOS / Android both honor tel: URIs from PWA
// standalone mode. On desktop most browsers prompt to launch a
// dialer app or are no-ops, which is fine — the visual still
// shows the number.
function PhoneRow({ phone }: { phone: string | undefined }) {
  const v = (phone || '').trim();
  if (!v) return <Row label="Phone" value="—" />;
  const tel = v.replace(/[^\d+]/g, '');
  return (
    <div className="card-row" style={{ padding: '8px 0' }}>
      <span className="label">Phone</span>
      <a
        href={`tel:${tel}`}
        className="value"
        style={{ color: 'var(--brand-primary)', textDecoration: 'none', fontWeight: 600 }}
      >
        {v}
      </a>
    </div>
  );
}

// Tap-to-navigate location row. iOS opens Apple Maps; Android opens
// the user's default map app via the geo: scheme (with the daddr
// query param honored by Google Maps when installed).
function LocationRow({ label }: { label: string }) {
  if (!label || label === '—') return <Row label="Location" value="—" />;
  const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent || '');
  const href = isIOS
    ? `maps://?q=${encodeURIComponent(label)}`
    : `https://maps.google.com/?q=${encodeURIComponent(label)}`;
  return (
    <div className="card-row" style={{ padding: '8px 0' }}>
      <span className="label">Location</span>
      <a
        href={href}
        target={isIOS ? undefined : '_blank'}
        rel="noopener noreferrer"
        className="value"
        style={{ color: 'var(--brand-primary)', textDecoration: 'none', fontWeight: 600 }}
      >
        {label}
      </a>
    </div>
  );
}

