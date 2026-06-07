// src/components/addJob/AddressAutofillInput.tsx
// ═══════════════════════════════════════════════════════════════════
//  AddressAutofillInput — Street-first roadside-ergonomic address.
//
//  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
//        §"AddJob Workflow Change → step 7"
//        §"AddressAutofillInput.tsx" component spec
//        + Batch D (2026-06-05): Street-first reorder + GPS chip
//
//  v1 contract (Batch D update):
//    - Field order is now Street → ZIP → City → State. The technician
//      types from their location: address first (no autofill source
//      anyway), ZIP next (which still triggers the city/state autofill
//      against the bundled usZips dataset), then City + State surface
//      already populated (editable for cross-state edge cases).
//    - "📍 Use my location" chip lives ABOVE the Street field so it's
//      the first tappable thing in the section. Tapping reverse-
//      geocodes via OpenStreetMap Nominatim (no API key, free tier).
//      All four fields are filled from the geocode on success; partial
//      hits fill what's available and leave the rest blank.
//    - Geolocation errors (denied / timeout / unsupported) and
//      Nominatim failures degrade to an inline message under the chip
//      ("Location unavailable. Type address below."). No browser
//      alert(). Operator can still type the address normally.
//    - If `navigator.geolocation` is unavailable entirely (very old
//      browser, non-HTTPS context) the chip hides itself rather than
//      rendering a broken control.
//    - addressLine is still free-text — no street-level validation.
//    - On unknown ZIP, the city/state stay whatever the operator had
//      (no clobber); a "ZIP not recognized — type city manually" hint
//      renders inline next to ZIP.
//
//  Re-used in SP3's CustomerProfile edit mode — surface-agnostic.
//
//  Inputs use MemoInput per the P1-3 keystroke-storm contract. The
//  parent MUST pass a useCallback-stable `onChange` setter.
//
//  Prop interface is unchanged from Batch C — Batch D only reshapes
//  internals + adds the GPS chip. AddJob.tsx integration is identical.
// ═══════════════════════════════════════════════════════════════════

import { memo, useCallback, useMemo, useState } from 'react';
import { MemoInput } from '@/components/addJob/MemoInput';
import { isValidUsZip, lookupZip } from '@/lib/usZips';
import { US_STATES } from '@/lib/locations';

export interface AddressValue {
  addressLine: string;
  city: string;
  state: string;
  zipCode: string;
  /** GPS coordinates, set ONLY when "Use my location" geolocation
   *  succeeds (Bandilero Phase 2). Undefined for manually-typed
   *  addresses — Dispatch stays NOT_CONNECTED without them. */
  lat?: number;
  lng?: number;
}

interface Props {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  disabled?: boolean;
  /** Optional id-prefix to scope label-for/input-id pairs when the
   *  component renders more than once on a page. */
  idPrefix?: string;
}

function _derivePatchOnZipChange(prev: AddressValue, raw: string): AddressValue {
  const trimmed = raw.trim();
  const next: AddressValue = { ...prev, zipCode: trimmed };
  if (isValidUsZip(trimmed)) {
    const hit = lookupZip(trimmed);
    if (hit) {
      next.city = hit.city;
      next.state = hit.state;
    }
    // Unknown 5-digit ZIP: preserve operator-typed city/state.
  }
  // Partial / empty: preserve city/state untouched.
  return next;
}

function _derivePatchOnAddressLineChange(prev: AddressValue, raw: string): AddressValue {
  return { ...prev, addressLine: raw };
}

function _derivePatchOnCityChange(prev: AddressValue, raw: string): AddressValue {
  return { ...prev, city: raw };
}

function _derivePatchOnStateChange(prev: AddressValue, raw: string): AddressValue {
  return { ...prev, state: raw.toUpperCase().slice(0, 2) };
}

/**
 * Canonical field order rendered by AddressAutofillInput.
 * Batch D moved Street to position 1 so the technician's first
 * keystroke matches what they actually know from looking around.
 * Exported for tests; consumed only by the component below.
 */
export const ADDRESS_FIELD_ORDER = ['addressLine', 'zipCode', 'city', 'state'] as const;
export type AddressFieldKey = typeof ADDRESS_FIELD_ORDER[number];

// ─── Nominatim reverse-geocode helpers ────────────────────────────
// PUBLIC-DOMAIN FREE TIER: https://nominatim.openstreetmap.org/reverse
// No API key required. Browser fetches strip the User-Agent header
// (Nominatim formally asks for one), but the free endpoint serves
// anonymous browser traffic at the documented rate limit of 1 rps —
// far above what a single technician taps "Use my location" at on
// a job site. If we ever bulk-call this from a server we'd need to
// route through a worker that adds the UA.

/**
 * Shape of the subset of fields we read from a Nominatim
 * `format=jsonv2` reverse response. The full schema is much larger;
 * we only extract what we need.
 */
