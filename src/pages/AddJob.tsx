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

/**
 * AddJob — refactored for pricing-first field workflow.
 *
 * New order: Service → Vehicle → Pricing Card → Tire/Inventory →
 * Customer → Payment → Save → Advanced (collapsed).
 *
 * The big change is the Pricing Card. After a tech picks service + vehicle
 * the price snaps into place immediately, with a Suggested and Premium
 * option presented side by side. Inventory check appears right under it.
 * Customer details live below pricing because techs quote first, collect
 * details second. Rarely-touched fields (vendor/receipt, status overrides,
 * surcharges, notes) live in a collapsible Advanced section so they're
 * out of the critical path.
 *
 * The pricing engine itself is untouched. All change is presentation +
 * input order. No new fields added to the Job schema.
 */
export function AddJob({
  job, setJob, settings, inventory, isEditing, prefilledFromQuote, onSave, onSaveAndNew,
}: Props) {
  const { businessId, brand } = useBrand();

  const enabledServices = useMemo(() => {
    const sp = settings.servicePricing || DEFAULT_SERVICE_PRICING;
    return Object.keys(sp).filter((k) => sp[k] && sp[k].enabled !== false);
  }, [settings.servicePricing]);

  const vehicles = useMemo(() => Object.keys(settings.vehiclePricing || DEFAULT_VEHICLE_PRICING), [settings.vehiclePricing]);

  const set = <K extends keyof Job>(k: K, v: Job[K]) => setJob({ ...job, [k]: v });

  const needsTireDetails = TIRE_MATERIAL_SERVICES.includes(job.service);
  const tireSource = (job.tireSource || 'Inventory') as TireSource;

  // Live quote — re-runs when any price-affecting input changes. Used for
  // the Suggested vs Premium chips in the pricing card.
  const quote = useMemo(() => calcQuote({
    service: job.service,
    vehicleType: job.vehicleType,
    miles: job.miles,
    tireCost: job.tireCost,
    materialCost: job.materialCost,
    qty: job.qty,
    emergency: job.emergency,
    lateNight: job.lateNight,
    highway: job.highway,
    weekend: job.weekend,
  }, settings), [
    job.service, job.vehicleType, job.miles, job.tireCost, job.materialCost,
    job.qty, job.emergency, job.lateNight, job.highway, job.weekend, settings,
  ]);

  // Auto-prefill revenue with Suggested whenever inputs change AND the user
  // hasn't manually overridden it. We track manual override via a ref that
  // flips true the first time the user types into the revenue field directly.
  const userOverrodeRevenueRef = useRef(false);
  const lastAutoAppliedRef = useRef<number | null>(null);

  useEffect(() => {
    // Skip when editing existing jobs (the saved revenue is authoritative).
    if (isEditing) return;
    if (userOverrodeRevenueRef.current) return;
    if (!job.service || !job.vehicleType) return;
    if (quote.suggested <= 0) return;

    // Only auto-apply if revenue is blank/zero OR matches the last value
    // we auto-applied (i.e. the user hasn't manually touched it since).
    const currentRev = Number(job.revenue || 0);
    if (currentRev === 0 || currentRev === lastAutoAppliedRef.current) {
      lastAutoAppliedRef.current = quote.suggested;
      setJob({ ...job, revenue: quote.suggested });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    job.service, job.vehicleType, job.miles, job.tireCost, job.materialCost,
    job.qty, job.emergency, job.lateNight, job.highway, job.weekend,
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

  // Advanced section collapsed by default — most jobs don't need it.
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Revenue field handler that flips the userOverrode flag the first time
  // the user actually types a different number.
  const onRevenueChange = (n: number) => {
    if (n !== lastAutoAppliedRef.current) {
      userOverrodeRevenueRef.current = true;
    }
    set('revenue', n);
  };

  // Pricing card derived values
  const suggested = Math.max(0, Number(quote.suggested || 0));
  const premium = Math.max(suggested, Number(quote.premium || 0));
  const charged = Number(job.revenue || 0);
  const profit = Number(breakdown.profit || 0);
  const totalCost = Math.max(0, charged - profit);

  // Save CTA — shows the actual charged amount when known.
  const saveLabel = (() => {
    if (charged > 0) return `${isEditing ? 'Update' : 'Save'} ${money(charged)} Job`;
    return isEditing ? 'Update Job' : 'Save Job';
  })();

  // Selected price tier — Suggested vs Premium. Compared to current revenue
  // to highlight which preset is active. Falls back to neither when the
  // tech has typed a custom number.
  const selectedTier: 'suggested' | 'premium' | 'custom' = (() => {
    if (Math.abs(charged - premium) < 0.01) return 'premium';
    if (Math.abs(charged - suggested) < 0.01) return 'suggested';
    return 'custom';
  })();

  const applyTier = (tier: 'suggested' | 'premium') => {
    const next = tier === 'premium' ? premium : suggested;
    userOverrodeRevenueRef.current = false; // re-enable auto-tracking
    lastAutoAppliedRef.current = next;
    set('revenue', next);
  };

  return (
    <div className="page page-enter">
      {prefilledFromQuote && !isEditing && (
        <div className="info-banner card-anim">
          Pre-filled from Quick Quote · Adjust details below
        </div>
      )}

      {/* ─── 1. Service ─────────────────────────────────────────── */}
      <div className="form-group card-anim">
        <div className="form-group-title">Service</div>
        <div className="chip-grid">
          {enabledServices.map((s) => (
            <button
              key={s}
              type="button"
              className={'chip' + (job.service === s ? ' active' : '')}
              onClick={() => set('service', s)}
            >
              {serviceIcon(s)} {s}
            </button>
          ))}
        </div>
      </div>

      {/* ─── 2. Vehicle ─────────────────────────────────────────── */}
      <div className="form-group card-anim">
        <div className="form-group-title">Vehicle</div>
        <div className="chip-grid">
          {vehicles.map((v) => (
            <button
              key={v}
              type="button"
              className={'chip' + (job.vehicleType === v ? ' active' : '')}
              onClick={() => set('vehicleType', v)}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* ─── 3. Pricing Card — DOMINANT ─────────────────────────── */}
      {/*
       *  Three big stats: Suggested, Cost, Profit.
       *  Premium tier shown as a tappable upsell pill.
       *  Charged amount lives in a hero block under the stats with a big
       *  editable NumberField so manual override is one tap away.
       */}
      <div
        className="form-group card-anim"
        style={{
          background: 'linear-gradient(180deg, var(--s2) 0%, var(--s1) 100%)',
          border: '1px solid var(--border)',
          padding: 16,
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 10,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 800, letterSpacing: '1.5px',
            textTransform: 'uppercase', color: 'var(--brand-primary)',
          }}>
            💰 Revenue & Pricing
          </div>
          <div style={{ fontSize: 10, color: 'var(--t3)' }}>
            {job.service && job.vehicleType ? 'Auto-calculated' : 'Pick service & vehicle'}
          </div>
        </div>

        {/* Top row: 3 stat cards — Suggested, Cost, Profit */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
          marginBottom: 10,
        }}>
          <PricingStat label="Suggested" value={money(suggested)} tone="primary" />
          <PricingStat label="Cost" value={money(totalCost)} tone="muted" />
          <PricingStat
            label="Profit"
            value={money(profit)}
            tone={profit >= 0 ? 'green' : 'red'}
          />
        </div>

        {/* Premium upsell pill — only when premium is meaningfully higher
            than suggested (avoid showing redundant identical numbers). */}
        {premium > suggested + 0.5 && (
          <button
            type="button"
            onClick={() => applyTier('premium')}
            style={{
              width: '100%',
              padding: '10px 14px',
              marginBottom: 10,
              background: selectedTier === 'premium'
                ? 'linear-gradient(135deg, var(--brand-primary) 0%, var(--brand-accent, #e5c770) 100%)'
                : 'rgba(200,164,74,.08)',
              border: '1px solid rgba(200,164,74,.35)',
              borderRadius: 10,
              color: selectedTier === 'premium' ? '#000' : 'var(--brand-primary)',
              fontSize: 13,
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>⭐ Premium price</span>
            <span>{money(premium)}</span>
          </button>
        )}

        {/* Suggested tier explicit button — appears when user has overridden
            to a custom value, so they can snap back. */}
        {selectedTier === 'custom' && suggested > 0 && (
          <button
            type="button"
            onClick={() => applyTier('suggested')}
            style={{
              width: '100%',
              padding: '8px 12px',
              marginBottom: 10,
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--t2)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            ↺ Snap back to Suggested ({money(suggested)})
          </button>
        )}

        {/* Charged amount — hero, big, editable */}
        <div style={{
          padding: '14px 16px',
          background: 'var(--s3)',
          borderRadius: 12,
          border: '2px solid var(--brand-primary)',
        }}>
          <div style={{
            fontSize: 10, fontWeight: 800, letterSpacing: '1.5px',
            textTransform: 'uppercase', color: 'var(--t3)', marginBottom: 4,
          }}>
            Charging customer
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 26, fontWeight: 900, color: 'var(--brand-primary)' }}>$</span>
            <NumberField
              value={job.revenue}
              onChange={onRevenueChange}
              placeholder="0"
              style={{
                fontSize: 32,
                fontWeight: 900,
                color: 'var(--t1)',
                background: 'transparent',
                border: 'none',
                padding: 0,
                width: '100%',
                outline: 'none',
              }}
              selectOnFocus
            />
          </div>
        </div>
      </div>

      {/* ─── 4. Tire Size + Inventory ─────────────────────────── */}
      {needsTireDetails && (
        <div className="form-group card-anim">
          <div className="form-group-title">Tire & Inventory</div>
          <div className="field-row">
            <div className="field">
              <label>Size</label>
              <input
                value={job.tireSize}
                onChange={(e) => set('tireSize', e.target.value)}
                placeholder="225/65R17"
              />
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
                <button
                  key={s}
                  type="button"
                  className={'chip' + (tireSource === s ? ' active' : '')}
                  onClick={() => set('tireSource', s as TireSource)}
                >{s}</button>
              ))}
            </div>
          </div>

          {/* Inventory availability — color-coded badge so the tech can
              scan at a glance whether they're covered. */}
          {tireSource === 'Inventory' && job.tireSize && (() => {
            const reqQty = Number(job.qty || 1);
            const shortfall = inventoryPlan?.shortfall ?? 0;
            const matched = matchingInventoryCount;
            let tone: 'red' | 'amber' | 'green' = 'green';
            let label = '';
            if (matched === 0) {
              tone = 'red';
              label = 'No matching size on hand';
            } else if (shortfall > 0) {
              tone = 'red';
              label = `Only ${matched} on hand, need ${reqQty}. Short ${shortfall}.`;
            } else if (matched === reqQty) {
              tone = 'amber';
              label = `IN STOCK · Using all ${matched} · 0 left after`;
            } else {
              tone = 'green';
              label = `IN STOCK · Qty ${matched} · ${matched - reqQty} left after`;
            }
            const colors = {
              red:   { bg: 'rgba(239,68,68,.08)',  border: 'rgba(239,68,68,.35)',  txt: 'var(--red)'   },
              amber: { bg: 'rgba(245,158,11,.08)', border: 'rgba(245,158,11,.35)', txt: 'var(--amber)' },
              green: { bg: 'rgba(34,197,94,.08)',  border: 'rgba(34,197,94,.30)',  txt: 'var(--green)' },
            }[tone];
            return (
              <div style={{
                marginTop: 8,
                padding: '10px 12px',
                background: colors.bg,
                border: `1px solid ${colors.border}`,
                borderRadius: 10,
                fontSize: 12,
                color: colors.txt,
                fontWeight: 700,
              }}>
                {tone === 'red' ? '⚠ ' : tone === 'amber' ? '⚡ ' : '✓ '}
                {label}
              </div>
            );
          })()}

          {tireSource === 'Customer supplied' && (
            <div className="info-banner" style={{ marginTop: 8 }}>
              Tires provided by customer · tire cost is $0
            </div>
          )}

          {/* Bought-for-this-job inline purchase price entry. Vendor +
              receipt + brand are pushed to Advanced so the critical path
              is just "what did the tire cost". */}
          {tireSource === 'Bought for this job' && (
            <div className="field" style={{ marginTop: 8 }}>
              <label>Purchase price ($)</label>
              <NumberField
                value={job.tirePurchasePrice || ''}
                onChange={(n) => set('tirePurchasePrice', n)}
                placeholder="0"
              />
              <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
                Vendor, condition, and receipt upload available in Advanced section below.
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── 5. Customer ──────────────────────────────────────── */}
      <div className="form-group card-anim">
        <div className="form-group-title">Customer</div>
        <div className="field">
          <label>Name</label>
          <input
            value={job.customerName}
            onChange={(e) => set('customerName', e.target.value)}
            placeholder="John Smith"
          />
        </div>
        <div className="field">
          <label>Phone</label>
          <input
            type="tel"
            value={job.customerPhone}
            onChange={(e) => set('customerPhone', e.target.value)}
            placeholder="555-555-5555"
          />
        </div>
        <CityStateSelect
          state={job.state || ''}
          city={job.city || ''}
          onChange={({ city, state, fullLocationLabel }) =>
            setJob({ ...job, city, state, fullLocationLabel, area: fullLocationLabel || job.area })
          }
        />
      </div>

      {/* ─── 6. Payment ───────────────────────────────────────── */}
      <div className="form-group card-anim">
        <div className="form-group-title">Payment</div>
        <div className="field">
          <label>Payment method</label>
          <div className="chip-grid">
            {PAYMENT_METHODS.map((p) => (
              <button
                key={p}
                type="button"
                className={'chip' + (job.payment === p ? ' active' : '')}
                onClick={() => set('payment', p)}
              >{p}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Payment status</label>
          <select
            value={job.paymentStatus}
            onChange={(e) => set('paymentStatus', e.target.value as Job['paymentStatus'])}
          >
            {PAYMENT_STATUSES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {/* ─── 7. Advanced (collapsed) ──────────────────────────── */}
      {/*
       *  Surcharges, miles, materials, lead source, status overrides,
       *  notes, and bought-for-this-job vendor/receipt details. All
       *  things the tech rarely touches in the field — but available
       *  when needed.
       */}
      <div className="form-group card-anim" style={{ padding: 0, overflow: 'hidden' }}>
        <button
          type="button"
          onClick={() => setAdvancedOpen(!advancedOpen)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            width: '100%', padding: '14px 16px',
            background: 'transparent', border: 'none',
            color: 'var(--t2)', fontSize: 13, fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          <span>⚙ Advanced (miles, surcharges, lead, notes)</span>
          <span style={{
            transition: 'transform .2s ease',
            transform: advancedOpen ? 'rotate(90deg)' : 'rotate(0deg)',
          }}>▸</span>
        </button>
        {advancedOpen && (
          <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--border2)' }}>
            <div style={{ marginTop: 14 }}>
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

              <div className="field">
                <label>Surcharges</label>
                <div className="chip-grid">
                  {([
                    ['emergency', '🚨 Emergency'],
                    ['lateNight', '🌙 Late Night'],
                    ['highway', '🛣 Highway'],
                    ['weekend', '📅 Weekend'],
                  ] as const).map(([k, l]) => (
                    <button
                      key={k}
                      type="button"
                      className={'chip' + (job[k] ? ' active' : '')}
                      onClick={() => set(k, !job[k])}
                    >{l}</button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Lead source</label>
                <div className="chip-grid">
                  {LEAD_SOURCES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={'chip' + (job.source === s ? ' active' : '')}
                      onClick={() => set('source', s)}
                    >{s}</button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label>Job status</label>
                <select
                  value={job.status}
                  onChange={(e) => set('status', e.target.value as Job['status'])}
                >
                  <option value="Completed">Completed</option>
                  <option value="Pending">Pending</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </div>

              <div className="field">
                <label>Note (optional)</label>
                <textarea
                  value={job.note}
                  onChange={(e) => set('note', e.target.value)}
                  placeholder="Any special details…"
                />
              </div>

              {/* Bought-for-this-job vendor/receipt details. Only render
                  when the tire source warrants it. */}
              {needsTireDetails && tireSource === 'Bought for this job' && (
                <div className="purchase-panel card-anim" style={{ marginTop: 10 }}>
                  <div className="form-group-title" style={{ color: 'var(--brand-primary)' }}>
                    Tire Purchase Details
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label>Vendor</label>
                      <input
                        value={job.tireVendor || ''}
                        onChange={(e) => set('tireVendor', e.target.value)}
                        placeholder="Discount Tire"
                      />
                    </div>
                    <div className="field">
                      <label>Condition</label>
                      <select
                        value={job.tireCondition || ''}
                        onChange={(e) => set('tireCondition', e.target.value as 'New' | 'Used' | '')}
                      >
                        <option value="">Select…</option>
                        <option value="New">New</option>
                        <option value="Used">Used</option>
                      </select>
                    </div>
                  </div>
                  <div className="field">
                    <label>Brand</label>
                    <input
                      value={job.tireBrand || ''}
                      onChange={(e) => set('tireBrand', e.target.value)}
                      placeholder="Michelin"
                    />
                  </div>
                  <div className="field">
                    <label>Receipt</label>
                    <input
                      ref={receiptInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleReceipt(f);
                        if (receiptInputRef.current) receiptInputRef.current.value = '';
                      }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <button
                        type="button"
                        className="btn sm secondary"
                        onClick={() => receiptInputRef.current?.click()}
                        disabled={receiptUploading}
                      >
                        {receiptUploading ? 'Uploading…' : job.tireReceiptUrl ? 'Replace receipt' : 'Upload receipt'}
                      </button>
                      {job.tireReceiptUrl ? (
                        <a
                          href={job.tireReceiptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="receipt-thumb"
                        >View ↗</a>
                      ) : null}
                    </div>
                  </div>
                  <div className="field">
                    <label>Tire notes</label>
                    <textarea
                      value={job.tireNotes || ''}
                      onChange={(e) => set('tireNotes', e.target.value)}
                      placeholder="Tread depth, condition notes…"
                    />
                  </div>
                </div>
              )}

              {/* Internal pricing breakdown — useful for diagnosing weird
                  numbers. Owners look here, techs ignore it. */}
              <div className="pricing-breakdown" style={{ marginTop: 10 }}>
                <div className="pricing-breakdown-row">
                  <span>Revenue</span>
                  <span className="num green">{money(breakdown.revenue)}</span>
                </div>
                <div className="pricing-breakdown-row">
                  <span>Tire cost</span>
                  <span className="num red">-{money(breakdown.tireCost)}</span>
                </div>
                <div className="pricing-breakdown-row">
                  <span>Material cost</span>
                  <span className="num red">-{money(breakdown.materialCost)}</span>
                </div>
                <div className="pricing-breakdown-row">
                  <span>
                    Travel ({breakdown.travelMiles} mi
                    {breakdown.freeMilesIncluded ? `, ${breakdown.freeMilesIncluded} free` : ''})
                  </span>
                  <span className="num red">-{money(breakdown.travelCost)}</span>
                </div>
                <div className="pricing-breakdown-row total">
                  <span>Profit</span>
                  <span className={'num ' + (breakdown.profit >= 0 ? 'green' : 'red')}>
                    {money(breakdown.profit)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Save footer — sticky, dynamic CTA ─────────────────── */}
      <div className="save-footer-spacer" />
      <div className="save-footer">
        <div className="save-footer-inner">
          <div className="save-footer-meta">
            <div className="save-footer-label">Profit</div>
            <div className={'save-footer-value ' + (profit >= 0 ? 'green' : 'red')}>
              {money(profit)}
            </div>
          </div>
          {!isEditing && (
            <button className="btn secondary" onClick={() => void onSaveAndNew()}>＋ Another</button>
          )}
          <button className="btn primary" onClick={() => void onSave()}>
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Single stat card in the pricing hero. Three live side-by-side in the
 * pricing card top row. Tones tune the value color so the eye lands on
 * Suggested first (primary/gold), then Profit (green or red), then Cost
 * (subdued gray).
 */
function PricingStat({
  label, value, tone,
}: {
  label: string;
  value: string;
  tone: 'primary' | 'green' | 'red' | 'muted';
}) {
  const valueColor = tone === 'primary' ? 'var(--brand-primary)'
    : tone === 'green' ? 'var(--green)'
    : tone === 'red' ? 'var(--red)'
    : 'var(--t2)';

  return (
    <div style={{
      padding: '10px 8px',
      background: 'var(--s3)',
      border: '1px solid var(--border2)',
      borderRadius: 10,
      textAlign: 'center',
      minHeight: 64,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
    }}>
      <div style={{
        fontSize: 9, fontWeight: 800,
        textTransform: 'uppercase', letterSpacing: '1px',
        color: 'var(--t3)', marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 17, fontWeight: 900, color: valueColor,
        lineHeight: 1.1,
      }}>
        {value}
      </div>
    </div>
  );
}
