// src/components/addJob/AddressAutofillInput.tsx
// ═══════════════════════════════════════════════════════════════════
//  AddressAutofillInput — ZIP-first address capture.
//
//  Spec: docs/superpowers/specs/2026-06-03-customer-intelligence-design.md
//        §"AddJob Workflow Change → step 7"
//        §"AddressAutofillInput.tsx" component spec
//
//  v1 contract:
//    - Operator types 5-digit ZIP first.
//    - On full 5-digit match, city + state autofill from the bundled
//      usZips dataset.
//    - addressLine is free-text — no street-level validation in v1.
//    - On unknown ZIP, the city/state stay whatever the operator had
//      (no clobber); a "ZIP not recognized — type city manually" hint
//      renders inline.
//
//  Re-used in SP3's CustomerProfile edit mode — surface-agnostic.
//
//  Inputs use MemoInput per the P1-3 keystroke-storm contract. The
//  parent MUST pass a useCallback-stable `onChange` setter.
// ═══════════════════════════════════════════════════════════════════

import { memo, useCallback, useMemo } from 'react';
import { MemoInput } from '@/components/addJob/MemoInput';
import { isValidUsZip, lookupZip } from '@/lib/usZips';

export interface AddressValue {
  addressLine: string;
  city: string;
  state: string;
  zipCode: string;
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

  return (
    <div className="form-group card-anim">
      <div className="form-group-title">Location</div>
      <div className="field-row">
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
        <label htmlFor={`${p}-line`}>Street address (optional)</label>
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
