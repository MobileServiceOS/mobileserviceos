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

  // Live quote that updates with every relevant change. This drives both the
  // pricing summary at the top and the suggested-price auto-fill below.
  const quote = useMemo(
    () => calcQuote({
      service: job.service, vehicleType: job.vehicleType,
      miles: job.miles, tireCost: job.tireCost, materialCost: job.materialCost,
      qty: job.qty,
      emergency: job.emergency, lateNight: job.lateNight, highway: job.highway, weekend: job.weekend,
    }, settings),
    [
      job.service, job.vehicleType, job.miles, job.tireCost, job.materialCost,
      job.qty, job.emergency, job.lateNight, job.highway, job.weekend, settings,
    ]
  );

  const [pricingMode, setPricingMode] = useState<'suggested' | 'premium'>('suggested');
  // Track whether the user has manually edited revenue. Once they do, stop
  // auto-filling so we don't blow away their override every time they tweak
  // a chip below.
  const revenueLockedRef = useRef<boolean>(Boolean(isEditing && job.revenue));

  const onRevenueChange = (value: string) => {
    revenueLockedRef.current = true;
    set('revenue', value);
  };

  // Auto-fill revenue from the live quote when the user hasn't overridden it.
  // Runs on every quote change, but is a no-op once the user types a value.
  useEffect(() => {
    if (isEditing) return;
    if (revenueLockedRef.current) return;
    const target = pricingMode === 'premium' ? quote.premium : quote.suggested;
    if (Number(job.revenue || 0) !== target) {
      set('revenue', target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote.suggested, quote.premium, pricingMode]);

  const acceptPrice = (mode: 'suggested' | 'premium') => {
    setPricingMode(mode);
    revenueLockedRef.current = false; // re-engage auto-fill at the new price
    const target = mode === 'premium' ? quote.premium : quote.suggested;
    set('revenue', target);
  };

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

      {/* ── Pricing summary — always first so the operator can see the
            suggested/premium price and target profit before filling out
            any details. Updates live as Service / Vehicle / Miles / Tire
            cost change below. ───────────────────────────────────────── */}
      <div className="form-group card-anim pricing-summary">
        <div className="form-group-title">Pricing</div>
        <div className="qq-pricing-row">
          <div
            className={'qq-price-tile' + (pricingMode === 'suggested' ? ' active' : '')}
            onClick={() => acceptPrice('suggested')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && acceptPrice('suggested')}
          >
            <div className="qq-price-tile-label">Suggested</div>
            <div className="qq-price-tile-amount">{money(quote.suggested)}</div>
          </div>
          <div
            className={'qq-price-tile premium' + (pricingMode === 'premium' ? ' active' : '')}
            onClick={() => acceptPrice('premium')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && acceptPrice('premium')}
          >
            <div className="qq-price-tile-label">Premium</div>
            <div className="qq-price-tile-amount">{money(quote.premium)}</div>
          </div>
        </div>

        <div className="pricing-mini-breakdown">
          <div className="pricing-mini-row">
            <span>Direct cost</span>
            <span className="num">{money(quote.directCosts)}</span>
          </div>
          <div className="pricing-mini-row">
            <span>
              Travel ({Number(job.miles || 0)} mi
              {Number(settings.freeMilesIncluded || 0)
                ? `, ${settings.freeMilesIncluded} free`
                : ''})
            </span>
            <span className="num">{money(quote.directCosts - Number(job.tireCost || 0) - Number(job.materialCost || job.miscCost || 0))}</span>
          </div>
          <div className="pricing-mini-row total">
            <span>Target profit</span>
            <span className="num green">{money(quote.targetProfit)}</span>
          </div>
        </div>

        <button
          type="button"
          className="cta-btn press-scale qq-cta"
          onClick={() => acceptPrice(pricingMode)}
        >
          Start Job at {money(pricingMode === 'premium' ? quote.premium : quote.suggested)} →
        </button>

        {revenueLockedRef.current && Number(job.revenue || 0) !== (pricingMode === 'premium' ? quote.premium : quote.suggested) && (
          <div className="pricing-override-note">
            Revenue manually set to {money(job.revenue)} · tap a price tile to reset
          </div>
        )}
      </div>

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
              <input type="number" inputMode="numeric" value={job.qty} onChange={(e) => set('qty', e.target.value)} />
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
                  <input type="number" inputMode="decimal" value={job.tirePurchasePrice || ''} onChange={(e) => set('tirePurchasePrice', e.target.value)} placeholder="0" />
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
            <input type="number" inputMode="decimal" value={job.miles} onChange={(e) => set('miles', e.target.value)} placeholder="0" />
          </div>
          <div className="field">
            <label>Material $</label>
            <input type="number" inputMode="decimal" value={job.materialCost} onChange={(e) => set('materialCost', e.target.value)} placeholder="0" />
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
        <div className="form-group-title">Confirm Revenue &amp; Profit</div>
        <div className="field">
          <label>Revenue charged ($)</label>
          <input
            type="number"
            inputMode="decimal"
            value={job.revenue}
            onChange={(e) => onRevenueChange(e.target.value)}
            placeholder="0"
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
