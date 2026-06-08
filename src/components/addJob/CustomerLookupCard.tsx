// src/components/addJob/CustomerLookupCard.tsx
// ═══════════════════════════════════════════════════════════════════
//  CustomerLookupCard — phone-first returning-customer surface.
//
//  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
//        §"AddJob Workflow Change → Returning Customer card spec"
//
//  Renders five state variants:
//    - idle      (phone empty or partially typed)
//    - searching (debounce + lookup in flight)
//    - found     (returning customer hero card)
//    - miss      ("no match — continue as new")
//    - error     (lookup threw)
//
//  The phone INPUT lives in AddJob Step 1 — this component does not
//  render its own phone field. It takes rawPhone as a prop and owns
//  the 250ms debounce + lookup invocation only. This split keeps the
//  P1-3 keystroke-storm contract intact.
//
//  v1 scope (SP2): Use Customer + Repeat Last Service buttons are
//  fully wired. View History button is rendered DISABLED — its
//  target route (/customers/{customerId}) lands in SP3.
// ═══════════════════════════════════════════════════════════════════

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { formatPhoneForDisplay, normalizePhone } from '@/lib/phone';
import { lookupCustomerByPhone, type LookupResult, type LookupLastJob } from '@/lib/lookupCustomerByPhone';
import { deriveVipTier } from '@/lib/customerInsights';
import type { Customer, Vehicle } from '@/lib/customerEntity';

/** Pure patch produced by the card; AddJob merges it into the job draft. */
export interface UseCustomerPatch {
  customerId?: string;
  vehicleId?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  city?: string;
  state?: string;
  addressLine?: string;
  zipCode?: string;
  vehicleType?: string;
  vehicleMakeModel?: string;
  tireSize?: string;
  // Repeat Last Service only:
  service?: string;
  vehicleSize?: string;
  tireBrand?: string;
  qty?: string | number;
}

interface Props {
  businessId: string;
  rawPhone: string;
  onApplyPatch: (patch: UseCustomerPatch) => void;
  onContinueAsNew?: () => void;
}

type CardState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'found'; customer: Customer; vehicles: Vehicle[]; lastJob: LookupLastJob | null; lookupLatencyMs: number }
  | { kind: 'miss'; formattedPhone: string }
  | { kind: 'error'; error: Error };

function _deriveCardState(args: {
  rawPhone: string;
  lookupInFlight: boolean;
  lookupResult: LookupResult | null;
  error: Error | null;
}): CardState {
  if (args.error) return { kind: 'error', error: args.error };
  const n = normalizePhone(args.rawPhone);
  if (!n.valid) return { kind: 'idle' };
  if (args.lookupInFlight) return { kind: 'searching' };
  if (!args.lookupResult) return { kind: 'miss', formattedPhone: n.formatted };
  return {
    kind: 'found',
    customer: args.lookupResult.customer,
    vehicles: args.lookupResult.vehicles,
    lastJob: args.lookupResult.lastJob,
    lookupLatencyMs: args.lookupResult.lookupLatencyMs,
  };
}

function _deriveUseCustomerPatch(customer: Customer, vehicle: Vehicle | null): UseCustomerPatch {
  const patch: UseCustomerPatch = {
    customerId: customer.id,
    customerName: customer.name,
    customerPhone: customer.phoneE164 ? formatPhoneForDisplay(customer.phoneE164) : undefined,
  };
  if (customer.email)         patch.customerEmail = customer.email;
  if (customer.city)          patch.city          = customer.city;
  if (customer.state)         patch.state         = customer.state;
  if (customer.addressLine)   patch.addressLine   = customer.addressLine;
  if (customer.zipCode)       patch.zipCode       = customer.zipCode;
  if (vehicle) {
    patch.vehicleId = vehicle.id;
    if (vehicle.vehicleType)      patch.vehicleType      = vehicle.vehicleType;
    if (vehicle.vehicleMakeModel) patch.vehicleMakeModel = vehicle.vehicleMakeModel;
    else if (vehicle.make && vehicle.model) patch.vehicleMakeModel = `${vehicle.make} ${vehicle.model}`;
    if (vehicle.tireSize)         patch.tireSize         = vehicle.tireSize;
  }
  return patch;
}

