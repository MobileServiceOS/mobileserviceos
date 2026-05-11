import { useEffect, useMemo, useRef, useState } from 'react';
import type { Job, Settings, InventoryItem, TireSource } from '@/types';
import {
  DEFAULT_SERVICE_PRICING, DEFAULT_VEHICLE_PRICING,
  LEAD_SOURCES, PAYMENT_METHODS, PAYMENT_STATUSES, TIRE_MATERIAL_SERVICES, TIRE_SOURCES,
} from '@/lib/defaults';
import { computeBreakdown } from '@/lib/pricing';
import { calcQuote, money, normalizeTireSize, planInventoryDeduction, r2, serviceIcon } from '@/lib/utils';
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

/**
 * AddJob — pricing-first layout.
 *
 * Top card "Pricing" contains the complete set of inputs that affect the
 * quote (service, vehicle, miles, tire cost, material cost, qty, surcharges)
 * alongside the live Suggested/Premium price tiles, breakdown, and Start Job
 * CTA. Everything else (customer details, tire source/details, lead/payment,
 * notes) lives below as data-entry that doesn't affect price.
 *
 * Key behaviors:
 *   • Tire cost field is hidden for Flat Repair / TPMS / Rotation unless the
 *     operator explicitly opts in via "+ Add tire cost"
 *   • Revenue auto-fills from Suggested price unless manually overridden
 *   • Once Revenue is manually edited, auto-fill stops until the user taps
 *     a price tile to re-engage it
 *   • Confirm Revenue & Profit section at the bottom shows actual profit
 *     against whatever revenue the user committed to
 */
