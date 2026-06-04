import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Job, Settings, InventoryItem, TireSource } from '@/types';
import {
  DEFAULT_SERVICE_PRICING, DEFAULT_VEHICLE_PRICING,
  LEAD_SOURCES, PAYMENT_METHODS, PAYMENT_STATUSES, JOB_STATUSES, TIRE_MATERIAL_SERVICES, TIRE_SOURCES,
} from '@/lib/defaults';
import { computeBreakdownTagged } from '@/lib/pricing';
import { calcQuote, money, normalizeTireSize, planInventoryDeduction } from '@/lib/utils';
import { addToast } from '@/lib/toast';
import { enqueueReceiptUpload } from '@/lib/uploadQueue';
import { compressImage } from '@/lib/imageCompress';
import { rankByUsage } from '@/lib/chipFrequency';
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
import { MemoInput, MemoTextarea, MemoSelect } from '@/components/addJob/MemoInput';
import { CustomerLookupCard, type UseCustomerPatch } from '@/components/addJob/CustomerLookupCard';
import { AddressAutofillInput, type AddressValue } from '@/components/addJob/AddressAutofillInput';
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
  // Widened to accept the function-form setter from React useState.
  // Perf P1-3 fix (2026-05-31): per-keystroke updates use the
  // function form (`setJob((prev) => ({ ...prev, [k]: v }))`) so
  // the update closure doesn't capture the current `job` value.
  // That keeps the `set` helper below stable across renders, which
  // in turn lets memoized field components actually skip re-render.
  setJob: Dispatch<SetStateAction<Job>>;
  settings: Settings;
  inventory: InventoryItem[];
  /** Job history — drives frequency-ranked chip ordering. Pass the
   *  full unscoped list; the helper ignores values that aren't in the
   *  chip's option set, so cross-vertical noise doesn't bias the
   *  ranking. */
  jobs: ReadonlyArray<Job>;
  isEditing: boolean;
  prefilledFromQuote: boolean;
  onSave: () => Promise<void> | void;
  onSaveAndNew: () => Promise<void> | void;
}

