// ═══════════════════════════════════════════════════════════════════
//  tests/addressAutofillReorder.test.ts
//  Run: npx tsx tests/addressAutofillReorder.test.ts
//
//  Pin the Batch D (2026-06-05) changes to AddressAutofillInput:
//    1. Field render order moved to Street → ZIP → City → State.
//    2. The ZIP-typed autofill effect still fires after the reorder.
//    3. Nominatim reverse-geocode parsing produces the expected
//       AddressValue across full / partial / empty payloads.
//    4. State-name → USPS-code mapping is applied (Florida → FL).
//    5. mergeGeocodedAddress preserves operator-typed values when
//       Nominatim doesn't return a field.
//
//  These tests are pure-logic (no DOM): the field order is asserted
//  via the exported ADDRESS_FIELD_ORDER constant which the component
//  consumes in lockstep with its JSX render. If a future edit
//  reorders the JSX without updating ADDRESS_FIELD_ORDER the
//  contract drifts; if it updates the constant the test fails here
//  first so the senior-level audit ergonomics don't silently regress.
// ═══════════════════════════════════════════════════════════════════

import {
  ADDRESS_FIELD_ORDER,
  __pureHooks,
  parseNominatimAddress,
  mergeGeocodedAddress,
  buildNominatimReverseUrl,
  type NominatimReverseResponse,
} from '@/components/addJob/AddressAutofillInput';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const { derivePatchOnZipChange } = __pureHooks;

console.log('\n┌─ ADDRESS_FIELD_ORDER: Street → ZIP → City → State ─');
{
  check('field count is 4', ADDRESS_FIELD_ORDER.length === 4);
  check('slot 1 is addressLine (Street)', ADDRESS_FIELD_ORDER[0] === 'addressLine');
  check('slot 2 is zipCode (ZIP triggers autofill)', ADDRESS_FIELD_ORDER[1] === 'zipCode');
  check('slot 3 is city (autofilled, editable)', ADDRESS_FIELD_ORDER[2] === 'city');
  check('slot 4 is state (autofilled, editable)', ADDRESS_FIELD_ORDER[3] === 'state');
}

console.log('\n┌─ ZIP autofill still fires after reorder ────────');
{
  // Sanity: the reorder only changes JSX, not the autofill effect.
  // If a future refactor accidentally removed the lookupZip call we'd
  // catch it here without needing a render harness.
  const prev = { addressLine: '123 Main St', city: '', state: '', zipCode: '' };
  const next = derivePatchOnZipChange(prev, '33101');
  check('city still autofilled from known ZIP', next.city === 'Miami');
  check('state still autofilled from known ZIP', next.state === 'FL');
  check('Street value preserved through ZIP edit', next.addressLine === '123 Main St');
  check('zipCode normalized', next.zipCode === '33101');
}

console.log('\n┌─ buildNominatimReverseUrl ──────────────────────');
{
  const url = buildNominatimReverseUrl(25.7617, -80.1918);
  check('url targets nominatim.openstreetmap.org/reverse',
    url.startsWith('https://nominatim.openstreetmap.org/reverse?'));
  check('url declares format=jsonv2', url.includes('format=jsonv2'));
  check('url includes lat param', url.includes('lat=25.7617'));
  check('url includes lon param', url.includes('lon=-80.1918'));
  check('url asks for addressdetails', url.includes('addressdetails=1'));
  check('url uses street-level zoom', url.includes('zoom=18'));
}

console.log('\n┌─ parseNominatimAddress: full Miami response ────');
{
  const resp: NominatimReverseResponse = {
    address: {
      house_number: '123',
      road: 'Biscayne Blvd',
      city: 'Miami',
      state: 'Florida',
      postcode: '33101',
    },
  };
  const out = parseNominatimAddress(resp);
  check('street composes house_number + road', out.addressLine === '123 Biscayne Blvd');
  check('city pulled from address.city', out.city === 'Miami');
  check('state name mapped to USPS code (Florida → FL)', out.state === 'FL');
  check('zip extracted from postcode', out.zipCode === '33101');
}

console.log('\n┌─ parseNominatimAddress: town / village fallback ─');
{
  // Rural address — Nominatim returns village not city.
  const resp: NominatimReverseResponse = {
    address: {
      road: 'County Road 12',
      village: 'Smalltown',
      state: 'Texas',
      postcode: '78701',
    },
  };
  const out = parseNominatimAddress(resp);
  check('street still surfaces road without house_number', out.addressLine === 'County Road 12');
  check('city falls back to village', out.city === 'Smalltown');
  check('state mapped (Texas → TX)', out.state === 'TX');
  check('zip extracted', out.zipCode === '78701');
}

