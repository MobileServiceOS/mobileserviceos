// tests/imageCompress.test.ts
// Run: npx tsx tests/imageCompress.test.ts
//
// fitWithin is the only pure piece of the image compressor; the rest
// requires a browser canvas. fitWithin drives the downscale dimensions
// so the test pins the aspect-ratio + boundary math.

import { fitWithin } from '@/lib/imageCompress';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; console.log(`  ✗ ${label}`); }
};

console.log('\n┌─ fitWithin ───────────────────────────────────────');

// Pass-through cases — both dims already within maxDim.
check('400×300 within 1600 → unchanged',
  (() => { const r = fitWithin(400, 300, 1600); return r.w === 400 && r.h === 300; })());
check('1600×1200 within 1600 → unchanged (boundary)',
  (() => { const r = fitWithin(1600, 1200, 1600); return r.w === 1600 && r.h === 1200; })());

// Landscape — long side caps; short side scales.
check('4000×3000 → 1600×1200 (landscape down)',
  (() => { const r = fitWithin(4000, 3000, 1600); return r.w === 1600 && r.h === 1200; })());
check('3024×4032 (portrait phone) → caps height at 1600, scales width',
  (() => { const r = fitWithin(3024, 4032, 1600); return r.h === 1600 && r.w === Math.round((3024 / 4032) * 1600); })());

// Square.
check('5000×5000 → 1600×1600',
  (() => { const r = fitWithin(5000, 5000, 1600); return r.w === 1600 && r.h === 1600; })());

// Different maxDim.
check('1000×500 with maxDim 800 → 800×400',
  (() => { const r = fitWithin(1000, 500, 800); return r.w === 800 && r.h === 400; })());
check('500×1000 with maxDim 800 → 400×800',
  (() => { const r = fitWithin(500, 1000, 800); return r.w === 400 && r.h === 800; })());

// Edge: zero / negative / NaN.
check('0×100 → 0×0 (defensive)',
  (() => { const r = fitWithin(0, 100, 1600); return r.w === 0 && r.h === 0; })());
check('100×0 → 0×0',
  (() => { const r = fitWithin(100, 0, 1600); return r.w === 0 && r.h === 0; })());
check('NaN→ 0×0',
  (() => { const r = fitWithin(NaN, 100, 1600); return r.w === 0 && r.h === 0; })());

// Aspect-ratio preservation invariant.
check('aspect ratio preserved within 0.5% across a few sizes', (() => {
  const cases: Array<[number, number]> = [[3000, 1800], [4000, 2250], [800, 600], [3024, 4032]];
  for (const [w, h] of cases) {
    const r = fitWithin(w, h, 1600);
    if (r.w === 0 || r.h === 0) return false;
    const srcAR = w / h;
    const dstAR = r.w / r.h;
    if (Math.abs(srcAR - dstAR) / srcAR > 0.005) return false;
  }
  return true;
})());

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