export function AddJob({ job, setJob, settings, inventory, jobs, isEditing, prefilledFromQuote, onSave, onSaveAndNew }: Props) {
  const { businessId } = useBrand();
  const permissions = usePermissions();
  // Active vertical drives which fields, services, breakdown panel,
  // and inventory hooks render. For tire (the legacy case) every
  // feature flag the bespoke UI relies on is `true`, so behavior is
  // byte-for-byte identical to pre-Phase-2.1.
  const vertical = useActiveVertical();
  const showTireBlock = vertical.features.inventoryDeduction;
  // Sub-Project B: assignment picker is team management — surface
  // when canManageTeam, not by raw role compare. Same default
  // behavior (owners + admins see it) but the gate uses the flag
  // that already controls every other team-mutation UI.
  const { member } = useMembership();
  const canAssign = permissions.canManageTeam;
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

  // Frequency-ranked option lists — most-used first based on the
  // operator's actual job history. Empty fresh deployments get the
  // config-declared order back (rankByUsage falls through to original
  // order when no jobs match). Memoized on [options, jobs] so re-
  // renders don't re-sort.
  const rankedVehicles       = useMemo(() => rankByUsage(vehicles, jobs, 'vehicleType'), [vehicles, jobs]);
  const rankedSources        = useMemo(() => rankByUsage(LEAD_SOURCES, jobs, 'source'), [jobs]);
  const rankedTireSources    = useMemo(() => rankByUsage(TIRE_SOURCES, jobs, 'tireSource'), [jobs]);
  // Use the legacy `payment` field (string) for ranking — every job
  // since day-0 has it populated, so historical counts are accurate.
  // The newer `paymentMethod` typed union is only set on jobs saved
  // since that field was introduced (much smaller corpus).
  const rankedPaymentMethods = useMemo(() => rankByUsage(PAYMENT_METHODS, jobs, 'payment'), [jobs]);

  // Perf P1-3 fix (2026-05-31): function-form setter + useCallback so
  // `set` is a STABLE reference across renders. Inputs that receive
  // `set` (directly or via FormField) can be wrapped in React.memo
  // without their onChange invalidating every keystroke. The previous
  // shape `setJob({ ...job, [k]: v })` closed over the current `job`
  // value, which meant `set` was reconstructed every render and any
  // memoization downstream was useless.
  const set = useCallback(<K extends keyof Job>(k: K, v: Job[K]): void => {
    setJob((prev) => ({ ...prev, [k]: v }));
  }, [setJob]);

  // Stable per-field setter callbacks. Built once (set is stable) and
  // passed into MemoInput / MemoTextarea / MemoSelect components.
  // Each callback receives the raw string from the input event; field-
  // specific coercion happens here so the MemoInput primitives stay
  // type-agnostic.
  const fieldSetters = useMemo(() => ({
    customerName:        (v: string) => set('customerName', v),
    customerPhonePartial:(v: string) => set('customerPhone', formatPhonePartial(v)),
    customerPhoneBlur:   (v: string) => set('customerPhone', formatPhone(v)),
    tireSize:            (v: string) => set('tireSize', v),
    qty:                 (v: string) => set('qty', v),
    tireVendor:          (v: string) => set('tireVendor', v),
    tirePurchasePrice:   (v: string) => set('tirePurchasePrice', v),
    tireCondition:       (v: string) => set('tireCondition', v as 'New' | 'Used' | ''),
    tireBrand:           (v: string) => set('tireBrand', v),
    tireNotes:           (v: string) => set('tireNotes', v),
    materialCost:        (v: string) => set('materialCost', v),
  }), [set]);

  // ─── SP2: Customer lookup patch handler ──────────────────────
  // CustomerLookupCard's Use Customer / Repeat Last Service buttons
  // dispatch a UseCustomerPatch — apply it to the job draft.
  const applyCustomerPatch = useCallback((patch: UseCustomerPatch) => {
    setJob((prev) => ({
      ...prev,
      ...(patch.customerId !== undefined       ? { customerId: patch.customerId }             : {}),
      ...(patch.vehicleId  !== undefined       ? { vehicleId:  patch.vehicleId }              : {}),
      ...(patch.customerName !== undefined     ? { customerName: patch.customerName }         : {}),
      ...(patch.customerPhone !== undefined    ? { customerPhone: patch.customerPhone }       : {}),
      ...(patch.customerEmail !== undefined    ? { customerEmail: patch.customerEmail }       : {}),
      ...(patch.city           !== undefined   ? { city: patch.city }                         : {}),
      ...(patch.state          !== undefined   ? { state: patch.state }                       : {}),
      ...(patch.addressLine    !== undefined   ? { addressLine: patch.addressLine }           : {}),
      ...(patch.zipCode        !== undefined   ? { zipCode: patch.zipCode }                   : {}),
      ...(patch.vehicleType    !== undefined   ? { vehicleType: patch.vehicleType }           : {}),
      ...(patch.vehicleMakeModel !== undefined ? { vehicleMakeModel: patch.vehicleMakeModel } : {}),
      ...(patch.tireSize       !== undefined   ? { tireSize: patch.tireSize }                 : {}),
      ...(patch.service        !== undefined   ? { service: patch.service }                   : {}),
      ...(patch.vehicleSize    !== undefined   ? { vehicleSize: patch.vehicleSize }           : {}),
      ...(patch.tireBrand      !== undefined   ? { tireBrand: patch.tireBrand }               : {}),
      ...(patch.qty            !== undefined   ? { qty: patch.qty as Job['qty'] }             : {}),
    } as Job));
    addToast('Customer info applied', 'success');
  }, [setJob]);

  // ─── SP2: Address-value adapter ──────────────────────────────
  const addressValue: AddressValue = useMemo(() => ({
    addressLine: String(job.addressLine ?? ''),
    city:        String(job.city ?? ''),
    state:       String(job.state ?? ''),
    zipCode:     String(job.zipCode ?? ''),
  }), [job.addressLine, job.city, job.state, job.zipCode]);

  const onAddressChange = useCallback((next: AddressValue) => {
    setJob((prev) => ({
      ...prev,
      addressLine: next.addressLine,
      city: next.city,
      state: next.state,
      zipCode: next.zipCode,
      area: next.city || prev.area,
      fullLocationLabel: next.city && next.state ? `${next.city}, ${next.state}` : next.city,
    }));
  }, [setJob]);

  // ─── SP2: Step-2 phone-lookup glue ───────────────────────────
  const phoneForLookup = String(job.customerPhone ?? '');

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
      setJob((prev) => ({ ...prev, revenue: q.suggested }));
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
      setJob((prev) => ({
        ...prev,
        state: brand.state,
        city: prev.city || brand.mainCity || '',
        fullLocationLabel: prev.fullLocationLabel ||
          (brand.mainCity && brand.state ? `${brand.mainCity}, ${brand.state}` : (prev.area || '')),
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand.state]);

  // Perf P1-3 fix (2026-05-31): narrow the dep list to pricing-
  // relevant fields only. The previous `[job, settings]` deps caused
  // the pricing engine to recompute on every keystroke including
  // customerName / customerPhone / city / notes — fields that don't
  // affect price. The fields below match what liveQuote/calcQuote
  // consumes plus the tire-specific inputs that flow into the
  // tire pricing path. Adding a new pricing-relevant Job field
  // requires extending this list.
  const breakdown = useMemo(
    () => computeBreakdownTagged(job, settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      job.service, job.vehicleType, job.miles,
      job.tireCost, job.materialCost, job.qty,
      job.emergency, job.lateNight, job.highway, job.weekend,
      job.laborHours, job.partsCost, job.diagnosticFee, job.vehicleSize,
      job.revenue,
      job.tireSize, job.tireSource, job.tirePurchasePrice, job.tireCondition,
      settings,
    ],
  );

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
  // SP2: city autocomplete state removed — Step 7's
  // AddressAutofillInput owns the entire ZIP/city/state/addressLine
  // surface now via the bundled usZips dataset.

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
      // Compress before upload. A camera capture from a modern phone
      // is 4-8 MB; on LTE that's 10-20s of upload + a real risk of
      // hitting the 8 MB receipt cap in firebase.ts. compressImage
      // hits ~200-500 KB at 1600px / 0.82q. Falls back to the original
      // bytes if the browser can't decode (e.g. unconverted HEIC).
      const compressed = await compressImage(file, { maxDim: 1600, quality: 0.82 });
      const toUpload = compressed.blob.size < file.size
        ? new File([compressed.blob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' })
        : file;
      const url = await enqueueReceiptUpload(businessId, job.id || 'pending-' + Date.now(), toUpload);
      if (url) {
        set('tireReceiptUrl', url);
        addToast('Receipt uploaded', 'success');
      } else {
        // Offline path: queued for later upload. Store a local object URL
        // so the form still shows a thumbnail; on next online drain the
        // real CDN URL replaces this via the job patch.
        const localUrl = URL.createObjectURL(toUpload);
        set('tireReceiptUrl', localUrl);
        addToast('Receipt queued — uploads when online', 'info');
      }
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
      {/* Stick the suggested-price tile to the top of the scroll
          viewport so the tech sees the live number while filling the
          rest of the form. Without sticky, the tile scrolls away after
          the first card and the live update becomes invisible — the
          single biggest UX gap on the highest-friction screen. The
          z-index keeps it above any in-flow content; the backdrop
          blur + opaque bg keep content scrolling underneath from
          showing through and looking noisy. The negative-margin
          stretches it slightly so it sits flush with the page edges
          and looks like a real header bar, not a floating chip. */}
      <div
        className="quote-box card-anim"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          marginBottom: 12,
          background: 'var(--s1)',
          backdropFilter: 'blur(8px) saturate(140%)',
          WebkitBackdropFilter: 'blur(8px) saturate(140%)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, padding: '10px 12px',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 9, fontWeight: 800,
              color: 'var(--brand-primary)',
              textTransform: 'uppercase', letterSpacing: 1.5,
              marginBottom: 2,
            }}>
              Suggested
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--t1)', lineHeight: 1 }}>
              {money(liveQuote.suggested)}
              <span style={{ fontSize: 10, color: 'var(--t3)', marginLeft: 8, fontWeight: 500 }}>
                · prem {money(liveQuote.premium)}
              </span>
            </div>
          </div>
          {!revenueLocked && (
            <button
              type="button"
              className="btn sm primary"
              onClick={() => set('revenue', String(liveQuote.suggested))}
              style={{ flexShrink: 0, minHeight: 40, padding: '0 12px', fontSize: 13 }}
            >
              Use
            </button>
          )}
        </div>
      </div>

      {/* SP2: step badge style — inline so SP2 doesn't depend on
          a CSS file edit that would conflict with parallel work. */}
      <style>{`
        .step-badge { display: inline-flex; align-items: center; justify-content: center;
          min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px;
          background: var(--brand-primary); color: var(--brand-on-primary, #1a1a1a);
          font-size: 11px; font-weight: 700; margin-right: 8px;
        }
      `}</style>

      {/* ─── SP2 Step 1: Phone ──────────────────────────────────
          Operator's first keystroke. MemoInput + stable setter
          per the P1-3 keystroke-storm contract. Triggers the
          Step 2 CustomerLookupCard below. */}
      <div className="form-group card-anim">
        <div className="form-group-title"><span className="step-badge">1</span>Phone</div>
        <div className="field">
          <label htmlFor="addjob-customer-phone">Customer phone</label>
          <MemoInput
            id="addjob-customer-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={job.customerPhone}
            onChange={fieldSetters.customerPhonePartial}
            onBlur={fieldSetters.customerPhoneBlur}
            placeholder="(555) 123-4567"
          />
        </div>
      </div>

      {/* ─── SP2 Step 2: Customer Lookup ───────────────────────
          Renders null in idle state; renders a Returning Customer
          card on hit; renders a "no match" hint on miss. */}
      {businessId && (
        <CustomerLookupCard
          businessId={businessId}
          rawPhone={phoneForLookup}
          onApplyPatch={applyCustomerPatch}
        />
      )}

      {/* ─── SP2 Step 2 (continued): Customer details ─────────
          Editable name + email + company name. */}
      <div className="form-group card-anim">
        <div className="form-group-title"><span className="step-badge">2</span>Customer details</div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="addjob-customer-name">Name</label>
            <MemoInput
              id="addjob-customer-name"
              value={job.customerName}
              onChange={fieldSetters.customerName}
              placeholder="John D."
            />
          </div>
          <div className="field">
            <label htmlFor="addjob-customer-email">Email <span style={{ fontWeight: 400, color: 'var(--t3)', fontSize: 11 }}>(optional)</span></label>
            <MemoInput
              id="addjob-customer-email"
              type="email"
              autoComplete="email"
              value={String(job.customerEmail ?? '')}
              onChange={(v: string) => set('customerEmail', v as Job['customerEmail'])}
              placeholder="customer@example.com"
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="addjob-company-name">Company / Fleet name <span style={{ fontWeight: 400, color: 'var(--t3)', fontSize: 11 }}>(optional)</span></label>
          <MemoInput
            id="addjob-company-name"
            value={String(job.companyName ?? '')}
            onChange={(v: string) => set('companyName', v as Job['companyName'])}
            placeholder="Uber Fleet LLC"
          />
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
        <div className="form-group-title"><span className="step-badge">4</span>Quick Pricing</div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="addjob-miles">Miles to job</label>
            <input
              id="addjob-miles"
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
              <label htmlFor="addjob-tire-cost">Tire cost ($)</label>
              <input
                id="addjob-tire-cost"
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
          <label htmlFor="addjob-revenue">
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
            id="addjob-revenue"
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
        <div className="form-group-title"><span className="step-badge">5</span>{vertical.copy.packageLabel || 'Service'}</div>
        <ServicePicker
          services={vertical.services}
          enabledIds={enabledPackages}
          selected={job.service}
          onSelect={(id) => set('service', id)}
          jobs={jobs}
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
        <div className="form-group-title"><span className="step-badge">3</span>Vehicle</div>
        <div className="chip-grid">
          {rankedVehicles.map((v) => (
            <button key={v} className={'chip' + (job.vehicleType === v ? ' active' : '')}
              onClick={() => set('vehicleType', v)} type="button">{v}</button>
          ))}
        </div>
      </div>

      {/* ─── SP2 Step 7: Location ──────────────────────────────
          AddressAutofillInput owns ZIP + city + state + addressLine
          per spec §"AddJob Workflow Change → step 7". Replaces the
          prior City-only Customer-card field. */}
      <div className="form-group card-anim">
        <div className="form-group-title"><span className="step-badge">7</span>Location</div>
        <AddressAutofillInput value={addressValue} onChange={onAddressChange} />
      </div>

      {canAssign && (
        <AssignmentPicker
          value={job.assignedToUid}
          onChange={(uid) => setJob((prev) => ({ ...prev, assignedToUid: uid }))}
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
                onChange={(v) => setJob((prev) => ({ ...prev, [field.key]: v } as Job))}
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
            onChange={(parts) => setJob((prev) => ({ ...prev, parts } as Job))}
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
          <div className="form-group-title"><span className="step-badge">6</span>Tire Details</div>
          <div className="field-row">
            <div className={'field'}>
              <label htmlFor="addjob-tire-size">Size</label>
              <MemoInput id="addjob-tire-size" value={job.tireSize} onChange={fieldSetters.tireSize} placeholder="225/65R17" />
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
              <label htmlFor="addjob-qty">Qty</label>
              <MemoInput id="addjob-qty" type="number" inputMode="numeric" value={job.qty} onChange={fieldSetters.qty} />
            </div>
          </div>
          <div className="field">
            <label id="addjob-tire-source-label">Tire source</label>
            <div className="chip-grid" role="group" aria-labelledby="addjob-tire-source-label">
              {rankedTireSources.map((s) => (
                <button key={s} className={'chip' + (tireSource === s ? ' active' : '')}
                  aria-pressed={tireSource === s}
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
                  <label htmlFor="addjob-tire-vendor">Vendor</label>
                  <MemoInput id="addjob-tire-vendor" value={job.tireVendor || ''} onChange={fieldSetters.tireVendor} placeholder="Discount Tire" />
                </div>
                <div className="field">
                  <label htmlFor="addjob-tire-purchase-price">Purchase price ($)</label>
                  <MemoInput id="addjob-tire-purchase-price" type="number" inputMode="decimal" value={job.tirePurchasePrice || ''} onChange={fieldSetters.tirePurchasePrice} placeholder="0" />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="addjob-tire-condition">Condition</label>
                  <MemoSelect id="addjob-tire-condition" value={job.tireCondition || ''} onChange={fieldSetters.tireCondition}>
                    <option value="">Select…</option>
                    <option value="New">New</option>
                    <option value="Used">Used</option>
                  </MemoSelect>
                </div>
                <div className="field">
                  <label htmlFor="addjob-tire-brand">Brand</label>
                  <MemoInput id="addjob-tire-brand" value={job.tireBrand || ''} onChange={fieldSetters.tireBrand} placeholder="Michelin" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="addjob-receipt-upload">Receipt</label>
                <input id="addjob-receipt-upload" ref={receiptInputRef} type="file" accept="image/*" style={{ display: 'none' }}
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
                <label htmlFor="addjob-tire-notes">Notes (optional)</label>
                <MemoTextarea id="addjob-tire-notes" value={job.tireNotes || ''} onChange={fieldSetters.tireNotes} placeholder="Tread depth, condition notes…" />
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
              <label htmlFor="addjob-qty-mech">Quantity</label>
              <MemoInput id="addjob-qty-mech" type="number" inputMode="numeric" value={job.qty} onChange={fieldSetters.qty} placeholder="1" />
            </div>
          )}
          <div className="field">
            <label htmlFor="addjob-material-cost">Material $</label>
            <MemoInput id="addjob-material-cost" type="number" inputMode="decimal" value={job.materialCost} onChange={fieldSetters.materialCost} placeholder="0" />
          </div>
        </div>
        <div className="field" style={{ marginTop: 6 }}>
          <label id="addjob-conditions-label">Conditions <span style={{ fontWeight: 400, color: 'var(--t3)', fontSize: 11 }}>(tap any that apply)</span></label>
          <div className="chip-grid" role="group" aria-labelledby="addjob-conditions-label">
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
              <button key={k} type="button" className={'chip' + (job[k] ? ' active' : '')} aria-pressed={!!job[k]} onClick={() => set(k, !job[k])}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="form-group card-anim">
        <div className="form-group-title">Lead & Payment</div>
        <div className="field">
          <label id="addjob-lead-source-label">Lead source</label>
          <div className="chip-grid" role="group" aria-labelledby="addjob-lead-source-label">
            {rankedSources.map((s) => (
              <button key={s} type="button" className={'chip' + (job.source === s ? ' active' : '')} aria-pressed={job.source === s} onClick={() => set('source', s)}>{s}</button>
            ))}
          </div>
        </div>
        <div className={'field'}>
          <label id="addjob-payment-method-label">Payment method</label>
          <div className="chip-grid" role="group" aria-labelledby="addjob-payment-method-label">
            {rankedPaymentMethods.map((p) => (
              <button key={p} type="button" className={'chip' + (job.payment === p ? ' active' : '')} aria-pressed={job.payment === p} onClick={() => set('payment', p)}>{p}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label id="addjob-job-status-label">Job status</label>
          <div className="chip-grid" role="group" aria-labelledby="addjob-job-status-label">
            {JOB_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={'chip' + (job.status === s ? ' active' : '')}
                aria-pressed={job.status === s}
                onClick={() => set('status', s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label id="addjob-payment-status-label">Payment status</label>
          <div className="chip-grid" role="group" aria-labelledby="addjob-payment-status-label">
            {PAYMENT_STATUSES.map((p) => (
              <button
                key={p}
                type="button"
                className={'chip' + (job.paymentStatus === p ? ' active' : '')}
                aria-pressed={job.paymentStatus === p}
                onClick={() => set('paymentStatus', p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="form-group card-anim">
        <div className="form-group-title"><span className="step-badge">8</span>Notes</div>
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
