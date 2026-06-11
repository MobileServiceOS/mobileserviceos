// tests/verticalDisplay.test.ts
// Run: npx tsx tests/verticalDisplay.test.ts
//
// The Onboarding business-type picker writes the vertical KEY
// ('tire' | 'mechanic' | 'detailing') to settings/main.businessType.
// UI surfaces (Header, future PDF chrome) must render the human
// `displayName` from the registry — never the raw key. These tests
// pin that contract and also verify the legacy display-string
// businessType used by accounts created before the Phase 2 work
// still resolves to the correct vertical config.

import { verticalFromBusinessType } from '@/lib/verticalContext';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

console.log('\n┌─ verticalFromBusinessType — canonical keys ───────');

check("'tire' → key 'tire'",
  verticalFromBusinessType('tire').key === 'tire');
check("'tire' → displayName 'Mobile Tire & Roadside'",
  verticalFromBusinessType('tire').displayName === 'Mobile Tire & Roadside');

// Mechanic/detailing were removed — any non-tire key falls back to tire.
check("'mechanic' (removed) → tire fallback",
  verticalFromBusinessType('mechanic').key === 'tire');
check("'detailing' (removed) → tire fallback",
  verticalFromBusinessType('detailing').key === 'tire');

console.log('\n┌─ verticalFromBusinessType — legacy/fallback ──────');

// Pre-Phase-2 accounts store the display string in businessType. The
// resolver must fall through to the default vertical (tire) so their
// Header subtitle, invoice template, and service catalog all behave
// identically to a canonical 'tire' account.
check("'Mobile Tire & Roadside' (legacy string) → tire",
  verticalFromBusinessType('Mobile Tire & Roadside').key === 'tire');
check("'Mobile Tire & Roadside' (legacy string) → displayName matches",
  verticalFromBusinessType('Mobile Tire & Roadside').displayName === 'Mobile Tire & Roadside');

check("empty string → tire default",
  verticalFromBusinessType('').key === 'tire');
check("null → tire default",
  verticalFromBusinessType(null).key === 'tire');
check("undefined → tire default",
  verticalFromBusinessType(undefined).key === 'tire');
check("unknown key → tire default",
  verticalFromBusinessType('carwash').key === 'tire');
check("garbage → tire default",
  verticalFromBusinessType('asdf').key === 'tire');

console.log('\n┌─ Header subtitle invariant ───────────────────────');

// What Header.tsx renders is `vertical.displayName · brand.serviceArea`.
// The contract that protects the production regression I just shipped:
// every valid VerticalKey produces a human-readable displayName that
// does NOT equal the raw key string. Without this, the Header would
// fall back to "mechanic · Tampa" instead of "Mobile Mechanic · Tampa".
const keys: Array<'tire'> = ['tire'];
let allHuman = true;
for (const k of keys) {
  const dn = verticalFromBusinessType(k).displayName;
  if (!dn || dn === k || dn.length < 5) {
    allHuman = false;
    console.log(`  ✗ key '${k}' has non-human displayName: '${dn}'`);
  }
}
check('every vertical key resolves to a human displayName', allHuman);

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
