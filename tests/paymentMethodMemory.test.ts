// tests/paymentMethodMemory.test.ts
// Run: npx tsx tests/paymentMethodMemory.test.ts
//
// Verifies the Mark-Paid method memory: persists the last method, reads it
// back, rejects garbage, and never throws when storage is unavailable.

// Minimal localStorage mock installed before the module reads it at call time.
const store: Record<string, string> = {};
let throwMode = false;
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => { if (throwMode) throw new Error('blocked'); return k in store ? store[k] : null; },
    setItem: (k: string, v: string) => { if (throwMode) throw new Error('blocked'); store[k] = v; },
  },
};

import { getLastPaymentMethod, setLastPaymentMethod } from '@/lib/paymentMethodMemory';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

console.log('\n── payment method memory ──');
check('empty store → null', getLastPaymentMethod() === null);

setLastPaymentMethod('zelle');
check('persists + reads back zelle', getLastPaymentMethod() === 'zelle');

setLastPaymentMethod('apple_pay');
check('overwrites with apple_pay', getLastPaymentMethod() === 'apple_pay');

// A garbage value that somehow landed in storage must not be returned.
store['msos_last_payment_method'] = 'bitcoin';
check('rejects invalid stored value', getLastPaymentMethod() === null);

// Storage throwing (private mode) must degrade to null / no-op, never throw.
throwMode = true;
let threw = false;
try { setLastPaymentMethod('cash'); getLastPaymentMethod(); } catch { threw = true; }
check('storage failure never throws', !threw);
check('storage failure reads as null', getLastPaymentMethod() === null);

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