export interface NominatimReverseResponse {
  address?: {
    house_number?: string;
    road?: string;
    pedestrian?: string;
    footway?: string;
    cycleway?: string;
    path?: string;
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    suburb?: string;
    state?: string;
    postcode?: string;
  };
}

/** Build a `lat=…&lon=…` query for Nominatim with sensible defaults. */
export function buildNominatimReverseUrl(lat: number, lon: number): string {
  // `addressdetails=1` is implicit at `format=jsonv2` but we set it
  // explicitly so the contract doesn't drift if Nominatim changes
  // defaults. `zoom=18` is street-level — good for roadside.
  return `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=1`;
}

/** Build a state-name → USPS-code map once. */
const STATE_NAME_TO_CODE: Readonly<Record<string, string>> = (() => {
  const out: Record<string, string> = {};
  for (const s of US_STATES) out[s.name.toLowerCase()] = s.code;
  return out;
})();

/**
 * Normalize a Nominatim address payload into our AddressValue shape.
 * Partial responses are tolerated: any missing field is returned as
 * an empty string and the caller decides whether to overwrite.
 *
 * Street is composed as "<house_number> <road>" when both exist; if
 * only one is present we still surface it (so "Main St" without a
 * number is better than nothing for a roadside tech who can fill in
 * the number themselves).
 *
 * State conversion prefers a USPS 2-letter code: "Florida" → "FL".
 * If the response state isn't a recognized US state, we pass the
 * raw value through (and the existing onStateChange clamp will trim
 * it to 2 chars + uppercase).
 */
export function parseNominatimAddress(resp: NominatimReverseResponse | null | undefined): AddressValue {
  const empty: AddressValue = { addressLine: '', city: '', state: '', zipCode: '' };
  if (!resp || !resp.address) return empty;
  const a = resp.address;

  // Street: prefer road, then pedestrian/footway for genuinely
  // non-road locations (parking lots, alleys) where a roadside tech
  // might still get dispatched.
  const street = a.road || a.pedestrian || a.footway || a.cycleway || a.path || '';
  const num = a.house_number ? a.house_number.trim() : '';
  const addressLine = street ? (num ? `${num} ${street}` : street) : '';

  // City: cascading fallback. Nominatim often returns town/village
  // for non-metro addresses; suburb is the last resort to avoid an
  // empty city when the operator is in a named neighborhood.
  const city = a.city || a.town || a.village || a.hamlet || a.suburb || '';

  // State: Nominatim returns full name. Map to USPS code.
  let state = '';
  if (a.state) {
    const code = STATE_NAME_TO_CODE[a.state.toLowerCase()];
    state = code || a.state;
  }

  // ZIP: Nominatim may return ZIP+4 ("12345-6789"); take the first
  // 5 digits to match isValidUsZip and trigger the autofill effect.
  let zipCode = '';
  if (a.postcode) {
    const m = a.postcode.match(/^\d{5}/);
    zipCode = m ? m[0] : '';
  }

  return { addressLine, city, state, zipCode };
}

/**
 * Merge a geocoded AddressValue into an existing draft. Empty fields
 * in the geocode do NOT clobber existing operator-typed values — if
 * Nominatim didn't return a house number but the tech typed one
 * before tapping the chip, we keep their input.
 */
export function mergeGeocodedAddress(prev: AddressValue, geo: AddressValue): AddressValue {
  return {
    addressLine: geo.addressLine || prev.addressLine,
    city: geo.city || prev.city,
    state: geo.state ? geo.state.toUpperCase().slice(0, 2) : prev.state,
    zipCode: geo.zipCode || prev.zipCode,
  };
}

// ─── Component ────────────────────────────────────────────────────

type GpsState =
  | { kind: 'idle' }
  | { kind: 'detecting' }
  | { kind: 'error'; message: string };

