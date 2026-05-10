import { useEffect, useMemo, useState } from 'react';
import { useBrand } from '@/context/BrandContext';
import {
  DEFAULT_SERVICE_PRICING,
  DEFAULT_VEHICLE_PRICING,
  EMPTY_JOB,
  LEAD_SOURCES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  TIRE_SOURCES,
} from '@/lib/defaults';
import type { InventoryItem, Job, JobStatus, PaymentStatus, Settings, TireSource } from '@/types';
import { calcQuote, haptic, jobGrossProfit, money, planInventoryDeduction, r2, serviceIcon, uid } from '@/lib/utils';
import { uploadReceipt } from '@/lib/firebase';
import { addToast } from '@/lib/toast';

interface Props {
  settings: Settings;
  inventory: InventoryItem[];
  prefill: Partial<Job> | null;
  editJob: Job | null;
  saving: boolean;
  onSave: (job: Job, addAnother: boolean) => void;
  onClearPrefill: () => void;
}

export function AddJob({ settings, inventory, prefill, editJob, saving, onSave, onClearPrefill }: Props) {
  const { brand, businessId } = useBrand();
  const enabledServices = useMemo(() => {
    const sp = settings.servicePricing || DEFAULT_SERVICE_PRICING;
    return Object.keys(sp).filter((k) => sp[k] && sp[k].enabled !== false);
  }, [settings.servicePricing]);

  const [form, setForm] = useState<Job>(() => {
    const base: Job = editJob
      ? { ...editJob }
      : prefill
      ? { ...EMPTY_JOB(), ...(prefill as Partial<Job>) }
      : EMPTY_JOB();
    if (!enabledServices.includes(base.service) && enabledServices.length) base.service = enabledServices[0];
    return base;
  });

  useEffect(() => {
    if (editJob) {
      setForm({ ...editJob });
    } else if (prefill) {
      setForm({ ...EMPTY_JOB(), ...(prefill as Partial<Job>) });
      onClearPrefill();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editJob, prefill]);

  const ch = <K extends keyof Job>(k: K, v: Job[K]) => setForm((p) => ({ ...p, [k]: v }));

  const svcs = enabledServices.length ? enabledServices : Object.keys(DEFAULT_SERVICE_PRICING);
  const vehs = Object.keys(settings.vehiclePricing || DEFAULT_VEHICLE_PRICING);
  const quote = useMemo(() => calcQuote(form, settings), [form, settings]);
  const [receiptUploading, setReceiptUploading] = useState(false);

  // When source flips to "Customer supplied", default tireCost to 0 unless the
  // user has already typed something. This matches the documented rule:
  // customer-supplied = $0 tire cost unless manually entered.
  useEffect(() => {
    if (form.tireSource === 'Customer supplied' && form.tireCost === '') {
      setForm((p) => ({ ...p, tireCost: 0 }));
    }
  }, [form.tireSource]); // eslint-disable-line react-hooks/exhaustive-deps

  // When pulling from inventory, the authoritative tire cost is the inventory
  // deduction total, NOT whatever the user typed. Compute it for live preview
  // so the profit display reflects what saveJob() will actually persist.
  const inventoryPlan = useMemo(() => {
    if (form.tireSource !== 'Inventory' || !form.tireSize || !Number(form.qty || 0)) return null;
    return planInventoryDeduction(form.tireSize, Number(form.qty), inventory);
  }, [form.tireSource, form.tireSize, form.qty, inventory]);

  const effectiveTireCost = useMemo(() => {
    if (inventoryPlan && inventoryPlan.deductions.length) {
      return r2(
        inventoryPlan.deductions.reduce((t, d) => t + Number(d.cost || 0) * Number(d.qty || 0), 0)
      );
    }
    return Number(form.tireCost || 0);
  }, [inventoryPlan, form.tireCost]);

  // Job used for live profit preview — overrides user-typed tireCost when an
  // inventory deduction plan exists, matching the saveJob() behavior exactly.
  const previewJob: Job = useMemo(
    () => (inventoryPlan && inventoryPlan.deductions.length ? { ...form, tireCost: effectiveTireCost } : form),
    [form, inventoryPlan, effectiveTireCost]
  );

  const handleSave = (addAnother: boolean) => {
    if (!form.revenue && form.status !== 'Pending') {
      addToast('Enter a price', 'warn');
      return;
    }
    haptic();
    const finalJob: Job = { ...form, id: form.id || uid() };
    if (finalJob.status === 'Pending' && (!finalJob.paymentStatus || finalJob.paymentStatus === 'Paid')) {
      finalJob.paymentStatus = 'Pending Payment';
    } else if (finalJob.status === 'Cancelled') {
      finalJob.paymentStatus = 'Cancelled';
    } else if (finalJob.status === 'Completed' && finalJob.paymentStatus === 'Cancelled') {
      finalJob.paymentStatus = 'Paid';
    } else if (!finalJob.paymentStatus) {
      finalJob.paymentStatus = 'Paid';
    }
    onSave(finalJob, addAnother);
    if (addAnother) setForm(EMPTY_JOB());
  };

  return (
    <div className="page page-enter">
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>{editJob ? 'Edit Job' : 'Log New Job'}</div>

      <div className="form-group">
        <div className="form-group-title">Service Details</div>
        <div className="field">
          <label>Service Type</label>
          <div className="chip-row">
            {svcs.map((s) => (
              <button key={s} className={'chip' + (form.service === s ? ' active' : '')} onClick={() => ch('service', s)}>
                {serviceIcon(s)} {s}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Vehicle Type</label>
          <div className="chip-row">
            {vehs.map((v) => (
              <button key={v} className={'chip' + (form.vehicleType === v ? ' active' : '')} onClick={() => ch('vehicleType', v)}>
                {v}
              </button>
            ))}
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Date</label>
            <input type="date" value={form.date} onChange={(e) => ch('date', e.target.value)} />
          </div>
          <div className="field">
            <label>Area / City</label>
            <input value={form.area} onChange={(e) => ch('area', e.target.value)} placeholder={brand.serviceArea || 'City'} />
          </div>
        </div>
      </div>

      <div className="form-group">
        <div className="form-group-title">Customer</div>
        <div className="field-row">
          <div className="field">
            <label>Name</label>
            <input value={form.customerName} onChange={(e) => ch('customerName', e.target.value)} placeholder="Customer name" />
          </div>
          <div className="field">
            <label>Phone</label>
            <input type="tel" value={form.customerPhone} onChange={(e) => ch('customerPhone', e.target.value)} placeholder="Phone" />
          </div>
        </div>
      </div>

      <div className="form-group">
        <div className="form-group-title">Tire Info</div>
        <div className="field-row">
          <div className="field">
            <label>Tire Size</label>
            <input value={form.tireSize} onChange={(e) => ch('tireSize', e.target.value)} placeholder="225/60R18" />
          </div>
          <div className="field">
            <label>Qty</label>
            <input type="number" inputMode="numeric" value={form.qty} onChange={(e) => ch('qty', Number(e.target.value))} />
          </div>
        </div>
        <div className="field">
          <label>Tire Source</label>
          <div className="chip-row">
            {TIRE_SOURCES.map((s) => (
              <button
                key={s}
                className={'chip sm' + (form.tireSource === s ? ' active' : '')}
                onClick={() => ch('tireSource', s as TireSource)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {form.tireSource === 'Bought for this job' && (
          <div className="purchase-panel">
            <div className="purchase-panel-title">Purchase Details</div>
            <div className="field-row">
              <div className="field">
                <label>Bought from / vendor</label>
                <input
                  value={form.tireVendor || ''}
                  onChange={(e) => ch('tireVendor', e.target.value)}
                  placeholder="Discount Tire, NTB, etc."
                />
              </div>
              <div className="field">
                <label>Purchase price ($)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={(form.tirePurchasePrice as number | string) || ''}
                  onChange={(e) => {
                    ch('tirePurchasePrice', e.target.value);
                    // Mirror to tireCost so profit math uses the purchase price.
                    ch('tireCost', e.target.value);
                  }}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="field">
              <label>Condition</label>
              <div className="chip-row">
                {(['New', 'Used'] as const).map((c) => (
                  <button
                    key={c}
                    className={'chip sm' + (form.tireCondition === c ? ' active' : '')}
                    onClick={() => ch('tireCondition', c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Brand</label>
                <input
                  value={form.tireBrand || ''}
                  onChange={(e) => ch('tireBrand', e.target.value)}
                  placeholder="Michelin, Goodyear..."
                />
              </div>
              <div className="field">
                <label>Model</label>
                <input
                  value={form.tireModel || ''}
                  onChange={(e) => ch('tireModel', e.target.value)}
                  placeholder="Defender, Assurance..."
                />
              </div>
            </div>
            <div className="field">
              <label>Receipt / photo (optional)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {form.tireReceiptUrl ? (
                  <a
                    href={form.tireReceiptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="receipt-thumb"
                    title="View receipt"
                  >
                    <img src={form.tireReceiptUrl} alt="" />
                  </a>
                ) : null}
                <input
                  id="receipt-upload"
                  type="file"
                  accept="image/*,application/pdf"
                  style={{ display: 'none' }}
                  disabled={receiptUploading}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f || !businessId) return;
                    setReceiptUploading(true);
                    try {
                      const jid = form.id || uid();
                      if (!form.id) ch('id', jid);
                      const url = await uploadReceipt(businessId, jid, f);
                      if (url) {
                        ch('tireReceiptUrl', url);
                        addToast('Receipt uploaded', 'success');
                      }
                    } catch (err) {
                      addToast((err as Error).message || 'Upload failed', 'error');
                    } finally {
                      setReceiptUploading(false);
                    }
                  }}
                />
                <label htmlFor="receipt-upload" className="btn sm secondary" style={{ cursor: 'pointer' }}>
                  {receiptUploading ? 'Uploading…' : form.tireReceiptUrl ? 'Replace' : 'Upload'}
                </label>
                {form.tireReceiptUrl ? (
                  <button
                    type="button"
                    className="btn sm secondary"
                    onClick={() => ch('tireReceiptUrl', '')}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Purchase notes (optional)</label>
              <textarea
                rows={2}
                value={form.tireNotes || ''}
                onChange={(e) => ch('tireNotes', e.target.value)}
                placeholder="DOT code, warranty, vendor reference..."
              />
            </div>
          </div>
        )}
      </div>

      <div className="form-group">
        <div className="form-group-title">Pricing</div>
        <div className="field-row">
          <div className="field">
            <label>Revenue ($)</label>
            <input
              type="number"
              inputMode="decimal"
              value={form.revenue as number | string}
              onChange={(e) => ch('revenue', e.target.value)}
              placeholder={String(quote.suggested)}
            />
          </div>
          <div className="field">
            <label>
              Tire Cost ($)
              {inventoryPlan && inventoryPlan.deductions.length ? (
                <span style={{ marginLeft: 8, color: 'var(--brand-primary)', fontWeight: 700 }}>
                  · auto from inventory
                </span>
              ) : null}
            </label>
            <input
              type="number"
              inputMode="decimal"
              value={
                inventoryPlan && inventoryPlan.deductions.length
                  ? effectiveTireCost
                  : (form.tireCost as number | string)
              }
              onChange={(e) => ch('tireCost', e.target.value)}
              placeholder="0"
              disabled={!!(inventoryPlan && inventoryPlan.deductions.length)}
              style={
                inventoryPlan && inventoryPlan.deductions.length
                  ? { opacity: 0.7, cursor: 'not-allowed' }
                  : undefined
              }
            />
            {inventoryPlan && inventoryPlan.shortfall > 0 ? (
              <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4 }}>
                Short {inventoryPlan.shortfall} of {form.tireSize} in stock
              </div>
            ) : null}
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Material Cost ($)</label>
            <input
              type="number"
              inputMode="decimal"
              value={(form.materialCost as number | string) || (form.miscCost as number | string) || ''}
              onChange={(e) => ch('materialCost', e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="field">
            <label>Miles</label>
            <input
              type="number"
              inputMode="decimal"
              value={form.miles as number | string}
              onChange={(e) => ch('miles', e.target.value)}
              placeholder="0"
            />
          </div>
        </div>
        {Number(form.revenue) > 0 && (
          <div style={{ padding: '10px 0', fontSize: 12, color: 'var(--t2)' }}>
            Profit:{' '}
            <span className="value green" style={{ fontSize: 14 }}>
              {money(jobGrossProfit(previewJob, settings))}
            </span>
            {inventoryPlan && inventoryPlan.deductions.length ? (
              <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--t3)' }}>
                (tire cost {money(effectiveTireCost)} from inventory)
              </span>
            ) : null}
          </div>
        )}
      </div>

      <div className="form-group">
        <div className="form-group-title">Details</div>
        <div className="field">
          <label>Lead Source</label>
          <div className="src-grid">
            {LEAD_SOURCES.map((s) => (
              <button key={s} className={'src-btn' + (form.source === s ? ' active' : '')} onClick={() => ch('source', s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Payment Method</label>
          <div className="pay-grid">
            {PAYMENT_METHODS.map((p) => (
              <button key={p} className={'pay-btn' + (form.payment === p ? ' active' : '')} onClick={() => ch('payment', p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Job Status</label>
          <div className="chip-row">
            {(['Completed', 'Pending', 'Cancelled'] as JobStatus[]).map((s) => (
              <button key={s} className={'chip' + (form.status === s ? ' active' : '')} onClick={() => ch('status', s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Payment Status</label>
          <div className="chip-row">
            {PAYMENT_STATUSES.map((s) => (
              <button
                key={s}
                className={'chip sm' + ((form.paymentStatus || 'Paid') === s ? ' active' : '')}
                onClick={() => ch('paymentStatus', s as PaymentStatus)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {([
            ['emergency', '🚨 Emergency'],
            ['lateNight', '🌙 Late Night'],
            ['highway', '🛣 Highway'],
            ['weekend', '📅 Weekend'],
          ] as const).map(([k, l]) => (
            <button key={k} className={'chip sm' + (form[k] ? ' active' : '')} onClick={() => ch(k, !form[k])}>
              {l}
            </button>
          ))}
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label>Notes</label>
          <textarea rows={2} value={form.note || ''} onChange={(e) => ch('note', e.target.value)} placeholder="Optional notes..." />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12, marginBottom: 12 }}>
        <button className="btn primary" onClick={() => handleSave(false)} disabled={saving}>
          {saving ? 'Saving...' : 'Save Job'}
        </button>
        <button className="btn secondary" onClick={() => handleSave(true)} disabled={saving}>
          Save + Another
        </button>
      </div>
    </div>
  );
}
