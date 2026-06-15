// tests/addJobValidation.test.ts
// Run: npx tsx tests/addJobValidation.test.ts
//
// Pin the Add Job required-field gating helper. Batch C (2026-06-05)
// added validateAddJob() so the Save Job button can be disabled when
// customerPhone / service / revenue aren't all populated. Previously
// the button accepted the default EMPTY_JOB draft and persisted
// $0 / no-customer / "Flat Tire Repair" / "Sedan" jobs into Firestore.
//
// Covers:
//   1. all three required fields valid → canSave true, missing empty
//   2. missing phone → canSave false, missing ['phone']
//   3. missing service → canSave false, missing ['service']
//   4. missing revenue → canSave false, missing ['revenue']
//   5. invalid phone (no leading +, too short)
//   6. revenue === 0 (number)
//   7. revenue === '0' (string — Job.revenue is `string | number`)
//   8. all three missing → missing list order = phone, service, revenue
//
// Plus a handful of supporting `isValidAddJobPhone` cases that pin
// the regex contract — accept formatted "(305) 897-7030", reject
// raw "abc", accept E.164 "+13058977030".

import { validateAddJob, isValidAddJobPhone } from '@/lib/addJobValidation';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

console.log('\n── validateAddJob: happy path ──');
{
  const v = validateAddJob({
    customerPhone: '+13058977030',
    service: 'Flat Tire Repair',
    revenue: 120,
  });
  check('canSave true when phone + service + revenue all valid', v.canSave === true);
  check('missing is empty', v.missing.length === 0);
}

console.log('\n── validateAddJob: missing phone ──');
{
  const v = validateAddJob({
    customerPhone: '',
    service: 'Flat Tire Repair',
    revenue: 120,
  });
  check('canSave false', v.canSave === false);
  check("missing === ['phone']", JSON.stringify(v.missing) === JSON.stringify(['phone']));
}

console.log('\n── validateAddJob: missing service ──');
{
  const v = validateAddJob({
    customerPhone: '(305) 897-7030',
    service: '',
    revenue: 120,
  });
  check('canSave false', v.canSave === false);
  check("missing === ['service']", JSON.stringify(v.missing) === JSON.stringify(['service']));
}

console.log('\n── validateAddJob: service whitespace-only counts as missing ──');
{
  const v = validateAddJob({
    customerPhone: '(305) 897-7030',
    service: '   ',
    revenue: 120,
  });
  check('canSave false on whitespace service', v.canSave === false);
  check("missing === ['service']", JSON.stringify(v.missing) === JSON.stringify(['service']));
}

console.log('\n── validateAddJob: missing revenue ──');
{
  const v = validateAddJob({
    customerPhone: '+13058977030',
    service: 'Tire Replacement',
    revenue: '',
  });
  check('canSave false', v.canSave === false);
  check("missing === ['revenue']", JSON.stringify(v.missing) === JSON.stringify(['revenue']));
}

console.log('\n── validateAddJob: invalid phone (no leading +, too short) ──');
{
  // 6 digits — below the 7-digit floor in the E.164 regex.
  const v = validateAddJob({
    customerPhone: '123456',
    service: 'Flat Tire Repair',
    revenue: 100,
  });
  check('canSave false on short phone', v.canSave === false);
  check("missing has 'phone'", v.missing.includes('phone'));
}

console.log('\n── validateAddJob: invalid phone (alpha junk) ──');
{
  const v = validateAddJob({
    customerPhone: 'abcdefg',
    service: 'Flat Tire Repair',
    revenue: 100,
  });
  check('canSave false on alpha phone', v.canSave === false);
}

console.log('\n── validateAddJob: revenue === 0 (number) ──');
{
  const v = validateAddJob({
    customerPhone: '+13058977030',
    service: 'Flat Tire Repair',
    revenue: 0,
  });
  check('canSave false on numeric 0', v.canSave === false);
  check("missing === ['revenue']", JSON.stringify(v.missing) === JSON.stringify(['revenue']));
}

console.log("\n── validateAddJob: revenue === '0' (string) ──");
{
  const v = validateAddJob({
    customerPhone: '+13058977030',
    service: 'Flat Tire Repair',
    revenue: '0',
  });
  check("canSave false on string '0'", v.canSave === false);
  check("missing === ['revenue']", JSON.stringify(v.missing) === JSON.stringify(['revenue']));
}

console.log('\n── validateAddJob: revenue negative is rejected ──');
{
  const v = validateAddJob({
    customerPhone: '+13058977030',
    service: 'Flat Tire Repair',
    revenue: -50,
  });
  check('canSave false on negative revenue', v.canSave === false);
}

console.log('\n── validateAddJob: all three missing → ordered missing list ──');
{
  const v = validateAddJob({
    customerPhone: '',
    service: '',
    revenue: '',
  });
  check('canSave false', v.canSave === false);
  check(
    "missing === ['phone','service','revenue'] in order",
    JSON.stringify(v.missing) === JSON.stringify(['phone', 'service', 'revenue']),
    `got ${JSON.stringify(v.missing)}`,
  );
}

console.log('\n── isValidAddJobPhone: helper-level coverage ──');
{
  check('accept E.164 +13058977030',     isValidAddJobPhone('+13058977030') === true);
  check('accept formatted (305) 897-7030', isValidAddJobPhone('(305) 897-7030') === true);
  check('accept 13058977030 (no +)',     isValidAddJobPhone('13058977030') === true);
  check('reject empty',                  isValidAddJobPhone('') === false);
  check('reject 6 digits',               isValidAddJobPhone('123456') === false);
  check('reject alpha',                  isValidAddJobPhone('abcdefg') === false);
  check('reject leading 0',              isValidAddJobPhone('+0123456789') === false);
  check('reject non-string null',        isValidAddJobPhone(null) === false);
  check('reject non-string number',      isValidAddJobPhone(1234567890) === false);
}

console.log('\n── phoneOptional (no-phone walk-in path) ──');
{
  const v = validateAddJob({ customerPhone: '', service: 'Flat Tire Repair', revenue: 90 }, { phoneOptional: true });
  check('no phone allowed when phoneOptional', v.canSave === true && !v.missing.includes('phone'),
    `got ${JSON.stringify(v.missing)}`);

  const v2 = validateAddJob({ customerPhone: '', service: 'Flat Tire Repair', revenue: 90 });
  check('no phone still blocked by default', v2.canSave === false && v2.missing.includes('phone'));

  const v3 = validateAddJob({ customerPhone: '123', service: 'Flat Tire Repair', revenue: 90 }, { phoneOptional: true });
  check('invalid partial phone rejected even when optional', v3.missing.includes('phone'));

  const v4 = validateAddJob({ customerPhone: '', service: '', revenue: 0 }, { phoneOptional: true });
  check('service+revenue still required when phoneOptional',
    JSON.stringify(v4.missing) === JSON.stringify(['service', 'revenue']),
    `got ${JSON.stringify(v4.missing)}`);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
