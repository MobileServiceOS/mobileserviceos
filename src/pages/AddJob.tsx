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
import { validateAddJob } from '@/lib/addJobValidation';
import { splitEmojiLabel } from '@/lib/emojiLabel';

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
  /** Batch B (2026-06-05): bottom-nav is hidden while tab === 'add'
   *  so Cancel is the technician's only escape route off the form.
   *  Wired in App.tsx to startNewJob() + setTab('dashboard') so the
   *  draft is reset before navigating away — same behavior as a
   *  successful save, minus the persistence call. */
  onCancel: () => void;
}

export function AddJob({ job, setJob, settings, inventory, jobs, isEditing, prefilledFromQuote, onSave, onSaveAndNew, onCancel }: Props) {
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

  // Batch C (2026-06-05): collapsible UI state.
  // - statusExpanded: Lead & Payment's Job Status + Payment Status
  //   chip-grids collapse to a single "Status: X · Y · tap to edit"
  //   row when this is false. Expansion is per-session — once the
  //   operator opens the editors, they stay open until the next form
  //   mount (a save/cancel resets the draft and re-mounts).
  // - notesExpanded: the Notes textarea collapses behind a "+ Add
  //   notes" button by default. When editing a job that already has
  //   notes, we initialize to expanded so the operator doesn't have
  //   to tap through to see content they're already authoring.
  const [statusExpanded, setStatusExpanded] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(() => Boolean(job.note && String(job.note).trim()));

  // Batch C (2026-06-05): negative-profit confirm modal.
  // When canViewProfit is true (owner/admin) AND breakdown.profit
  // is negative at save time, intercept the save and surface a
  // confirm modal. The pending-mode (save vs saveAndNew) is stashed
  // so the "Save anyway" branch resumes the correct path.
  // Technicians (canViewProfit false) never see this modal —
  // they don't see the breakdown panel either, so the check is
  // gated on the same permission.
  const [negProfitMode, setNegProfitMode] = useState<null | 'save' | 'saveAndNew'>(null);
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

  // Pre-populate revenue with suggested when blank and service/vehicle present.
  //
  // Batch E (2026-06-05): the dep list is INTENTIONALLY narrow.
  // Omitted deliberately: isEditing (read once at form mount, never
  // flips), job.revenue (we only seed when it's empty — re-firing on
  // every revenue keystroke would clobber the user's manual entry),
  // settings + the other calcQuote inputs (miles/tireCost/qty/
  // surcharges/etc — those drive the LIVE quote effect at line ~528,
  // not this seed-on-pick path). If a future maintainer "fixes"
  // exhaustive-deps by adding job.revenue, every digit typed into
  // the revenue field would re-run this branch and overwrite the
  // user input back to the system suggestion — see Batch A
  // regression where this exact path almost shipped.
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

  // Auto-zero tireCost when customer-supplied.
  //
  // Batch E (2026-06-05): omit job.tireCost and `set` from deps on
  // purpose. The body READS job.tireCost only to detect "needs
  // zeroing"; including it as a dep would trigger an infinite loop
  // (set tireCost → effect reruns → reads new value → re-checks).
  // `set` is the parent's setter which closes over fresh `job` via
  // setJob((prev) => …) so a stale-closure read is structurally
  // impossible here. Only re-fire when the SOURCE selection changes.
  useEffect(() => {
    if (tireSource === 'Customer supplied' && Number(job.tireCost || 0) !== 0) {
      set('tireCost', 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tireSource]);

  // Mirror purchase price → tireCost when bought-for-this-job.
  //
  // tireCost is stored/consumed as the TOTAL tire cost (qty baked in;
  // see flat.ts computeFlatPrice + App.tsx saveJob). "Purchase price ($)"
  // is PER-UNIT, so the mirror is purchasePrice × qty — keeping the live
  // breakdown consistent with the saved value. (2026-06-05 audit.)
  //
  // Batch E (2026-06-05): job.tireCost is omitted from deps for the
  // same loop-prevention reason as the customer-supplied effect
  // above — body reads it only to gate the write. `set` is omitted
  // because the setter is functionally stable (closes over setJob
  // with the (prev) => updater shape). job.qty IS a dep so changing
  // quantity after the price re-scales the mirrored total.
  useEffect(() => {
    if (tireSource === 'Bought for this job') {
      const pp = Number(job.tirePurchasePrice || 0);
      const qty = Math.max(1, Math.floor(Number(job.qty) || 1));
      const total = pp * qty;
      if (pp && Number(job.tireCost || 0) !== total) set('tireCost', total);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.tirePurchasePrice, job.qty, tireSource]);

  // Default state to brand state on new jobs.
  //
  // Batch E (2026-06-05): one-shot seed. Omitted: isEditing (read
  // once at mount), job.state (we only seed when EMPTY — re-firing
  // on every state edit would lock the field to the brand value and
  // make user overrides impossible), brand.mainCity (read for the
  // city/area fill-in but we explicitly want re-seed to track only
  // the state change; mainCity drifting independently shouldn't
  // re-stomp the operator's chosen city). If someone adds job.state
  // to deps, the result is "field becomes read-only" because every
  // keystroke triggers a re-seed back to brand.state.
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
  // Batch C (2026-06-05): narrowed settings deps from the full
  // `settings` object to the four fields the pricing engines actually
  // read (servicePricing, vehiclePricing, freeMilesIncluded,
  // costPerMile). Prior shape recomputed on every settings mutation —
  // including unrelated changes like missedCallTemplate or
  // reviewSmsTemplate edited from another tab — which jittered the
  // breakdown panel for no visible reason. Engines verified via
  // src/config/businessTypes/pricing/{flat,laborParts,packageMult}.ts;
  // none read taxRate, so it stays out. resolveVertical reads
  // settings.businessType but that field cannot change without a full
  // page remount (BrandContext re-bootstrap), so it's safe to omit.
  //
  // Batch E (2026-06-05): the disable below is REQUIRED — eslint
  // wants the full `job` and `settings` objects in the dep list
  // because the body passes them by reference, but we deliberately
  // pass `job` to a pure function that only reads the enumerated
  // fields. "Fixing" this by widening to [job, settings] reintroduces
  // the keystroke-jitter regression Perf P1-3 fixed.
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
      settings.servicePricing, settings.vehiclePricing,
      settings.freeMilesIncluded, settings.costPerMile,
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

  // Batch C (2026-06-05): required-field gating. Pure validator lives
  // in src/lib/addJobValidation.ts and is pinned by
  // tests/addJobValidation.test.ts. Memoized on the three fields the
  // validator reads so unrelated keystrokes (customerName, note,
  // city, etc.) don't churn this object. The validator's `missing`
  // list drives the inline hint above the footer; canSave drives the
  // Save Job button's disabled state.
  const validation = useMemo(
    () => validateAddJob({
      customerPhone: job.customerPhone,
      service: job.service,
      revenue: job.revenue,
    }),
    [job.customerPhone, job.service, job.revenue],
  );

  // Batch C (2026-06-05): unified save-attempt path.
  // Both Save Job and + Another route through this so a) the
  // negative-profit confirm modal intercepts both, b) the in-flight
  // savingMode flag stays in lockstep with the actual save being
  // performed, and c) Save Job's disabled gate (validation.canSave)
  // applies before any of the modal/save plumbing fires.
  //
  // The neg-profit gate is only armed when canViewProfit is true —
  // technicians don't see profit numbers anywhere on this form, so
  // they don't see the modal either. They still save the job, the
  // owner just won't be warned at the technician's tap.
  const runSave = useCallback(async (mode: 'save' | 'saveAndNew') => {
    if (isSaving) return;
    setSavingMode(mode);
    try {
      if (mode === 'save') await onSave();
      else await onSaveAndNew();
    } finally {
      setSavingMode(null);
    }
  }, [isSaving, onSave, onSaveAndNew]);

  const attemptSave = useCallback((mode: 'save' | 'saveAndNew') => {
    if (isSaving) return;
    // Save Job (mode === 'save') is the primary CTA — block it unless
    // the required-field validation passes. + Another stays
    // permissive per spec: operators routinely swap drafts before all
    // required fields are filled.
    if (mode === 'save' && !validation.canSave) return;
    if (permissions.canViewProfit && breakdown.profit < 0) {
      // Show the modal; the actual save will fire from the
      // "Save anyway" branch in the modal's onClick.
      setNegProfitMode(mode);
      return;
    }
    void runSave(mode);
  }, [isSaving, validation.canSave, permissions.canViewProfit, breakdown.profit, runSave]);

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
  }, settings),
  // Batch C (2026-06-05): same dep-narrowing as breakdown above.
  // calcQuote reads only servicePricing / vehiclePricing /
  // freeMilesIncluded / costPerMile from settings — verified against
  // src/lib/utils.ts::calcQuote and the pricing engine entry points.
  //
  // Batch E (2026-06-05): "fixing" the disable by widening to
  // [job, settings] would recompute liveQuote on every customerName/
  // notes/city keystroke and (worse) re-stomp revenue via the mirror
  // effect at line ~574, causing the input to flicker between user
  // text and the system suggestion mid-edit. Leave narrow.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [
    job.service, job.vehicleType, job.miles, job.tireCost, job.materialCost,
    job.qty, job.emergency, job.lateNight, job.highway, job.weekend,
    job.laborHours, job.partsCost, job.diagnosticFee, job.vehicleSize,
    settings.servicePricing, settings.vehiclePricing,
    settings.freeMilesIncluded, settings.costPerMile,
  ]);

  /**
   * Apply the live suggested price to the revenue field. Used by both
   * the "Use suggested" button in the quote preview and the auto-fill
   * effect when a technician toggles surcharges. When revenue is
   * locked, we ALWAYS write the suggested to revenue so the field
   * value stays in sync with what's displayed.
   */
  //
  // Batch E (2026-06-05): job.revenue and `set` are deliberately
  // OMITTED from the dep list. job.revenue is the field we WRITE TO;
  // adding it as a dep creates a feedback loop (write revenue →
  // effect reruns → compares → writes again). `set` is a stable
  // setter (closes over setJob's (prev) => updater so no stale
  // closure risk). The two deps that DO appear — revenueLocked +
  // liveQuote.suggested — are the only signals that should cause a
  // re-mirror: lock state changed, or the suggested price moved.
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

      {/* Batch B (2026-06-05): sticky suggested-price tile removed per
          operator decision D7. Quick Pricing card below carries the
          suggested-price + breakdown panel, and the Android backdrop-
          filter blur was a known compositor jank source on low-end
          devices. liveQuote remains computed for the in-card Quick
          Pricing "Suggested" hint and the revenue-divergence button. */}

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

      {/* ─── Step 3: Vehicle ────────────────────────────────────
          Vehicle type chip-grid + detailing's vehicle-size chip
          sub-block (when the active vertical's pricing model is
          package_multiplier). Tire / mechanic verticals have
          features.vehicleSizeMultiplier === false, so the sub-block
          short-circuits to null. Batch B reorder: Vehicle moves up
          from position 9 → 4 so the operator commits to the rig
          before drilling into Service / pricing. */}
      <div className={'form-group card-anim'}>
        <div className="form-group-title"><span className="step-badge">3</span>Vehicle</div>
        <div className="chip-grid">
          {rankedVehicles.map((v) => (
            <button key={v} className={'chip' + (job.vehicleType === v ? ' active' : '')}
              onClick={() => set('vehicleType', v)} type="button">{v}</button>
          ))}
        </div>
        {vertical.features.vehicleSizeMultiplier && vehicleSizes.length > 0 && (
          <div className="field" style={{ marginTop: 8 }}>
            <label id="addjob-vehicle-size-label">Vehicle size</label>
            <div className="chip-grid" role="group" aria-labelledby="addjob-vehicle-size-label">
              {vehicleSizes.map((sz) => (
                <button
                  key={sz}
                  type="button"
                  className={'chip' + (job.vehicleSize === sz ? ' active' : '')}
                  aria-pressed={job.vehicleSize === sz}
                  onClick={() => set('vehicleSize', sz)}
                >{sz}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ─── Step 4: Service ────────────────────────────────────
          Primary package picker + detailing add-ons multi-select
          (when the vertical declares add-on services). enabledAddOns
          is empty for tire / mechanic so the add-ons sub-block is
          null for them. */}
      <div className={'form-group card-anim'}>
        <div className="form-group-title"><span className="step-badge">4</span>{vertical.copy.packageLabel || 'Service'}</div>
        <ServicePicker
          services={vertical.services}
          enabledIds={enabledPackages}
          selected={job.service}
          onSelect={(id) => set('service', id)}
          jobs={jobs}
        />
        {enabledAddOns.length > 0 && (
          <div className="field" style={{ marginTop: 8 }}>
            <label id="addjob-addons-label">
              Add-ons{' '}
              <span style={{ fontWeight: 400, color: 'var(--t3)', fontSize: 11 }}>
                (tap any that apply)
              </span>
            </label>
            <div className="chip-grid" role="group" aria-labelledby="addjob-addons-label">
              {enabledAddOns.map((id) => {
                const selected = (job.detailingAddons ?? []).includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={'chip' + (selected ? ' active' : '')}
                    aria-pressed={selected}
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
      </div>

      {/* ─── Step 5: Job Details ────────────────────────────────
          One badge covers a stack of vertical-aware sub-blocks:
            - Tire Details bespoke block (when needsTireDetails)
            - Vertical jobFields loop (when !showTireBlock && vertical
              declares jobFields — mechanic / detailing)
            - PartsSection (mechanic only)
            - General Quantity + Material + Conditions block
          Each sub-block keeps its existing conditional gate so the
          render contract is unchanged. */}
      {needsTireDetails && (
        <div className="form-group card-anim">
          <div className="form-group-title"><span className="step-badge">5</span>Tire Details</div>
          {/* Batch C (2026-06-05): Qty removed from this block — it
              now lives in Job Details below as the sole source of
              truth. Same MemoInput + fieldSetters.qty so behavior is
              unchanged; just one field instead of two-in-sync. */}
          <div className="field">
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

      {/* Vertical-specific job fields, rendered for any vertical
          whose UI is NOT the tire bespoke block. Mechanic gets
          Vehicle Make/Model, Mileage, Diagnostic Code, Labor Hours,
          Parts Cost. Detailing gets Vehicle Size (when populated in
          2.3). Tire's jobFields (tireSize/tireCondition/wheelLock-
          Removed) are already covered by the bespoke block above,
          so we suppress the loop here for tire. */}
      {!showTireBlock && vertical.jobFields.length > 0 && (
        <div className={'form-group card-anim'}>
          <div className="form-group-title">
            {!needsTireDetails && <span className="step-badge">5</span>}
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

      {/* General Job Details: quantity (non-tire only) + material
          cost + conditions chip-grid. The step badge here only fires
          when neither needsTireDetails nor the vertical jobFields
          block rendered above — otherwise the "5" badge already lives
          on one of those earlier sub-blocks for this vertical. */}
      <div className="form-group card-anim">
        <div className="form-group-title">
          {!needsTireDetails && !(!showTireBlock && vertical.jobFields.length > 0) && (
            <span className="step-badge">5</span>
          )}
          Job Details
        </div>
        <div className="field-row">
          {/* Batch C (2026-06-05): Quantity is now ALWAYS rendered
              here as the single source of truth for `qty`. Prior
              code split it across two locations (Tire Details +
              this block) gated by needsTireDetails, which made the
              two inputs drift out of sync if a service flipped
              mid-edit. */}
          <div className={'field'}>
            <label htmlFor="addjob-qty">Quantity</label>
            <MemoInput id="addjob-qty" type="number" inputMode="numeric" value={job.qty} onChange={fieldSetters.qty} placeholder="1" />
          </div>
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
            {/* Batch E (2026-06-05): wrap the leading emoji glyph in
                <span aria-hidden="true"> via splitEmojiLabel so screen
                readers announce "Emergency" instead of "fire engine
                emoji Emergency". Visual rendering unchanged — the
                emoji still appears in the same spot — only the AT
                tree changes. Helper handles VS-16 / skin-tone /
                no-emoji passthrough; see tests/emojiLabel.test.ts. */}
            {(vertical.conditions ?? [
              { key: 'emergency' as const, label: '🚨 Emergency' },
              { key: 'lateNight' as const, label: '🌙 Late Night' },
              { key: 'highway' as const,   label: '🛣️ Highway' },
              { key: 'weekend' as const,   label: '📅 Weekend' },
            ]).map(({ key: k, label: l }) => {
              const { emoji, text } = splitEmojiLabel(l);
              return (
                <button key={k} type="button" className={'chip' + (job[k] ? ' active' : '')} aria-pressed={!!job[k]} onClick={() => set(k, !job[k])}>
                  {emoji && <span aria-hidden="true">{emoji} </span>}{text || l}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ─── Step 6: Location ──────────────────────────────────
          AddressAutofillInput owns ZIP + city + state + addressLine
          per spec §"AddJob Workflow Change → step 7". Replaces the
          prior City-only Customer-card field. Batch B reorder moves
          Location down from above Quick Pricing so the operator
          locks in WHERE before they think about HOW MUCH. */}
      <div className="form-group card-anim">
        <div className="form-group-title"><span className="step-badge">6</span>Location</div>
        <AddressAutofillInput value={addressValue} onChange={onAddressChange} />
      </div>

      {/* ─── Step 7: Quick Pricing ─────────────────────────────
          Miles + tire cost + revenue + the vertical-aware breakdown
          panel. Batch B reorder: moved from position 4 (just after
          Customer details) to position 7 so the operator establishes
          vehicle / service / job details / location FIRST — all the
          inputs that drive the suggested price — and only then sees
          the resulting number. Avoids the prior pattern of staring
          at $0 while filling everything else in. */}
      <div className="form-group card-anim">
        <div className="form-group-title"><span className="step-badge">7</span>Quick Pricing</div>
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
            revenue input above to set the price. */}
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

      {/* ─── Step 8: Lead & Payment + Assignment ────────────────
          Lead source + payment method + job/payment status chips,
          plus the AssignmentPicker at the bottom (when canAssign).
          Batch B reorder moves AssignmentPicker into this block so
          team management lives next to the rest of the post-completion
          metadata instead of floating mid-form. */}
      <div className="form-group card-anim">
        <div className="form-group-title"><span className="step-badge">8</span>Lead & Payment</div>
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
        {/* Batch C (2026-06-05): Job Status + Payment Status default
            collapsed. The vast majority of jobs are logged as
            "Completed · Paid" (the EMPTY_JOB defaults), so showing a
            7-chip stack at all times wasted scroll on the rare edit.
            Tap the summary row to expand both editors inline. Once
            expanded, they stay open for the form's lifetime. */}
        {!statusExpanded ? (
          <button
            type="button"
            className="field"
            onClick={() => setStatusExpanded(true)}
            aria-label="Edit job status and payment status"
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              background: 'transparent', border: 'none', padding: '8px 0',
              color: 'var(--t2)', fontSize: 12, cursor: 'pointer',
            }}
          >
            <span style={{ color: 'var(--t3)', fontWeight: 600 }}>Status: </span>
            <span style={{ color: 'var(--t1)', fontWeight: 600 }}>{job.status}</span>
            <span style={{ color: 'var(--t3)' }}> · </span>
            <span style={{ color: 'var(--t1)', fontWeight: 600 }}>{job.paymentStatus}</span>
            <span style={{ color: 'var(--t3)', marginLeft: 8 }}>tap to edit</span>
          </button>
        ) : (
          <>
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
          </>
        )}
        {canAssign && (
          <AssignmentPicker
            value={job.assignedToUid}
            onChange={(uid) => setJob((prev) => ({ ...prev, assignedToUid: uid }))}
            members={businessMembers}
            currentUid={currentUid}
          />
        )}
      </div>

      {/* Batch C (2026-06-05): Notes textarea collapsed behind a
          "+ Add notes" button by default. Used on a minority of jobs;
          previously cost ~110px of scroll regardless of use. When
          editing an existing job that already has notes, we
          initialize `notesExpanded` to true in state so the operator
          doesn't have to tap through to see content. */}
      <div className="form-group card-anim">
        <div className="form-group-title"><span className="step-badge">9</span>Notes</div>
        {notesExpanded ? (
          <div className={'field'}>
            <textarea
              value={job.note}
              onChange={(e) => set('note', e.target.value)}
              placeholder="Any special details for this job…"
              autoFocus
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setNotesExpanded(true)}
            aria-label="Add notes to this job"
            style={{
              display: 'block', width: '100%', padding: '12px',
              background: 'transparent',
              border: '1px dashed var(--border2)',
              borderRadius: 10,
              color: 'var(--t2)', fontSize: 13, fontWeight: 600,
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            ＋ Add notes
          </button>
        )}
      </div>

      <div className="save-footer-spacer" />
      {/* Batch C (2026-06-05): Inline "Missing: …" hint sits above the
          footer when the required-field validation fails. Renders
          nothing when the form is complete. Terse to keep it under
          50 chars on a phone — phone/service/revenue. */}
      {!validation.canSave && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            left: 0, right: 0,
            // Sit just above the save-footer bar (which docks to
            // var(--safe-bot) and is ~68px tall including padding).
            bottom: 'calc(68px + var(--safe-bot))',
            padding: '6px 16px',
            background: 'var(--s2)',
            borderTop: '1px solid var(--border)',
            color: 'var(--t3)',
            fontSize: 11,
            fontWeight: 600,
            textAlign: 'center',
            zIndex: 39,
          }}
        >
          Missing: {validation.missing.join(', ')}
        </div>
      )}
      <div className="save-footer">
        <div className="save-footer-inner">
          {/* Batch B (2026-06-05): Profit pill is now gated on
              canViewProfit. Technicians (canViewProfit false) saw the
              owner's profit number on every save before — a leak that
              also pushed the save buttons into a cramped row on
              narrow phones. With the pill hidden, Cancel / Another /
              Save use the freed-up horizontal space cleanly. */}
          {permissions.canViewProfit && (
            <div className="save-footer-meta">
              <div className="save-footer-label">Profit</div>
              <div className={'save-footer-value ' + (breakdown.profit >= 0 ? 'green' : 'red')}>{money(breakdown.profit)}</div>
            </div>
          )}
          {/* Batch B: Cancel button — bottom-nav is hidden on the Add
              tab so this is the only escape route off the form. Calls
              the onCancel prop wired in App.tsx to reset the draft +
              setTab('dashboard'). */}
          <button
            className="btn secondary"
            type="button"
            disabled={isSaving}
            onClick={() => { if (!isSaving) onCancel(); }}
            style={{
              minWidth: 80,
              opacity: isSaving ? 0.5 : 1,
              cursor: isSaving ? 'not-allowed' : 'pointer',
              transition: 'opacity 120ms ease',
            }}
            aria-label="Cancel and return to dashboard"
          >
            Cancel
          </button>
          {!isEditing && (
            <button
              className="btn secondary"
              disabled={isSaving}
              aria-busy={savingMode === 'saveAndNew'}
              onClick={() => attemptSave('saveAndNew')}
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
          {/* Batch C (2026-06-05): Save Job disabled until validation
              passes. The de-emphasized opacity + cursor mirrors the
              .btn.primary:disabled rule in app.css (opacity: .5) so
              the button reads as unavailable even on browsers where
              the disabled attribute alone isn't visually obvious. */}
          <button
            className="btn primary"
            disabled={isSaving || !validation.canSave}
            aria-busy={savingMode === 'save'}
            aria-disabled={!validation.canSave || isSaving}
            onClick={() => attemptSave('save')}
            style={{
              minWidth: 120,
              opacity: (isSaving && savingMode !== 'save') || !validation.canSave ? 0.55 : 1,
              cursor: isSaving || !validation.canSave ? 'not-allowed' : 'pointer',
              transition: 'opacity 120ms ease',
            }}
          >
            {savingMode === 'save' ? 'Saving…' : (isEditing ? 'Update Job' : 'Save Job')}
          </button>
        </div>
      </div>

      {/* Batch C (2026-06-05): Negative-profit confirm modal.
          Owner/admin tapping Save (or + Another) on a job whose
          breakdown.profit is negative get a one-tap confirm before
          the save fires. Backdrop blocks clicks; the modal itself
          sits above the save-footer (z-index 60 vs the footer's
          40). Cancel routes back to the form unchanged; Save anyway
          resumes the original save mode. Technicians (canViewProfit
          false) never see this — they don't see the breakdown panel
          either, so the gating is consistent. */}
      {negProfitMode !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="neg-profit-title"
          aria-describedby="neg-profit-body"
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 60,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
          onClick={(e) => { if (e.target === e.currentTarget && !isSaving) setNegProfitMode(null); }}
        >
          <div
            style={{
              background: 'var(--s1)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 20,
              maxWidth: 320,
              width: '100%',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              color: 'var(--t1)',
            }}
          >
            <div
              id="neg-profit-title"
              style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}
            >
              Save at a loss?
            </div>
            <div
              id="neg-profit-body"
              style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.5, marginBottom: 16 }}
            >
              This job's profit is <span style={{ color: 'var(--red, #ef4444)', fontWeight: 700 }}>{money(breakdown.profit)}</span>.
              Confirm you want to save it?
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn secondary"
                disabled={isSaving}
                onClick={() => setNegProfitMode(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={isSaving}
                aria-busy={isSaving}
                onClick={async () => {
                  const mode = negProfitMode;
                  setNegProfitMode(null);
                  if (mode) await runSave(mode);
                }}
              >
                Save anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
