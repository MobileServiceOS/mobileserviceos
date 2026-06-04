// ═══════════════════════════════════════════════════════════════════
//  tests/usZips.test.ts — bundled US ZIP → city/state lookup
//  Run: npx tsx tests/usZips.test.ts
//  Spec: §"AddJob Workflow Change → step 7 + Out of Scope"
// ═══════════════════════════════════════════════════════════════════
import { lookupZip, isValidUsZip, US_ZIP_COUNT } from '@/lib/usZips';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

console.log('\n┌─ isValidUsZip ──────────────────────────────────');
check('5-digit accepted', isValidUsZip('33101') === true);
check('5-digit with surrounding whitespace accepted', isValidUsZip('  33101  ') === true);
check('4-digit rejected', isValidUsZip('3310') === false);
check('6-digit rejected', isValidUsZip('331012') === false);
check('alpha rejected', isValidUsZip('33A01') === false);
check('zip+4 NOT supported in v1', isValidUsZip('33101-1234') === false);
check('empty rejected', isValidUsZip('') === false);

console.log('\n┌─ lookupZip: known ZIPs ─────────────────────────');
{
  const r = lookupZip('33020');
  check('33020 → Hollywood, FL', r?.city === 'Hollywood' && r?.state === 'FL');
}
{
  const r = lookupZip('90001');
  check('90001 → Los Angeles, CA', r?.city === 'Los Angeles' && r?.state === 'CA');
}
{
  const r = lookupZip('10001');
  check('10001 → New York, NY', r?.city === 'New York' && r?.state === 'NY');
}
{
  const r = lookupZip('77001');
  check('77001 → Houston, TX', r?.city === 'Houston' && r?.state === 'TX');
}

console.log('\n┌─ lookupZip: misses ─────────────────────────────');
check('00000 → null (intentional miss)', lookupZip('00000') === null);
check('99999 → null (rural / outside top-N)', lookupZip('99999') === null);
check('non-string → null (defensive)', lookupZip('not-a-zip') === null);
check('empty → null', lookupZip('') === null);
check('whitespace tolerated', !!lookupZip('  33020  '));

console.log('\n┌─ dataset shape ─────────────────────────────────');
check('US_ZIP_COUNT > 100', US_ZIP_COUNT > 100);
check('US_ZIP_COUNT <= 2000 (size budget)', US_ZIP_COUNT <= 2000);

console.log('\n══════════════════════════════════════════════════');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