console.log('\n┌─ parseNominatimAddress: town → city cascade ─────');
{
  const resp: NominatimReverseResponse = {
    address: {
      road: 'Main St',
      town: 'Townville',
      state: 'Georgia',
      postcode: '30301',
    },
  };
  const out = parseNominatimAddress(resp);
  check('city falls back to town when city missing', out.city === 'Townville');
  check('state mapped (Georgia → GA)', out.state === 'GA');
}

console.log('\n┌─ parseNominatimAddress: ZIP+4 trimmed to 5 ──────');
{
  const resp: NominatimReverseResponse = {
    address: { road: 'Main St', city: 'Anywhere', state: 'Florida', postcode: '33101-1234' },
  };
  const out = parseNominatimAddress(resp);
  check('ZIP+4 trimmed to 5-digit head', out.zipCode === '33101');
}

console.log('\n┌─ parseNominatimAddress: partial / empty payloads ─');
{
  const empty = parseNominatimAddress(null);
  check('null response yields empty AddressValue',
    empty.addressLine === '' && empty.city === '' && empty.state === '' && empty.zipCode === '');

  const noAddress = parseNominatimAddress({});
  check('missing address key yields empty AddressValue',
    noAddress.addressLine === '' && noAddress.city === '' && noAddress.state === '' && noAddress.zipCode === '');

  const partial = parseNominatimAddress({ address: { city: 'Miami', state: 'Florida' } });
  check('partial response (city+state only) skips street + zip',
    partial.addressLine === '' && partial.zipCode === '');
  check('partial response still fills city',  partial.city === 'Miami');
  check('partial response still maps state',  partial.state === 'FL');
}

console.log('\n┌─ parseNominatimAddress: unknown state passes raw ─');
{
  // Not a real US state. We pass through the raw value rather than
  // dropping it — the onStateChange clamp in the component will
  // upper-case + trim to 2 chars when the operator hits Save.
  const resp: NominatimReverseResponse = { address: { road: 'Main', state: 'Ontario' } };
  const out = parseNominatimAddress(resp);
  check('non-US state name passes through unchanged', out.state === 'Ontario');
}

console.log('\n┌─ mergeGeocodedAddress: empty geo preserves prev ─');
{
  const prev = { addressLine: '742 Evergreen Terrace', city: 'Springfield', state: 'IL', zipCode: '62701' };
  const geo = { addressLine: '', city: '', state: '', zipCode: '' };
  const out = mergeGeocodedAddress(prev, geo);
  check('empty geo does NOT clobber addressLine', out.addressLine === '742 Evergreen Terrace');
  check('empty geo does NOT clobber city',        out.city === 'Springfield');
  check('empty geo does NOT clobber state',       out.state === 'IL');
  check('empty geo does NOT clobber zip',         out.zipCode === '62701');
}

console.log('\n┌─ mergeGeocodedAddress: partial geo merges in ────');
{
  // Tech typed a partial street, then tapped GPS. Geo gave us a
  // street + ZIP but no city/state (unlikely in practice, but the
  // merge must still work). City/state stay as the tech had them.
  const prev = { addressLine: 'old typed', city: 'Existing', state: 'AL', zipCode: '' };
  const geo  = { addressLine: '500 Brickell Ave', city: '', state: '', zipCode: '33131' };
  const out = mergeGeocodedAddress(prev, geo);
  check('geo street wins over previous',  out.addressLine === '500 Brickell Ave');
  check('geo zip wins over previous',     out.zipCode === '33131');
  check('city preserved when geo blank',  out.city === 'Existing');
  check('state preserved when geo blank', out.state === 'AL');
}

console.log('\n┌─ mergeGeocodedAddress: state clamped to 2 chars ─');
{
  // Defensive: parseNominatimAddress can pass through "Ontario"
  // (non-US). mergeGeocodedAddress is the last gate before the
  // value lands in state.
  const prev = { addressLine: '', city: '', state: '', zipCode: '' };
  const geo  = { addressLine: '', city: '', state: 'Ontario', zipCode: '' };
  const out = mergeGeocodedAddress(prev, geo);
  check('non-US state truncated + uppercased', out.state === 'ON');
}

console.log('\n══════════════════════════════════════════════════');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