function _deriveRepeatLastServicePatch(
  customer: Customer,
  vehicle: Vehicle | null,
  lastJob: LookupLastJob,
): UseCustomerPatch {
  const patch = _deriveUseCustomerPatch(customer, vehicle);
  if (lastJob.service)          patch.service          = lastJob.service;
  if (lastJob.vehicleMakeModel) patch.vehicleMakeModel = lastJob.vehicleMakeModel;
  if (lastJob.vehicleType)      patch.vehicleType      = lastJob.vehicleType;
  if (lastJob.tireSize)         patch.tireSize         = lastJob.tireSize;
  if (lastJob.city && !patch.city) patch.city = lastJob.city;
  // Per spec: do NOT copy revenue, tireCost, materialCost, note,
  // parts, photos, timeSessions, inventoryDeductions, paymentStatus,
  // status, createdAt, lastEditedAt.
  return patch;
}

function _formatRelativeWeeks(iso: string | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const days = Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
  if (days < 1)   return 'today';
  if (days < 7)   return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8)  return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 24) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function CustomerLookupCardImpl({ businessId, rawPhone, onApplyPatch, onContinueAsNew }: Props) {
  const [lookupInFlight, setLookupInFlight] = useState(false);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [pickedVehicleId, setPickedVehicleId] = useState<string | null>(null);
  const seqRef = useRef(0);

  // Debounced lookup — 250ms after the last keystroke that produces
  // a valid phone, fire one query. Out-of-order responses dropped
  // via a monotonic seq counter.
  useEffect(() => {
    const n = normalizePhone(rawPhone);
    if (!n.valid) {
      setLookupResult(null);
      setError(null);
      setLookupInFlight(false);
      return;
    }
    const handle = window.setTimeout(() => {
      const seq = ++seqRef.current;
      setLookupInFlight(true);
      setError(null);
      lookupCustomerByPhone(businessId, rawPhone)
        .then((res) => {
          if (seq !== seqRef.current) return;
          setLookupResult(res);
          setLookupInFlight(false);
        })
        .catch((e: unknown) => {
          if (seq !== seqRef.current) return;
          setError(e instanceof Error ? e : new Error(String(e)));
          setLookupInFlight(false);
        });
    }, 250);
    return () => window.clearTimeout(handle);
  }, [businessId, rawPhone]);

  const state = useMemo(
    () => _deriveCardState({ rawPhone, lookupInFlight, lookupResult, error }),
    [rawPhone, lookupInFlight, lookupResult, error],
  );

  if (state.kind === 'idle') return null;

  if (state.kind === 'searching') {
    return (
      <div className="form-group card-anim" style={{ opacity: 0.85 }}>
        <div className="form-group-title">Looking up customer…</div>
        <div className="info-banner">Searching directory by phone…</div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="form-group card-anim">
        <div className="form-group-title">Customer lookup failed</div>
        <div className="info-banner" style={{ background: 'var(--warn-bg)' }}>
          Couldn&apos;t reach the directory. Continue typing customer info manually.
        </div>
      </div>
    );
  }

  if (state.kind === 'miss') {
    return (
      <div className="form-group card-anim">
        <div className="form-group-title">No match for {state.formattedPhone}</div>
        <button
          type="button"
          className="btn sm secondary"
          onClick={onContinueAsNew}
        >
          Continue as new customer
        </button>
      </div>
    );
  }

  // ─── found ─────────────────────────────────────────────────────
  const { customer, vehicles, lastJob, lookupLatencyMs } = state;
  const selectedVehicle = vehicles.find((v) => v.id === pickedVehicleId) ?? vehicles[0] ?? null;
  const vipTier = deriveVipTier(Number(customer.lifetimeRevenue ?? 0));
  const lastSeen = _formatRelativeWeeks(customer.lastJobAt);

  const onUseCustomer = () => {
    onApplyPatch(_deriveUseCustomerPatch(customer, selectedVehicle));
  };
  const onRepeatLastService = () => {
    if (!lastJob) return;
    onApplyPatch(_deriveRepeatLastServicePatch(customer, selectedVehicle, lastJob));
  };

  return (
    <div className="form-group card-anim" data-lookup-latency-ms={lookupLatencyMs}>
      <div className="form-group-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span>Returning Customer</span>
        {lastSeen && <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 400 }}>Last seen {lastSeen}</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--t1)' }}>{customer.name}</div>
        {vipTier !== 'Standard' && (
          <span className="chip" style={{ fontSize: 10, padding: '2px 8px', background: vipTier === 'Platinum' ? '#b5a5e8' : '#d4af37', color: '#1a1a1a' }}>
            {vipTier}
          </span>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 4 }}>
        {customer.phoneE164 ? formatPhoneForDisplay(customer.phoneE164) : ''}
        {customer.email ? ` · ${customer.email}` : ''}
      </div>
      {(customer.city || customer.state) && (
        <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 8 }}>
          {customer.city}{customer.city && customer.state ? ', ' : ''}{customer.state}
        </div>
      )}

      {vehicles.length > 0 && (
        <div className="field" style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 4 }}>Vehicles</div>
          <div className="chip-grid">
            {vehicles.map((v) => {
              const label = [
                v.year, v.make, v.model, v.tireSize ? `· ${v.tireSize}` : '',
              ].filter(Boolean).join(' ').trim() || v.vehicleMakeModel || v.id;
              const active = (selectedVehicle?.id === v.id);
              return (
                <button
                  key={v.id}
                  type="button"
                  className={'chip' + (active ? ' active' : '')}
                  onClick={() => setPickedVehicleId(v.id)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {lastJob && (
        <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 8 }}>
          Last service: {lastJob.service ?? '—'}
          {lastJob.revenue !== undefined ? ` · $${Number(lastJob.revenue).toFixed(0)}` : ''}
          {lastJob.paymentStatus ? ` · ${lastJob.paymentStatus}` : ''}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11, color: 'var(--t3)', marginBottom: 10 }}>
        <span>{customer.jobCount ?? 0} jobs</span>
        {customer.lifetimeRevenue !== undefined && <span>· ${Number(customer.lifetimeRevenue).toFixed(0)} lifetime</span>}
      </div>

      {(customer.note || customer.gateCode || customer.apartmentNumber || customer.wheelLockKeyLocation || customer.tpmsNotes || customer.preferredPaymentMethod || customer.parkingInstructions || customer.preferredContactMethod || customer.generalNotes) && (
        <div className="info-banner" style={{ marginBottom: 10, fontSize: 11 }}>
          {customer.note && <div>{customer.note}</div>}
          {customer.gateCode && <div><strong>Gate:</strong> {customer.gateCode}</div>}
          {customer.apartmentNumber && <div><strong>Apt:</strong> {customer.apartmentNumber}</div>}
          {customer.wheelLockKeyLocation && <div><strong>Wheel-lock key:</strong> {customer.wheelLockKeyLocation}</div>}
          {customer.tpmsNotes && <div><strong>TPMS:</strong> {customer.tpmsNotes}</div>}
          {customer.preferredPaymentMethod && <div><strong>Pays via:</strong> {customer.preferredPaymentMethod}</div>}
          {customer.parkingInstructions && <div><strong>Parking:</strong> {customer.parkingInstructions}</div>}
          {customer.preferredContactMethod && <div><strong>Prefers:</strong> {customer.preferredContactMethod}</div>}
          {customer.generalNotes && <div>{customer.generalNotes}</div>}
        </div>
      )}

      {/* Fast path first: "Repeat Last Service" prefills the most (identity
          + service + vehicle + tire + city) — the one-tap log for a
          returning customer's repeat job. "Use Customer" fills identity
          only, for when they want a different service. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {lastJob ? (
          <>
            <button type="button" className="btn sm primary" onClick={onRepeatLastService}>
              Repeat Last Job
            </button>
            <button type="button" className="btn sm secondary" onClick={onUseCustomer}>Use Customer</button>
          </>
        ) : (
          <button type="button" className="btn sm primary" onClick={onUseCustomer}>Use Customer</button>
        )}
      </div>
    </div>
  );
}

export const CustomerLookupCard = memo(CustomerLookupCardImpl);

/** Pure-derivation hooks — test-only. */
export const __pureHooks = {
  deriveCardState: _deriveCardState,
  deriveUseCustomerPatch: _deriveUseCustomerPatch,
  deriveRepeatLastServicePatch: _deriveRepeatLastServicePatch,
};