export function AddJob({ job, setJob, settings, inventory, isEditing, prefilledFromQuote, onSave, onSaveAndNew }: Props) {
  const { businessId, brand } = useBrand();

  const enabledServices = useMemo(() => {
    const sp = settings.servicePricing || DEFAULT_SERVICE_PRICING;
    return Object.keys(sp).filter((k) => sp[k] && sp[k].enabled !== false);
  }, [settings.servicePricing]);

  const vehicles = useMemo(
    () => Object.keys(settings.vehiclePricing || DEFAULT_VEHICLE_PRICING),
    [settings.vehiclePricing]
  );

  const set = <K extends keyof Job>(k: K, v: Job[K]) => setJob({ ...job, [k]: v });

  const needsTireDetails = TIRE_MATERIAL_SERVICES.includes(job.service);
  const tireSource = (job.tireSource || 'Inventory') as TireSource;

  // Services where tire cost is irrelevant by default. Operators can still
  // opt in if a flat repair turns into a replacement mid-job.
  const tireCostRelevantByDefault = (svc: string) =>
    svc !== 'Flat Tire Repair' && svc !== 'Tire Rotation' && svc !== 'TPMS Service';
  const [showTireCost, setShowTireCost] = useState<boolean>(tireCostRelevantByDefault(job.service));
  useEffect(() => {
    const shouldShow = tireCostRelevantByDefault(job.service);
    setShowTireCost(shouldShow);
    if (!shouldShow && Number(job.tireCost || 0) > 0) {
      set('tireCost', 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.service]);

  // Live quote — drives the price tiles, breakdown, and the auto-filled
  // Revenue value below.
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

  // Revenue lock — once the user types a custom revenue, stop auto-filling
  // until they tap a price tile to re-engage. This is the right call when
  // people are negotiating on-site and want to lock a price.
  const revenueLockedRef = useRef<boolean>(Boolean(isEditing && job.revenue));

  const onRevenueChange = (value: string) => {
    revenueLockedRef.current = true;
    set('revenue', value);
  };

  // Auto-fill revenue from the live quote when the user hasn't overridden.
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
    revenueLockedRef.current = false;
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

  // Travel cost computed locally for the breakdown row (calcQuote folds it
  // into directCosts internally, so we recompute it here for display).
  const travelCostDisplay = useMemo(() => {
    const miles = Number(job.miles) || 0;
    const freeMiles = Number(settings.freeMilesIncluded || 0);
    const chargeable = Math.max(0, miles - freeMiles);
    return r2(chargeable * Number(settings.costPerMile || 0.65));
  }, [job.miles, settings.freeMilesIncluded, settings.costPerMile]);

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

  const surchargeChips = [
    { key: 'emergency', label: '🚨 Emergency' },
    { key: 'lateNight', label: '🌙 Late Night' },
    { key: 'highway', label: '🛣 Highway' },
    { key: 'weekend', label: '📅 Weekend' },
  ] as const;

  const activePrice = pricingMode === 'premium' ? quote.premium : quote.suggested;
  const revenueOverridden =
    revenueLockedRef.current && Number(job.revenue || 0) !== activePrice;

  return (
    <div className="page page-enter">
      {prefilledFromQuote && !isEditing && (
        <div className="info-banner card-anim">
          Pre-filled from Quick Quote · Adjust below
        </div>
      )}

      {/* ════════════════════════════════════════════════════════
           PRICING CARD — top of the page, contains everything
           that affects price. Operators can quote a job from
           this card alone without scrolling.
          ════════════════════════════════════════════════════════ */}
      <div className="form-group card-anim pricing-summary">
        <div className="form-group-title">Pricing</div>

        {/* Service + Vehicle */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Service</label>
            <select value={job.service} onChange={(e) => set('service', e.target.value)}>
              {enabledServices.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Vehicle</label>
            <select value={job.vehicleType} onChange={(e) => set('vehicleType', e.target.value)}>
              {vehicles.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>

        {/* Numeric inputs row — width adapts to whether tire cost is showing.
            Material is always shown (patches, valve stems, sensors apply to
            every service type). Qty is always shown. Miles always relevant. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: showTireCost ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr',
            gap: 10,
            marginBottom: 10,
          }}
        >
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Miles</label>
            <input
              type="number" inputMode="decimal"
              value={job.miles ?? ''} onChange={(e) => set('miles', e.target.value)}
              placeholder="0"
            />
          </div>
          {showTireCost && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Tire $</label>
              <input
                type="number" inputMode="decimal"
                value={job.tireCost ?? ''} onChange={(e) => set('tireCost', e.target.value)}
                placeholder="0"
              />
            </div>
          )}
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Material $</label>
            <input
              type="number" inputMode="decimal"
              value={job.materialCost ?? ''} onChange={(e) => set('materialCost', e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Qty</label>
            <input
              type="number" inputMode="numeric"
              value={job.qty ?? ''} onChange={(e) => set('qty', e.target.value)}
              placeholder="1"
            />
          </div>
        </div>

        {/* Inline opt-in for tire cost on services where it's normally hidden */}
        {!showTireCost && (
          <button
            type="button"
            className="qq-tire-toggle"
            onClick={() => setShowTireCost(true)}
          >
            + Add tire cost
          </button>
        )}

        {/* Surcharge chips */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {surchargeChips.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={'chip sm' + (job[key] ? ' active' : '')}
              onClick={() => set(key, !job[key])}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Suggested / Premium tiles */}
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

        {/* Clean stacked breakdown — one row per component */}
        <div className="qq-breakdown">
          {showTireCost && (
            <div className="qq-breakdown-row">
              <span>Tire cost{Number(job.qty || 0) > 1 ? ` (× ${job.qty})` : ''}</span>
              <span className="num">{money(Number(job.tireCost || 0) * Number(job.qty || 1))}</span>
            </div>
          )}
          <div className="qq-breakdown-row">
            <span>Material cost</span>
            <span className="num">{money(Number(job.materialCost || 0))}</span>
          </div>
          <div className="qq-breakdown-row">
            <span>
              Travel ({Number(job.miles) || 0} mi
              {Number(settings.freeMilesIncluded || 0) ? `, ${settings.freeMilesIncluded} free` : ''})
            </span>
            <span className="num">{money(travelCostDisplay)}</span>
          </div>
          <div className="qq-breakdown-row">
            <span>Target profit</span>
            <span className="num green">{money(quote.targetProfit)}</span>
          </div>
          <div className="qq-breakdown-row total">
            <span>Suggested price</span>
            <span className="num">{money(activePrice)}</span>
          </div>
        </div>

        <button
          type="button"
          className="cta-btn press-scale qq-cta"
          onClick={() => acceptPrice(pricingMode)}
        >
          Start Job at {money(activePrice)} →
        </button>

        {revenueOverridden && (
          <div className="pricing-override-note">
            Revenue manually set to {money(job.revenue)} · tap a price tile to reset
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════
           CUSTOMER — data only, doesn't affect price
          ════════════════════════════════════════════════════════ */}
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

      {/* ════════════════════════════════════════════════════════
           TIRE DETAILS — size + source (data only, tire $ is in
           the Pricing card above)
          ════════════════════════════════════════════════════════ */}
      {needsTireDetails && (
        <div className="form-group card-anim">
          <div className="form-group-title">Tire Details</div>
          <div className="field">
            <label>Size</label>
            <input value={job.tireSize} onChange={(e) => set('tireSize', e.target.value)} placeholder="225/65R17" />
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

      {/* ════════════════════════════════════════════════════════
           LEAD & PAYMENT — administrative, no pricing impact
          ════════════════════════════════════════════════════════ */}
      <div className="form-group card-anim">
        <div className="form-group-title">Lead &amp; Payment</div>
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

      {/* ════════════════════════════════════════════════════════
           CONFIRM REVENUE & PROFIT — final commit, shows actual
           profit based on whatever revenue the user committed to.
          ════════════════════════════════════════════════════════ */}
      <div className="form-group card-anim">
        <div className="form-group-title">Confirm Revenue &amp; Profit</div>
        <div className="field">
          <label>Revenue charged ($)</label>
          <input
            type="number" inputMode="decimal"
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
          <div className="pricing-breakdown-row">
            <span>Tire cost{breakdown.quantity > 1 ? ` · ${breakdown.quantity} tires` : ''}</span>
            <span className="num red">-{money(breakdown.tireCost)}</span>
          </div>
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