function AddressAutofillInputImpl({ value, onChange, disabled, idPrefix }: Props) {
  const p = idPrefix ?? 'addr';
  const onZipChange = useCallback((raw: string) => onChange(_derivePatchOnZipChange(value, raw)), [value, onChange]);
  const onAddrChange = useCallback((raw: string) => onChange(_derivePatchOnAddressLineChange(value, raw)), [value, onChange]);
  const onCityChange = useCallback((raw: string) => onChange(_derivePatchOnCityChange(value, raw)), [value, onChange]);
  const onStateChange = useCallback((raw: string) => onChange(_derivePatchOnStateChange(value, raw)), [value, onChange]);

  const zipHint = useMemo(() => {
    const z = value.zipCode.trim();
    if (z.length === 0) return '';
    if (!isValidUsZip(z)) return ''; // mid-typing, no hint yet
    if (lookupZip(z)) return '';     // known ZIP, autofilled
    return 'ZIP not recognized — type city manually below';
  }, [value.zipCode]);

  // ── GPS chip state ─────────────────────────────────────────────
  // We render the chip only when navigator.geolocation exists. On
  // non-HTTPS or very old contexts the API may be undefined entirely;
  // hiding the chip beats rendering a control that throws on tap.
  const geolocationAvailable = typeof navigator !== 'undefined' && !!navigator.geolocation;
  const [gps, setGps] = useState<GpsState>({ kind: 'idle' });

  const onUseMyLocation = useCallback(() => {
    if (!geolocationAvailable) return;
    setGps({ kind: 'detecting' });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const url = buildNominatimReverseUrl(pos.coords.latitude, pos.coords.longitude);
          // No custom headers — browser strips User-Agent and any
          // x-* header would trigger a preflight that Nominatim
          // doesn't whitelist. Plain GET it is.
          const res = await fetch(url, { method: 'GET' });
          if (!res.ok) throw new Error(`nominatim ${res.status}`);
          const data: NominatimReverseResponse = await res.json();
          const geo = parseNominatimAddress(data);
          // Idempotent: if Nominatim returned a known ZIP, our city/
          // state from the lookupZip table take precedence. If it
          // returned an unknown ZIP, our parsed city/state win. We
          // run the merged geocode through the ZIP-change derivator
          // last so the autofill effect still fires.
          const mergedFromGeo = mergeGeocodedAddress(value, geo);
          const withZipAutofill = geo.zipCode
            ? _derivePatchOnZipChange(mergedFromGeo, geo.zipCode)
            : mergedFromGeo;
          // Capture the raw coordinates alongside the resolved address
          // (Bandilero Phase 2 Dispatch). Only set on a successful GPS
          // fix — manual typing never carries coords.
          onChange({ ...withZipAutofill, lat: pos.coords.latitude, lng: pos.coords.longitude });
          setGps({ kind: 'idle' });
        } catch {
          setGps({ kind: 'error', message: 'Location unavailable. Type address below.' });
        }
      },
      () => {
        // Permission denied / position unavailable / timeout — same
        // user-facing message regardless. Tech doesn't care which.
        setGps({ kind: 'error', message: 'Location unavailable. Type address below.' });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }, [geolocationAvailable, value, onChange]);

  const isDetecting = gps.kind === 'detecting';
  const chipLabel = isDetecting ? '📍 Detecting…' : '📍 Use my location';
  const chipDisabled = disabled || isDetecting;

  return (
    <div className="form-group card-anim">
      <div className="form-group-title">Location</div>

      {geolocationAvailable && (
        <div className="addr-gps-row">
          <button
            type="button"
            className="chip addr-gps-chip"
            onClick={onUseMyLocation}
            disabled={chipDisabled}
            aria-label="Use my current location to fill the address"
            aria-busy={isDetecting}
          >
            {chipLabel}
          </button>
          {gps.kind === 'error' && (
            <div className="info-banner addr-gps-error" role="status">
              {gps.message}
            </div>
          )}
        </div>
      )}

      <div className="field">
        <label htmlFor={`${p}-line`}>Street address</label>
        <MemoInput
          id={`${p}-line`}
          type="text"
          autoComplete="address-line1"
          value={value.addressLine}
          onChange={onAddrChange}
          placeholder="123 Main St"
          disabled={disabled}
        />
      </div>

      <div className="field">
        <label htmlFor={`${p}-zip`}>ZIP</label>
        <MemoInput
          id={`${p}-zip`}
          type="text"
          inputMode="numeric"
          autoComplete="postal-code"
          value={value.zipCode}
          onChange={onZipChange}
          placeholder="33101"
          disabled={disabled}
        />
        {zipHint && (
          <div className="info-banner" style={{ marginTop: 4, fontSize: 11 }}>
            {zipHint}
          </div>
        )}
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor={`${p}-city`}>City</label>
          <MemoInput
            id={`${p}-city`}
            type="text"
            autoComplete="address-level2"
            value={value.city}
            onChange={onCityChange}
            placeholder="Miami"
            disabled={disabled}
          />
        </div>
        <div className="field">
          <label htmlFor={`${p}-state`}>State</label>
          <MemoInput
            id={`${p}-state`}
            type="text"
            autoComplete="address-level1"
            value={value.state}
            onChange={onStateChange}
            placeholder="FL"
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}

export const AddressAutofillInput = memo(AddressAutofillInputImpl);

/** Pure-derivation hooks — test-only. */
export const __pureHooks = {
  derivePatchOnZipChange: _derivePatchOnZipChange,
  derivePatchOnAddressLineChange: _derivePatchOnAddressLineChange,
  derivePatchOnCityChange: _derivePatchOnCityChange,
  derivePatchOnStateChange: _derivePatchOnStateChange,
};
