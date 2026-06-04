// ═══════════════════════════════════════════════════════════════════
//  tests/components/AddressAutofillInput.test.ts
//  Run: npx tsx tests/components/AddressAutofillInput.test.ts
//  Spec: §"AddJob Workflow Change → step 7"
// ═══════════════════════════════════════════════════════════════════
import { __pureHooks } from '@/components/addJob/AddressAutofillInput';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const { derivePatchOnZipChange, derivePatchOnAddressLineChange } = __pureHooks;

console.log('\n┌─ derivePatchOnZipChange: known ZIP autofills ───');
{
  const prev = { addressLine: '', city: '', state: '', zipCode: '' };
  const next = derivePatchOnZipChange(prev, '33101');
  check('city autofilled from ZIP', next.city === 'Miami');
  check('state autofilled from ZIP', next.state === 'FL');
  check('zipCode normalized to 5-digit', next.zipCode === '33101');
  check('addressLine preserved (empty here)', next.addressLine === '');
}

console.log('\n┌─ derivePatchOnZipChange: unknown ZIP preserves ──');
{
  const prev = { addressLine: '123 Main', city: 'Existing', state: 'AL', zipCode: '' };
  const next = derivePatchOnZipChange(prev, '00000');
  check('unknown ZIP does NOT clobber existing city', next.city === 'Existing');
  check('unknown ZIP does NOT clobber existing state', next.state === 'AL');
  check('zipCode still updated to typed value', next.zipCode === '00000');
  check('addressLine preserved', next.addressLine === '123 Main');
}

console.log('\n┌─ derivePatchOnZipChange: partial typing ────────');
{
  const prev = { addressLine: '', city: '', state: '', zipCode: '' };
  const next = derivePatchOnZipChange(prev, '331');
  check('3-digit input does NOT autofill (still typing)', next.city === '' && next.state === '');
  check('zipCode reflects typed input', next.zipCode === '331');
}

console.log('\n┌─ derivePatchOnZipChange: whitespace tolerated ──');
{
  const prev = { addressLine: '', city: '', state: '', zipCode: '' };
  const next = derivePatchOnZipChange(prev, '  33101  ');
  check('city autofilled despite whitespace', next.city === 'Miami');
  check('zipCode trimmed in storage', next.zipCode === '33101');
}

console.log('\n┌─ derivePatchOnZipChange: empty clears ZIP only ──');
{
  const prev = { addressLine: '123 Main', city: 'Miami', state: 'FL', zipCode: '33101' };
  const next = derivePatchOnZipChange(prev, '');
  check('emptying ZIP preserves city/state (operator might be retyping)', next.city === 'Miami' && next.state === 'FL');
  check('zipCode is empty', next.zipCode === '');
}

console.log('\n┌─ derivePatchOnAddressLineChange ────────────────');
{
  const prev = { addressLine: '', city: 'Miami', state: 'FL', zipCode: '33101' };
  const next = derivePatchOnAddressLineChange(prev, '123 Main St');
  check('addressLine updated', next.addressLine === '123 Main St');
  check('city preserved', next.city === 'Miami');
  check('state preserved', next.state === 'FL');
  check('zipCode preserved', next.zipCode === '33101');
}

console.log('\n══════════════════════════════════════════════════');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
