import { useEffect, useMemo, useRef, useState } from 'react';
import type { Job, Settings, InventoryItem, TireSource } from '@/types';
import {
  DEFAULT_SERVICE_PRICING, DEFAULT_VEHICLE_PRICING,
  LEAD_SOURCES, PAYMENT_METHODS, PAYMENT_STATUSES, JOB_STATUSES, TIRE_MATERIAL_SERVICES, TIRE_SOURCES,
} from '@/lib/defaults';
import { computeBreakdownTagged } from '@/lib/pricing';
import { calcQuote, money, normalizeTireSize, planInventoryDeduction } from '@/lib/utils';
import { addToast } from '@/lib/toast';
import { uploadReceipt } from '@/lib/firebase';
import { availableQty, reservedQty } from '@/lib/inventoryReservations';
import { useBrand } from '@/context/BrandContext';
import { usePermissions } from '@/context/MembershipContext';
import { formatPhone, formatPhonePartial } from '@/lib/formatPhone';
import { searchCities } from '@/lib/locations';
import { useActiveVertical } from '@/lib/useActiveVertical';
import type { BusinessTypeJobField } from '@/config/businessTypes/registry';
import { PartsSection } from '@/components/addJob/PartsSection';
import { AssignmentPicker } from '@/components/addJob/AssignmentPicker';
import { ServicePicker } from '@/components/addJob/ServicePicker';
import { useMembership } from '@/context/MembershipContext';
import { useBusinessMembers } from '@/lib/useBusinessMembers';

