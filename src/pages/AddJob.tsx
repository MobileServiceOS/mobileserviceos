import { useEffect, useMemo, useRef, useState } from 'react';
import type { Job, Settings, InventoryItem, TireSource } from '@/types';
import {
  DEFAULT_SERVICE_PRICING, DEFAULT_VEHICLE_PRICING,
  LEAD_SOURCES, PAYMENT_METHODS, PAYMENT_STATUSES, TIRE_MATERIAL_SERVICES, TIRE_SOURCES,
} from '@/lib/defaults';
import { computeBreakdown } from '@/lib/pricing';
import { calcQuote, money, normalizeTireSize, planInventoryDeduction, serviceIcon } from '@/lib/utils';
import { addToast } from '@/lib/toast';
import { uploadReceipt } from '@/lib/firebase';
import { useBrand } from '@/context/BrandContext';
import { CityStateSelect } from '@/components/CityStateSelect';
import { NumberField } from '@/components/NumberField';

interface Props {
  job: Job;
  setJob: (next: Job) => void;
  settings: Settings;
  inventory: InventoryItem[];
  isEditing: boolean;
  prefilledFromQuote: boolean;
  onSave: () => Promise<void> | void;
  onSaveAndNew: () => Promise<void> | void;
}

export function AddJob({ job, setJob, settings, inventory, isEditing, prefilledFromQuote, onSave, onSaveAndNew }: Props) {
  const { businessId } = useBrand();
  const enabledServices = useMemo(() => {
    const sp = settings.servicePricing || DEFAULT_SERVICE_PRICING;
    return Object.keys(sp).filter((k) => sp[k] && sp[k].enabled !== false);
  }, [settings.servicePricing]);

  const vehicles = useMemo(() => Object.keys(settings.vehiclePricing || DEFAULT_VEHICLE_PRICING), [settings.vehiclePricing]);

  const set = <K extends keyof Job>(k: K, v: Job[K]) => setJob({ ...job, [k]: v });

  const needsTireDetails = TIRE_MATERIAL_SERVICES.includes(job.service);
  const tireSource = (job.tireSource || 'Inventory') as TireSource;

  /**
   * Revenue auto-fill — fixes the "revenue stays at 0" bug.
   *
   * Strategy: every time the suggested price (re)computes, fill revenue
   * IF revenue is empty/0 OR revenue currently matches the last suggested
   * we applied. That second condition means "the user hasn't manually
   * changed it." Once they tap into the Revenue field and type a different
   * number, we stop overwriting.
   *
   * Without this, the legacy effect only fired on service/vehicleType
   * change — so adding miles, switching tire source, or toggling
   * surcharges wouldn't update the suggested price into the field, and
   * starting a job from the Quick Quote tile could leave revenue at 0
   * if the form arrived empty.
   */
  const lastAutoAppliedRef = useRef<number | null>(null);
  useEffect(() => {
    if (isEditing) return; // never overwrite a job being edited
    const q = calcQuote({
      service: job.service, vehicleType: job.vehicleType,
      miles: job.miles, tireCost: job.tireCost, materialCost: job.materialCost,
      qty: job.qty, emergency: job.emergency, lateNight: job.lateNight,
      highway: job.highway, weekend: job.weekend,
    }, settings);
    const suggested = Number(q.suggested) || 0;
    if (suggested <= 0) return;

    const currentRevenue = Number(job.revenue || 0);
    const lastApplied = lastAutoAppliedRef.current;
    // Apply when: (a) revenue is blank/zero, or (b) revenue equals what
    // we last auto-applied (i.e. user hasn't manually overridden).
    const shouldApply =
      currentRevenue === 0 || (lastApplied !== null && currentRevenue === lastApplied);

    if (shouldApply && currentRevenue !== suggested) {
      lastAutoAppliedRef.current = suggested;
      setJob({ ...job, revenue: suggested });
    } else if (lastApplied === null && currentRevenue > 0) {
      // First render with an existing revenue (e.g. arrived from Quick
      // Quote with a price already set). Remember it as the baseline so
      // subsequent suggested recomputes don't overwrite the user's
      // intentional value.
      lastAutoAppliedRef.current = currentRevenue;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    job.service, job.vehicleType, job.miles, job.tireCost, job.materialCost,
    job.qty, job.emergency, job.lateNight, job.highway, job.weekend,
    settings, isEditing,
  ]);

  // Auto-zero tireCost when customer-supplied
  useEffect(() => {
    if (tireSource === 'Customer supplied' && Number(job.tireCost || 0) !== 0) {
      set('tireCost', 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tireSource]);

  // Mirror purchase price → tireCost when bought-for-this-job
  useEffect(() => {
    if (tireSource === 'Bought for this job') {
      const pp = Number(job.tirePurchasePrice || 0);
      if (pp && Number(job.tireCost || 0) !== pp) set('tireCost', pp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.tirePurchasePrice, tireSource]);

  // Default state to brand state on new jobs
  const { brand } = useBrand();
  useEffect(() => {
    if (!isEditing && !job.state && brand.state) {
      setJob({
        ...job,
        state: brand.state,
        city: job.city || brand.mainCity || '',
        fullLocationLabel: job.fullLocationLabel ||
          (brand.mainCity && brand.state ? `${brand.mainCity}, ${brand.state}` : (job.area || '')),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand.state]);

  const breakdown = useMemo(() => computeBreakdown(job, settings), [job, settings]);

  // Inventory plan preview (so user sees deductions before save)
  const inventoryPlan = useMemo(() => {
    if (tireSource !== 'Inventory' || !job.tireSize) return null;
    return planInventoryDeduction(job.tireSize, Number(job.qty || 1), inventory);
  }, [tireSource, job.tireSize, job.qty, inventory]);

  const matchingInventoryCount = useMemo(() => {
    if (!job.tireSize) return 0;
    const t = normalizeTireSize(job.tireSize);
    return inventory.filter((i) => normalizeTireSize(i.size) === t).reduce((s, i) => s + Number(i.qty || 0), 0);
  }, [inventory, job.tireSize]);

  const receiptInputRef = useRef<HTMLInputElement | null>(null);
  const [receiptUploading, setReceiptUploading] = useState(false);

  const handleReceipt = async (file: File) => {
    if (!businessId) { addToast('Sign in required', 'warn'); return; }
    setReceiptUploading(true);
    try {
      const url = await uploadReceipt(businessId, job.id || 'pending-' + Date.now(), file);
      if (url) { set('tireReceiptUrl', url); addToast('Receipt uploaded', 'success'); }
    } catch (e) {
      addToast((e as Error).message || 'Upload failed', 'error');
    } finally {
      setReceiptUploading(false);
    }
  };

  return (
    <div className="page page-enter">
      {prefilledFromQuote && !isEditing && (
        <div className="info-banner card-anim">
          Pre-filled from Quick Quote · Adjust details below
        </div>
      )}

      <div className="form-group card-anim">
        <div className="form-group-title">Service</div>
        <div className="chip-grid">
          {enabledServices.map((s) => (
            <button
              key={s} className={'chip' + (job.service === s ? ' active' : '')}
              onClick={() => set('service', s)}
              type="button"
            >
              <span style={{ marginRight: 6 }}>{serviceIcon(s)}</span>{s}
            </button>
          ))}
        </div>
      </div>

      <div className="form-group card-anim">
        <div className="form-group-title">Vehicle</div>
        <div className="chip-grid">
          {vehicles.map((v) => (
            <button key={v} className={'chip' + (job.vehicleType === v ? ' active' : '')}
              onClick={() => set('vehicleType', v)} type="button">{v}</button>
          ))}
        </div>
      </div>

      <div className="form-group card-anim">
        <div className="form-group-title">Customer</div>
        <div className="field-row">
          <div className="field">
            <label>Name</label>
            <input value={job.customerName} onChange={(e) => set('customerName', e.target.value)} placeholder="John D." />
          </div>
          <div className="field">
            <label>Phone</label>
            <input type="tel" value={job.customerPhone} onChange={(e) => set('customerPhone', e.target.value)} placeholder="(555) 123-4567" />
          </div>
        </div>
        <CityStateSelect
          city={job.city || ''}
          state={job.state || ''}
          onChange={({ city, state, fullLocationLabel }) =>
            setJob({ ...job, city, state, fullLocationLabel, area: city || job.area })
          }
        />
      </div>

      {needsTireDetails && (
        <div className="form-group card-anim">
          <div className="form-group-title">Tire Details</div>
          <div className="field-row">
            <div className="field">
              <label>Size</label>
              <input value={job.tireSize} onChange={(e) => set('tireSize', e.target.value)} placeholder="225/65R17" />
            </div>
            <div className="field">
              <label>Qty</label>
              <NumberField
                value={job.qty}
                onChange={(n) => set('qty', n)}
                decimals={false}
                placeholder="1"
              />
            </div>
          </div>
          <div className="field">
            <label>Tire source</label>
            <div className="chip-grid">
              {TIRE_SOURCES.map((s) => (
                <button key={s} className={'chip' + (tireSource === s ? ' active' : '')}
                  onClick={() => set('tireSource', s as TireSource)} type="button">{s}</button>
              ))}
            </div>
          </div>

          {tireSource === 'Inventory' && job.tireSize && (
            <div className="info-banner" style={{ marginTop: 8 }}>
              {matchingInventoryCount > 0
                ? `${matchingInventoryCount} on hand · ${inventoryPlan?.shortfall ? `short ${inventoryPlan.shortfall}` : 'in stock'}`
                : 'No matching size on hand — consider switching tire source'}
            </div>
          )}

          {tireSource === 'Bought for this job' && (
            <div className="purchase-panel card-anim">
              <div className="form-group-title" style={{ color: 'var(--brand-primary)' }}>Purchase Details</div>
              <div className="field-row">
                <div className="field">
                  <label>Vendor</label>
                  <input value={job.tireVendor || ''} onChange={(e) => set('tireVendor', e.target.value)} placeholder="Discount Tire" />
                </div>
                <div className="field">
                  <label>Purchase price ($)</label>
                  <NumberField
                    value={job.tirePurchasePrice || 0}
                    onChange={(n) => set('tirePurchasePrice', n)}
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Condition</label>
                  <select value={job.tireCondition || ''} onChange={(e) => set('tireCondition', e.target.value as 'New' | 'Used' | '')}>
                    <option value="">Select…</option>
                    <option value="New">New</option>
                    <option value="Used">Used</option>
                  </select>
                </div>
                <div className="field">
                  <label>Brand</label>
                  <input value={job.tireBrand || ''} onChange={(e) => set('tireBrand', e.target.value)} placeholder="Michelin" />
                </div>
              </div>
              <div className="field">
                <label>Receipt</label>
                <input ref={receiptInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleReceipt(f); if (receiptInputRef.current) receiptInputRef.current.value = ''; }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button type="button" className="btn sm secondary" onClick={() => receiptInputRef.current?.click()} disabled={receiptUploading}>
                    {receiptUploading ? 'Uploading…' : job.tireReceiptUrl ? 'Replace receipt' : 'Upload receipt'}
                  </button>
                  {job.tireReceiptUrl ? (
                    <a href={job.tireReceiptUrl} target="_blank" rel="noopener noreferrer" className="receipt-thumb">View ↗</a>
                  ) : null}
                </div>
              </div>
              <div className="field">
                <label>Notes (optional)</label>
                <textarea value={job.tireNotes || ''} onChange={(e) => set('tireNotes', e.target.value)} placeholder="Tread depth, condition notes…" />
              </div>
            </div>
          )}

          {tireSource === 'Customer supplied' && (
            <div className="info-banner" style={{ marginTop: 8 }}>
              Tires provided by customer · tire cost is $0 (not deducted from profit)
            </div>
          )}
        </div>
      )}

      <div className="form-group card-anim">
        <div className="form-group-title">Job & Travel</div>
        <div className="field-row">
          <div className="field">
            <label>Miles to job</label>
            <NumberField
              value={job.miles}
              onChange={(n) => set('miles', n)}
              placeholder="0"
            />
          </div>
          <div className="field">
            <label>Material $</label>
            <NumberField
              value={job.materialCost}
              onChange={(n) => set('materialCost', n)}
              placeholder="0"
            />
          </div>
        </div>
        <div className="field" style={{ marginTop: 6 }}>
          <label>Surcharges</label>
          <div className="chip-grid">
            {([
              ['emergency', '🚨 Emergency'],
              ['lateNight', '🌙 Late Night'],
              ['highway', '🛣 Highway'],
              ['weekend', '📅 Weekend'],
            ] as const).map(([k, l]) => (
              <button key={k} type="button" className={'chip' + (job[k] ? ' active' : '')} onClick={() => set(k, !job[k])}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="form-group card-anim">
        <div className="form-group-title">Lead & Payment</div>
        <div className="field">
          <label>Lead source</label>
          <div className="chip-grid">
            {LEAD_SOURCES.map((s) => (
              <button key={s} type="button" className={'chip' + (job.source === s ? ' active' : '')} onClick={() => set('source', s)}>{s}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Payment method</label>
          <div className="chip-grid">
            {PAYMENT_METHODS.map((p) => (
              <button key={p} type="button" className={'chip' + (job.payment === p ? ' active' : '')} onClick={() => set('payment', p)}>{p}</button>
            ))}
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Job status</label>
            <select value={job.status} onChange={(e) => set('status', e.target.value as Job['status'])}>
              <option value="Completed">Completed</option>
              <option value="Pending">Pending</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
          <div className="field">
            <label>Payment status</label>
            <select value={job.paymentStatus} onChange={(e) => set('paymentStatus', e.target.value as Job['paymentStatus'])}>
              {PAYMENT_STATUSES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="form-group card-anim">
        <div className="form-group-title">Revenue</div>
        <div className="field">
          <label>Revenue charged ($)</label>
          <NumberField
            value={job.revenue}
            onChange={(n) => set('revenue', n)}
            placeholder="0"
            selectOnFocus
          />
        </div>
        <div className="field">
          <label>Note (optional)</label>
          <textarea value={job.note} onChange={(e) => set('note', e.target.value)} placeholder="Any special details…" />
        </div>

        <div className="pricing-breakdown">
          <div className="pricing-breakdown-row"><span>Revenue</span><span className="num green">{money(breakdown.revenue)}</span></div>
          <div className="pricing-breakdown-row"><span>Tire cost</span><span className="num red">-{money(breakdown.tireCost)}</span></div>
          <div className="pricing-breakdown-row"><span>Material cost</span><span className="num red">-{money(breakdown.materialCost)}</span></div>
          <div className="pricing-breakdown-row">
            <span>Travel ({breakdown.travelMiles} mi{breakdown.freeMilesIncluded ? `, ${breakdown.freeMilesIncluded} free` : ''})</span>
            <span className="num red">-{money(breakdown.travelCost)}</span>
          </div>
          <div className="pricing-breakdown-row total">
            <span>Profit</span>
            <span className={'num ' + (breakdown.profit >= 0 ? 'green' : 'red')}>{money(breakdown.profit)}</span>
          </div>
        </div>
      </div>

      <div className="save-footer-spacer" />
      <div className="save-footer">
        <div className="save-footer-inner">
          <div className="save-footer-meta">
            <div className="save-footer-label">Profit</div>
            <div className={'save-footer-value ' + (breakdown.profit >= 0 ? 'green' : 'red')}>{money(breakdown.profit)}</div>
          </div>
          {!isEditing && (
            <button className="btn secondary" onClick={() => void onSaveAndNew()}>＋ Another</button>
          )}
          <button className="btn primary" onClick={() => void onSave()}>
            {isEditing ? 'Update Job' : 'Save Job'}
          </button>
        </div>
      </div>
    </div>
  );
}
