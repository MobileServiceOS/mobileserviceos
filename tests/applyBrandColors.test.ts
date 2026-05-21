// tests/applyBrandColors.test.ts
// Run: npx tsx tests/applyBrandColors.test.ts
//
// applyBrandColors must produce valid CSS variables for ANY input —
// including corrupted hex values that legacy accounts may still have
// on disk. Pre-fix behavior was a silent skip when isValidHex
// rejected the value; the Wheel Rush user clicked Save, saw a
// success toast, and the color never changed. Post-fix: invalid
// input falls back to defaults but variables ALWAYS get set.

import { applyBrandColors } from '@/lib/utils';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

// Minimal document stub — applyBrandColors only touches
// document.documentElement.style.setProperty.
interface StubStyle {
  setProperty: (name: string, value: string) => void;
  vars: Record<string, string>;
}

function makeStub(): StubStyle {
  const vars: Record<string, string> = {};
  return {
    vars,
    setProperty(name: string, value: string) { vars[name] = value; },
  };
}

function runWithStub(primary: string, accent: string): Record<string, string> {
  const stub = makeStub();
  const fakeDoc = { documentElement: { style: stub } };
  // @ts-expect-error — test-only global stub
  globalThis.document = fakeDoc;
  applyBrandColors(primary, accent);
  // @ts-expect-error — cleanup
  delete globalThis.document;
  return stub.vars;
}

console.log('\n┌─ applyBrandColors — valid input ──────────────────');
{
  const v = runWithStub('#c8a44a', '#e5c770');
  check('--brand-primary set to canonical hex',
    v['--brand-primary'] === '#c8a44a');
  check('--brand-primary-dim is primary+22',
    v['--brand-primary-dim'] === '#c8a44a22');
  check('--brand-primary-glow is primary+66',
    v['--brand-primary-glow'] === '#c8a44a66');
  check('--brand-accent set to canonical hex',
    v['--brand-accent'] === '#e5c770');
}

console.log('\n┌─ applyBrandColors — bare hex (the prod bug) ──────');
{
  const v = runWithStub('c8a44a', 'e5c770');
  check('bare-hex primary still produces a valid CSS var',
    v['--brand-primary'] === '#c8a44a');
  check('bare-hex accent still produces a valid CSS var',
    v['--brand-accent'] === '#e5c770');
  check('derived dim var built from normalized primary',
    v['--brand-primary-dim'] === '#c8a44a22');
}

console.log('\n┌─ applyBrandColors — corrupted input falls back ──');
{
  const v = runWithStub('burgundy', '');
  // Falls back to library defaults (#c8a44a / #e5c770) — and crucially
  // STILL sets the variables, so the UI doesn't render CSS-default
  // colors when the user-set value is unrecognizable.
  check('garbage primary → default applied',
    v['--brand-primary'] === '#c8a44a');
  check('empty accent → default applied',
    v['--brand-accent'] === '#e5c770');
  check('every var is set even with garbage input',
    Object.keys(v).length === 4);
}

console.log('\n┌─ applyBrandColors — 3-char shorthand ─────────────');
{
  const v = runWithStub('#fa3', '#0f0');
  check('3-char shorthand expanded for primary',
    v['--brand-primary'] === '#ffaa33');
  check('3-char shorthand expanded for accent',
    v['--brand-accent'] === '#00ff00');
}

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