// ─── DynamicJobField: shared renderer for vertical.jobFields ──────────
// Renders a single Job field declared by a vertical config. Mechanic
// uses this for labor hours / parts cost / diagnostic code / vehicle
// make / mileage. Tire's jobFields are handled by the bespoke "Tire
// Details" block below (which is feature-flag-gated), so the loop
// that calls DynamicJobField intentionally does not fire for tire.
function DynamicJobField({
  field, value, onChange, disabled,
}: {
  field: BusinessTypeJobField;
  value: unknown;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  switch (field.type) {
    case 'text':
      return (
        <div className="field">
          <label>{field.label}</label>
          <input
            type="text"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder={field.label}
          />
        </div>
      );
    case 'number':
      return (
        <div className="field">
          <label>{field.label}</label>
          <input
            type="number"
            inputMode="decimal"
            value={value === undefined || value === null ? '' : String(value)}
            onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
            disabled={disabled}
            placeholder="0"
          />
        </div>
      );
    case 'select':
      return (
        <div className="field">
          <label>{field.label}</label>
          <select
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
          >
            <option value="">—</option>
            {(field.options || []).map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      );
    case 'boolean':
      return (
        <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            id={`dyn-${field.key}`}
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
          />
          <label htmlFor={`dyn-${field.key}`} style={{ margin: 0 }}>{field.label}</label>
        </div>
      );
  }
}

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
  const permissions = usePermissions();
  // Active vertical drives which fields, services, breakdown panel,
  // and inventory hooks render. For tire (the legacy case) every
  // feature flag the bespoke UI relies on is `true`, so behavior is
  // byte-for-byte identical to pre-Phase-2.1.
  const vertical = useActiveVertical();
  const showTireBlock = vertical.features.inventoryDeduction;
  // Sub-Project B: assignment picker visible only to owner/admin.
  const { role, member } = useMembership();
  const canAssign = role === 'owner' || role === 'admin';
  const currentUid = member?.uid || '';
  const businessMembers = useBusinessMembers();
  // Save-in-progress guard. While a save is mid-flight, the buttons
  // are disabled to prevent a double-tap from creating a duplicate
  // job. Cleared in the finally block of the click handler.
  const [savingMode, setSavingMode] = useState<null | 'save' | 'saveAndNew'>(null);
  const isSaving = savingMode !== null;
  // Revenue lock: when the actor does NOT have canOverrideJobPrice
  // (technician with allowTechnicianPriceOverride === false), the
  // suggested price is used as-is and the input is read-only.
  // Owners + admins always have canOverrideJobPrice via getPermissions.
  // The technician path is conditional on the business-setting flag.
  const revenueLocked = !permissions.canOverrideJobPrice;
  // Service catalog: prefer settings.servicePricing (user-edited
  // prices and enable flags), restricted to services the active
  // vertical defines. Existing tire users have tire services in
  // settings.servicePricing — the intersection equals their current
  // list. Mechanic accounts created via Phase 1 createBusiness have
  // the mechanic catalog seeded into settings.servicePricing.
  const enabledServices = useMemo(() => {
    const sp = settings.servicePricing || DEFAULT_SERVICE_PRICING;
    const verticalServiceIds = new Set(vertical.services.map((s) => s.id));
    return Object.keys(sp).filter((k) => {
      if (!verticalServiceIds.has(k)) return false;
      const entry = sp[k];
      return entry && entry.enabled !== false;
    });
  }, [settings.servicePricing, vertical]);

  // Phase 2.3 detailing: split enabledServices into packages (primary
  // single-select Service chip-grid) vs add-ons (multi-select).
  // Tire / mechanic services don't set `isAddOn`, so enabledPackages
  // === enabledServices and enabledAddOns is empty for them.
  const enabledPackages = useMemo(() => {
    const addOnSet = new Set(
      vertical.services.filter((s) => s.isAddOn).map((s) => s.id),
    );
    return enabledServices.filter((id) => !addOnSet.has(id));
  }, [enabledServices, vertical.services]);
  const enabledAddOns = useMemo(() => {
    const addOnSet = new Set(
      vertical.services.filter((s) => s.isAddOn).map((s) => s.id),
    );
    return enabledServices.filter((id) => addOnSet.has(id));
  }, [enabledServices, vertical.services]);

  // Vehicle-size options from the package_multiplier pricing model
  // (detailing). Empty array for verticals that don't use multipliers.
  const vehicleSizes = useMemo(() => {
    if (vertical.pricingModel.kind !== 'package_multiplier') return [];
    return Object.keys(vertical.pricingModel.vehicleSizeMultipliers);
  }, [vertical.pricingModel]);

  const vehicles = useMemo(() => Object.keys(settings.vehiclePricing || DEFAULT_VEHICLE_PRICING), [settings.vehiclePricing]);

  const set = <K extends keyof Job>(k: K, v: Job[K]) => setJob({ ...job, [k]: v });

  // needsTireDetails: only relevant for verticals with
  // inventoryDeduction. Mechanic / detailing always evaluate to
  // false here, so the tire-details block stays hidden.
  const needsTireDetails = showTireBlock && TIRE_MATERIAL_SERVICES.includes(job.service);
  const tireSource = (job.tireSource || 'Inventory') as TireSource;

  // Pre-populate revenue with suggested when blank and service/vehicle present
  useEffect(() => {
    if (!isEditing && !job.revenue) {
      const q = calcQuote({
        service: job.service, vehicleType: job.vehicleType,
        miles: job.miles, tireCost: job.tireCost, materialCost: job.materialCost,
        qty: job.qty, emergency: job.emergency, lateNight: job.lateNight,
        highway: job.highway, weekend: job.weekend,
        laborHours: job.laborHours, partsCost: job.partsCost,
        diagnosticFee: job.diagnosticFee, vehicleSize: job.vehicleSize,
      }, settings);
      setJob({ ...job, revenue: q.suggested });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.service, job.vehicleType]);

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

  const breakdown = useMemo(() => computeBreakdownTagged(job, settings), [job, settings]);

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

  // City autocomplete state. Uses searchCities() against the brand's
  // home state so a tech in the field gets typeahead suggestions
  // instead of typing the same city name dozens of times a day.
  const [cityOpen, setCityOpen] = useState(false);
  const cityWrapRef = useRef<HTMLDivElement | null>(null);
  const citySuggestions = useMemo(
    () => searchCities(brand.state || '', job.city || '', 6),
    [brand.state, job.city],
  );
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!cityWrapRef.current) return;
      if (!cityWrapRef.current.contains(e.target as Node)) setCityOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  /**
   * Live quote suggestion — same engine as the Dashboard's Quick Quote.
   * Recomputes as the user types miles / tire cost / surcharges so the
   * technician always sees the recommended price WHILE filling the
   * form, not only after saving. When revenue is locked (technician
   * without override), this number IS what gets used. When unlocked,
   * the actor can compare manual vs suggested.
   */
  const liveQuote = useMemo(() => calcQuote({
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
    // Mechanic-vertical inputs: harmless when undefined for tire
    // (the flat quote engine ignores them).
    laborHours: job.laborHours,
    partsCost: job.partsCost,
    diagnosticFee: job.diagnosticFee,
    // Detailing-vertical input; stub engine reads it in 2.3.
    vehicleSize: job.vehicleSize,
  }, settings), [
    job.service, job.vehicleType, job.miles, job.tireCost, job.materialCost,
    job.qty, job.emergency, job.lateNight, job.highway, job.weekend,
    job.laborHours, job.partsCost, job.diagnosticFee, job.vehicleSize,
    settings,
  ]);

  /**
   * Apply the live suggested price to the revenue field. Used by both
   * the "Use suggested" button in the quote preview and the auto-fill
   * effect when a technician toggles surcharges. When revenue is
   * locked, we ALWAYS write the suggested to revenue so the field
   * value stays in sync with what's displayed.
   */
  useEffect(() => {
    if (!revenueLocked) return;
    if (Number(job.revenue) !== Number(liveQuote.suggested)) {
      set('revenue', String(liveQuote.suggested));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revenueLocked, liveQuote.suggested]);

  /**
   * Revenue divergence: when revenue is unlocked AND the actor has
   * manually entered a number different from the live suggested, we
   * show a subtle "↻ Suggested: $X" hint under the field so they can
   * see at a glance that surcharges/inputs they changed since have
   * moved the suggestion. Threshold is $0.50 so rounding does not
   * trigger a false-positive hint.
   */
  const revenueDiverges = !revenueLocked
    && job.revenue !== '' && job.revenue != null
    && Math.abs(Number(job.revenue) - Number(liveQuote.suggested)) > 0.5;

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

      {/* Live suggested-price preview — same engine as Dashboard's
          Quick Quote. Sits at the top of the form so the technician
          sees the recommended number BEFORE drilling into the rest
          of the inputs. Updates live as service/vehicle/miles/tire
          cost/surcharges change. When revenue is locked (technician
          without override), this number IS what gets saved. */}
      <div className="quote-box card-anim" style={{ marginBottom: 14 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, padding: '12px 14px',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 9, fontWeight: 800,
              color: 'var(--brand-primary)',
              textTransform: 'uppercase', letterSpacing: 1.5,
              marginBottom: 4,
            }}>
              Suggested price
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--t1)', lineHeight: 1 }}>
              {money(liveQuote.suggested)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
              Premium: {money(liveQuote.premium)} · updates as you type
            </div>
          </div>
          {!revenueLocked && (
            <button
              type="button"
              className="btn sm primary"
              onClick={() => set('revenue', String(liveQuote.suggested))}
              style={{ flexShrink: 0, minHeight: 44, padding: '0 14px' }}
            >
              Use suggested
            </button>
          )}
        </div>
      </div>

      {/* ─── Revenue section — TOP of form ─────────────────────────
         Per the operator's request: revenue is the most important
         data on a job. Miles + tire cost + revenue charged all live
         here at the top so the technician fills the numbers that
         actually matter FIRST, then drills into details below. The
         live pricing breakdown sits beneath the inputs so the
         technician sees how each value contributes to profit. */}
      <div className="form-group card-anim">
        <div className="form-group-title">Revenue</div>
        <div className="field-row">
          <div className="field">
            <label>Miles to job</label>
            <input
              type="number"
              inputMode="decimal"
              value={job.miles}
              onChange={(e) => set('miles', e.target.value)}
              placeholder="0"
            />
          </div>
          {/* Tire cost is a tire-vertical concept (cost basis of the
              tire stock used). Gated on needsTireDetails so it only
              renders for tire-material services — Jump Start, Fuel
              Delivery, Lockout, etc. in the tire vertical have no
              tire cost and shouldn't show this field. */}
          {needsTireDetails && (
            <div className="field">
              <label>Tire cost ($)</label>
              <input
                type="number"
                inputMode="decimal"
                value={job.tireCost}
                onChange={(e) => set('tireCost', e.target.value)}
                placeholder="0"
                disabled={tireSource === 'Customer supplied'}
              />
              {tireSource === 'Customer supplied' && (
                <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
                  Customer-supplied · $0
                </div>
              )}
            </div>
          )}
        </div>
        <div className={'field'}>
          <label>
            Revenue charged ($)
            {revenueLocked && (
              <span style={{
                marginLeft: 8, fontSize: 9, fontWeight: 800,
                color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 1,
              }}>
                · suggested price (locked)
              </span>
            )}
          </label>
          <input
            type="number"
            inputMode="decimal"
            value={job.revenue}
            onChange={(e) => set('revenue', e.target.value)}
            placeholder="0"
            disabled={revenueLocked}
            readOnly={revenueLocked}
            style={revenueLocked ? { opacity: 0.7, cursor: 'not-allowed' } : undefined}
          />
          {revenueLocked && (
            <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4, lineHeight: 1.4 }}>
              The system-suggested price is used. Ask an owner to enable
              technician price overrides if a manual adjustment is needed.
            </div>
          )}
          {revenueDiverges && (
            <button
              type="button"
              onClick={() => set('revenue', String(liveQuote.suggested))}
              style={{
                marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '4px 8px', borderRadius: 6,
                background: 'transparent', border: '1px solid var(--border)',
                color: 'var(--t2)', fontSize: 11, fontWeight: 600,
                cursor: 'pointer',
              }}
              aria-label={`Reset revenue to suggested price ${money(liveQuote.suggested)}`}
            >
              <span aria-hidden="true">↻</span>
              Suggested: {money(liveQuote.suggested)} · tap to apply
            </button>
          )}
        </div>

        {/* Pricing breakdown panel — vertical-aware, owner/admin
            only. It exposes cost + profit, so technicians
            (canViewProfit false) don't see it; they still get the
            suggested-price tiles above to set revenue. */}
        {permissions.canViewProfit && breakdown.model === 'flat' && (
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
        )}
        {permissions.canViewProfit && breakdown.model === 'labor_parts' && (
          <div className="pricing-breakdown">
            <div className="pricing-breakdown-row"><span>Revenue</span><span className="num green">{money(breakdown.revenue)}</span></div>
            {breakdown.laborCost > 0 && (
              <div className="pricing-breakdown-row">
                <span>Labor ({breakdown.laborHours} hrs × ${breakdown.laborRate}/hr)</span>
                <span className="num red">-{money(breakdown.laborCost)}</span>
              </div>
            )}
            {breakdown.partsCost > 0 && (
              <div className="pricing-breakdown-row">
                <span>Parts</span>
                <span className="num red">-{money(breakdown.partsCost)}</span>
              </div>
            )}
            {breakdown.partsMarkupAmount > 0 && (
              <div className="pricing-breakdown-row">
                <span>Parts handling ({breakdown.partsMarkupPct}%)</span>
                <span className="num red">-{money(breakdown.partsMarkupAmount)}</span>
              </div>
            )}
            {breakdown.diagnosticFee > 0 && (
              <div className="pricing-breakdown-row">
                <span>Diagnostic fee</span>
                <span className="num red">-{money(breakdown.diagnosticFee)}</span>
              </div>
            )}
            {breakdown.travelCost > 0 && (
              <div className="pricing-breakdown-row">
                <span>Travel ({breakdown.travelMiles} mi{breakdown.freeMilesIncluded ? `, ${breakdown.freeMilesIncluded} free` : ''})</span>
                <span className="num red">-{money(breakdown.travelCost)}</span>
              </div>
            )}
            {breakdown.belowMinServiceCharge && (
              <div className="pricing-breakdown-row" style={{ fontSize: 10, color: 'var(--t3)' }}>
                <span>Min service charge</span>
                <span>{money(breakdown.minServiceCharge)}</span>
              </div>
            )}
            <div className="pricing-breakdown-row total">
              <span>Profit</span>
              <span className={'num ' + (breakdown.profit >= 0 ? 'green' : 'red')}>{money(breakdown.profit)}</span>
            </div>
          </div>
        )}
        {permissions.canViewProfit && breakdown.model === 'package_multiplier' && (
          <div className="pricing-breakdown">
            <div className="pricing-breakdown-row"><span>Revenue</span><span className="num green">{money(breakdown.revenue)}</span></div>
            <div className="pricing-breakdown-row">
              <span>Vehicle size</span>
              <span>{breakdown.vehicleSize} (×{breakdown.vehicleSizeMultiplier})</span>
            </div>
            <div className="pricing-breakdown-row total">
              <span>Profit</span>
              <span className={'num ' + (breakdown.profit >= 0 ? 'green' : 'red')}>{money(breakdown.profit)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Phase 2.3: vehicle-size chip block for verticals using the
          package_multiplier pricing model (detailing). Tire / mechanic
          have features.vehicleSizeMultiplier === false; this block
          short-circuits to null. */}
      {vertical.features.vehicleSizeMultiplier && vehicleSizes.length > 0 && (
        <div className="form-group card-anim">
          <div className="form-group-title">Vehicle size</div>
          <div className="chip-grid">
            {vehicleSizes.map((sz) => (
              <button
                key={sz}
                type="button"
                className={'chip' + (job.vehicleSize === sz ? ' active' : '')}
                onClick={() => set('vehicleSize', sz)}
              >{sz}</button>
            ))}
          </div>
        </div>
      )}

      <div className={'form-group card-anim'}>
        <div className="form-group-title">{vertical.copy.packageLabel || 'Service'}</div>
        <ServicePicker
          services={vertical.services}
          enabledIds={enabledPackages}
          selected={job.service}
          onSelect={(id) => set('service', id)}
        />
      </div>

      {/* Phase 2.3: detailing add-ons multi-select. Renders only when
          the active vertical declares add-on services. Other verticals
          have enabledAddOns.length === 0 and this block is null. */}
      {enabledAddOns.length > 0 && (
        <div className="form-group card-anim">
          <div className="form-group-title">
            Add-ons{' '}
            <span style={{ fontWeight: 400, color: 'var(--t3)', fontSize: 11 }}>
              (tap any that apply)
            </span>
          </div>
          <div className="chip-grid">
            {enabledAddOns.map((id) => {
              const selected = (job.detailingAddons ?? []).includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  className={'chip' + (selected ? ' active' : '')}
                  onClick={() => {
                    const cur = job.detailingAddons ?? [];
                    const next = selected ? cur.filter((x) => x !== id) : [...cur, id];
                    set('detailingAddons', next as Job['detailingAddons']);
                  }}
                >{id}</button>
              );
            })}
          </div>
        </div>
      )}

      <div className={'form-group card-anim'}>
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
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={job.customerPhone}
              onChange={(e) => set('customerPhone', formatPhonePartial(e.target.value))}
              onBlur={(e) => set('customerPhone', formatPhone(e.target.value))}
              placeholder="(555) 123-4567"
            />
          </div>
        </div>
        {/* City — state is implicit (brand.state, set during onboarding).
            Technicians don't need a state picker; they're always serving
            customers in the business's home state. Suggestions come from
            searchCities() so common cities can be tapped instead of
            typed every single job. */}
        <div className={'field'} ref={cityWrapRef} style={{ position: 'relative' }}>
          <label>City</label>
          <input
            value={job.city || ''}
            onChange={(e) => {
              const c = e.target.value;
              const s = brand.state || job.state || '';
              setJob({
                ...job,
                city: c,
                state: s,
                area: c || job.area,
                fullLocationLabel: c && s ? `${c}, ${s}` : c,
              });
              setCityOpen(true);
            }}
            onFocus={() => setCityOpen(true)}
            placeholder="Start typing your city"
            autoComplete="address-level2"
          />
          {cityOpen && citySuggestions.length > 0 && (
            <div
              role="listbox"
              style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                marginTop: 4, background: 'var(--s2)',
                border: '1px solid var(--border)', borderRadius: 9,
                boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
                overflow: 'hidden',
              }}
            >
              {citySuggestions.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="option"
                  aria-selected={(job.city || '').toLowerCase() === c.toLowerCase()}
                  onClick={() => {
                    const s = brand.state || job.state || '';
                    setJob({
                      ...job,
                      city: c,
                      state: s,
                      area: c,
                      fullLocationLabel: s ? `${c}, ${s}` : c,
                    });
                    setCityOpen(false);
                  }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '11px 12px', background: 'transparent', border: 'none',
                    color: 'var(--t1)', fontSize: 14, cursor: 'pointer',
                    minHeight: 44,
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {canAssign && (
        <AssignmentPicker
          value={job.assignedToUid}
          onChange={(uid) => setJob({ ...job, assignedToUid: uid } as Job)}
          members={businessMembers}
          currentUid={currentUid}
        />
      )}

      {/* Vertical-specific job fields, rendered for any vertical
          whose UI is NOT the tire bespoke block. Mechanic gets
          Vehicle Make/Model, Mileage, Diagnostic Code, Labor Hours,
          Parts Cost. Detailing gets Vehicle Size (when populated in
          2.3). Tire's jobFields (tireSize/tireCondition/wheelLock-
          Removed) are already covered by the bespoke block below,
          so we suppress the loop here for tire. */}
      {!showTireBlock && vertical.jobFields.length > 0 && (
        <div className={'form-group card-anim'}>
          <div className="form-group-title">
            {vertical.shortName} Details
          </div>
          <div className="field-row">
            {vertical.jobFields.map((field) => (
              <DynamicJobField
                key={field.key}
                field={field}
                value={(job as unknown as Record<string, unknown>)[field.key]}
                onChange={(v) => setJob({ ...job, [field.key]: v } as Job)}
                disabled={isSaving}
              />
            ))}
          </div>
        </div>
      )}

      {/* Mechanic-specific structured parts entry. Lives here because
          it's interaction-rich (autocomplete, source picker, soft-
          warn at save) and would be awkward inside a DynamicJobField
          loop. Tire / detailing skip this block. */}
      {vertical.key === 'mechanic' && (
        <div className="card-anim" style={{ marginBottom: 12 }}>
          <PartsSection
            parts={job.parts ?? []}
            inventory={inventory}
            onChange={(parts) => setJob({ ...job, parts } as Job)}
          />
        </div>
      )}

      {/* Tire-specific bespoke block (size + qty + source picker +
          purchase panel + inventory preview). Already feature-gated
          via needsTireDetails which now also checks
          vertical.features.inventoryDeduction, so this entire block
          stays hidden for mechanic and detailing accounts. */}
      {needsTireDetails && (
        <div className="form-group card-anim">
          <div className="form-group-title">Tire Details</div>
          <div className="field-row">
            <div className={'field'}>
              <label>Size</label>
              <input value={job.tireSize} onChange={(e) => set('tireSize', e.target.value)} placeholder="225/65R17" />
              {(() => {
                const typed = (job.tireSize || '').trim();
                if (!typed) return null;
                const target = normalizeTireSize(typed);
                if (!target) return null;
                const match = inventory.find(
                  (it) => normalizeTireSize(it.size || '') === target,
                );
                if (!match) return null;
                const total = Number(match.qty || 0);
                const avail = availableQty(match);
                const reserved = reservedQty(match);
                const needed = Number(job.qty || 0);
                const low = needed > 0 && needed > avail;
                if (reserved > 0 && low) {
                  return (
                    <div className="inv-match-badge warn">
                      ⚠ Low availability: {total} in stock, {reserved} reserved
                    </div>
                  );
                }
                if (reserved > 0) {
                  return (
                    <div className="inv-match-badge">
                      ✓ In stock: {total} × {match.size} · available {avail}
                    </div>
                  );
                }
                return (
                  <div className="inv-match-badge">
                    ✓ In stock: {total} × {match.size}
                  </div>
                );
              })()}
            </div>
            <div className={'field'}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <button type="button" className="btn sm secondary" onClick={() => receiptInputRef.current?.click()} disabled={receiptUploading}>
                    {receiptUploading ? 'Uploading…' : job.tireReceiptUrl ? 'Replace receipt' : 'Upload receipt'}
                  </button>
                  {job.tireReceiptUrl ? (
                    <a
                      href={job.tireReceiptUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="View receipt full size"
                      style={{
                        display: 'inline-block', width: 56, height: 56,
                        borderRadius: 8, overflow: 'hidden',
                        border: '1px solid var(--border)',
                        background: 'var(--s3)',
                      }}
                    >
                      <img
                        src={job.tireReceiptUrl}
                        alt="Receipt thumbnail"
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    </a>
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
        <div className="form-group-title">Job Details</div>
        <div className="field-row">
          {/* Quantity here ONLY for non-tire services. Tire-material
              services have Qty in the Tire Details block above, so
              showing it here too would duplicate the field and let
              the two inputs drift out of sync. */}
          {!needsTireDetails && (
            <div className={'field'}>
              <label>Quantity</label>
              <input type="number" inputMode="numeric" value={job.qty} onChange={(e) => set('qty', e.target.value)} placeholder="1" />
            </div>
          )}
          <div className="field">
            <label>Material $</label>
            <input type="number" inputMode="decimal" value={job.materialCost} onChange={(e) => set('materialCost', e.target.value)} placeholder="0" />
          </div>
        </div>
        <div className="field" style={{ marginTop: 6 }}>
          <label>Conditions <span style={{ fontWeight: 400, color: 'var(--t3)', fontSize: 11 }}>(tap any that apply)</span></label>
          <div className="chip-grid">
            {/* Conditions are vertical-aware. Detailing omits 'highway'
                — no one washes cars on the highway. Configs that
                don't declare `conditions` fall back to all 4 for
                back-compat with anything not yet migrated. */}
            {(vertical.conditions ?? [
              { key: 'emergency' as const, label: '🚨 Emergency' },
              { key: 'lateNight' as const, label: '🌙 Late Night' },
              { key: 'highway' as const,   label: '🛣 Highway' },
              { key: 'weekend' as const,   label: '📅 Weekend' },
            ]).map(({ key: k, label: l }) => (
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
        <div className={'field'}>
          <label>Payment method</label>
          <div className="chip-grid">
            {PAYMENT_METHODS.map((p) => (
              <button key={p} type="button" className={'chip' + (job.payment === p ? ' active' : '')} onClick={() => set('payment', p)}>{p}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Job status</label>
          <div className="chip-grid">
            {JOB_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={'chip' + (job.status === s ? ' active' : '')}
                onClick={() => set('status', s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Payment status</label>
          <div className="chip-grid">
            {PAYMENT_STATUSES.map((p) => (
              <button
                key={p}
                type="button"
                className={'chip' + (job.paymentStatus === p ? ' active' : '')}
                onClick={() => set('paymentStatus', p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="form-group card-anim">
        <div className="form-group-title">Note</div>
        <div className={'field'}>
          <textarea
            value={job.note}
            onChange={(e) => set('note', e.target.value)}
            placeholder="Any special details for this job…"
          />
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
            <button
              className="btn secondary"
              disabled={isSaving}
              aria-busy={savingMode === 'saveAndNew'}
              onClick={async () => {
                if (isSaving) return;
                setSavingMode('saveAndNew');
                try { await onSaveAndNew(); } finally { setSavingMode(null); }
              }}
              style={{
                minWidth: 96,
                opacity: isSaving && savingMode !== 'saveAndNew' ? 0.5 : 1,
                cursor: isSaving ? 'not-allowed' : 'pointer',
                transition: 'opacity 120ms ease',
              }}
            >
              {savingMode === 'saveAndNew' ? 'Saving…' : '＋ Another'}
            </button>
          )}
          <button
            className="btn primary"
            disabled={isSaving}
            aria-busy={savingMode === 'save'}
            onClick={async () => {
              if (isSaving) return;
              setSavingMode('save');
              try { await onSave(); } finally { setSavingMode(null); }
            }}
            style={{
              minWidth: 120,
              opacity: isSaving && savingMode !== 'save' ? 0.5 : 1,
              cursor: isSaving ? 'not-allowed' : 'pointer',
              transition: 'opacity 120ms ease',
            }}
          >
            {savingMode === 'save' ? 'Saving…' : (isEditing ? 'Update Job' : 'Save Job')}
          </button>
        </div>
      </div>
    </div>
  );
}
