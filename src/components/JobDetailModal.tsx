import { useState } from 'react';
import type { Job, Settings, InventoryDeduction, PaymentMethod } from '@/types';
import { PAYMENT_METHOD_LABELS } from '@/types';
import { fmtDate, jobGrossProfit, money, paymentPillClass, resolvePaymentStatus, serviceIcon } from '@/lib/utils';
import { useActiveVertical } from '@/lib/useActiveVertical';
import { useMembership } from '@/context/MembershipContext';
import { useBrand } from '@/context/BrandContext';
import { useMembersDirectory } from '@/lib/useMembersDirectory';
import { JobTimer } from '@/components/JobDetailModal/JobTimer';
import { JobPhotoCapture } from '@/components/JobPhotoCapture';
import { SignaturePad } from '@/components/SignaturePad';

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
  /** Optional patch-update callback used by the Phase-4 photos +
   *  signature surfaces. Threaded from App.tsx; when absent, the
   *  photo / signature sections render in read-only mode. */
  onUpdateJob?: (patch: Partial<Job>) => Promise<void>;
}

export function JobDetailModal({
  job, settings, onClose, onEdit, onDuplicate, onDelete,
  onGenerateInvoice, onSendInvoice, onSendReview, onMarkPaid,
  onUpdateJob,
}: Props) {
  const profit = jobGrossProfit(job, settings);
  const ps = resolvePaymentStatus(job);
  const vertical = useActiveVertical();
  // Tire Details block shows only when the active vertical uses
  // tire-style inventory OR the job itself carries tire data
  // (back-compat: a mechanic-account user viewing a legacy tire job
  // imported via WheelRushBackupImport should still see its details).
  // Without this gate, mechanic/detailing accounts saw an empty
  // "Tire Details — Size: — / Qty: 0 / Source:" block on every job.
  const showTireBlock =
    vertical.features.inventoryDeduction ||
    !!(job.tireSize || job.tireBrand || job.tireSource);
  // Method selection for the Mark Paid action. Defaults to cash (the
  // common case for roadside operators); operator can tap a different
  // chip before hitting Mark Paid. Pre-paid jobs (already 'Paid')
  // initialize from the stored method so re-opening the modal shows
  // the recorded value rather than flipping back to cash.
  const [payMethod, setPayMethod] = useState<PaymentMethod>(
    (job.paymentMethod as PaymentMethod | undefined) || 'cash',
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
          {/* Cost breakdown. Technicians (canViewProfit false) see a
              single Revenue row — never costs, travel, or profit.
              Owner/admin see the full reconciling breakdown: each
              cost row renders only when it has a value, so the rows
              always sum to Profit across every vertical. */}
          <div className="form-group" style={{ marginBottom: 12 }}>
            <Row label="Revenue" value={money(job.revenue)} className="green" bold />
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
            <Row label="Phone" value={job.customerPhone || '—'} />
            <Row label="Location" value={job.fullLocationLabel || (job.city && job.state ? `${job.city}, ${job.state}` : job.area || '—')} />
            <Row label="Source" value={job.source || '—'} />
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

          {/* Phase 4 — Customer signature. Captures a PNG data URL
              persisted on the job for the invoice PDF to embed.
              Renders a tap-to-open sheet so the pad doesn't eat
              vertical space when no signature is needed. */}
          {onUpdateJob && (
            <SignatureSection
              job={job}
              onCapture={(dataUrl) => onUpdateJob({
                signatureDataUrl: dataUrl,
                signatureCapturedAt: new Date().toISOString(),
              })}
              onClear={() => onUpdateJob({
                signatureDataUrl: undefined,
                signatureCapturedAt: undefined,
              })}
            />
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


          {/* Mark Paid CTA — primary action when payment is outstanding.
              Chip row selects the payment method (defaults to cash —
              the most common roadside case). One tap on the green
              button records both the timestamp and the method so the
              "Paid via X · {date}" audit line + invoice PDF can
              actually render. */}
          {ps !== 'Paid' && ps !== 'Cancelled' && (
            <div style={{ marginTop: 16 }}>
              <div style={{
                fontSize: 10, fontWeight: 700, color: 'var(--t3)',
                textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6,
              }}>
                Payment method
              </div>
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10,
              }}>
                {(['cash', 'card', 'zelle', 'venmo', 'cashapp', 'check', 'apple_pay', 'google_pay', 'other'] as PaymentMethod[]).map((m) => {
                  const selected = payMethod === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPayMethod(m)}
                      aria-pressed={selected}
                      style={{
                        padding: '7px 11px',
                        borderRadius: 8,
                        background: selected ? 'rgba(34,197,94,.10)' : 'var(--s3)',
                        border: selected
                          ? '1px solid var(--green)'
                          : '1px solid var(--border)',
                        color: selected ? 'var(--green)' : 'var(--t2)',
                        fontSize: 12, fontWeight: selected ? 700 : 600,
                        cursor: 'pointer', lineHeight: 1.2,
                      }}
                    >
                      {PAYMENT_METHOD_LABELS[m]}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => onMarkPaid(payMethod)}
                style={{
                  width: '100%',
                  padding: '14px 18px',
                  background: 'linear-gradient(135deg, var(--green) 0%, #16a34a 100%)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 6px 20px rgba(34,197,94,.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  minHeight: 52,
                }}
              >
                💰 Mark Paid · {money(job.revenue)}
              </button>
            </div>
          )}

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

// ─── Customer signature section ────────────────────────────────────
// Captured value persists on the job for the invoice PDF to embed.
// Renders three states:
//   • not captured → "Capture signature" button
//   • captured     → thumbnail + "Recapture" / "Clear" actions
//   • capturing    → inline SignaturePad
function SignatureSection({
  job, onCapture, onClear,
}: { job: Job; onCapture: (dataUrl: string) => void; onClear: () => void }) {
  const [capturing, setCapturing] = useState(false);
  const hasSignature = !!job.signatureDataUrl;

  return (
    <div className="form-group" style={{ marginBottom: 12 }}>
      <div className="form-group-title">Signature</div>
      {capturing ? (
        <SignaturePad
          initial={job.signatureDataUrl}
          onCapture={(dataUrl) => { onCapture(dataUrl); setCapturing(false); }}
          onCancel={() => setCapturing(false)}
        />
      ) : hasSignature ? (
        <>
          <img
            src={job.signatureDataUrl}
            alt="Customer signature"
            style={{
              display: 'block', width: '100%',
              maxHeight: 140, objectFit: 'contain',
              background: 'var(--s2)',
              border: '1px solid var(--border)',
              borderRadius: 10, padding: 8,
            }}
          />
          {job.signatureCapturedAt && (
            <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 6 }}>
              Signed {new Date(job.signatureCapturedAt).toLocaleString()}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              type="button"
              className="btn sm secondary"
              onClick={() => setCapturing(true)}
              style={{ flex: 1 }}
            >
              Recapture
            </button>
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => { if (window.confirm('Remove signature?')) onClear(); }}
              style={{ flex: 1, color: '#ef4444' }}
            >
              Clear
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="btn sm secondary"
          onClick={() => setCapturing(true)}
          style={{ width: '100%' }}
        >
          ✍ Capture customer signature
        </button>
      )}
    </div>
  );
}
