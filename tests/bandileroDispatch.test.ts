// tests/bandileroDispatch.test.ts
// Run: npx tsx tests/bandileroDispatch.test.ts
//
// Dispatch/ETA: geocoded coverage of today's jobs is LIVE; route
// distance + drive time are ESTIMATED (straight-line + assumed speed,
// assumption stated); NOT_CONNECTED when <2 jobs are geocoded — never
// a fabricated distance.

import { dispatchMetrics, haversineMiles, routeMilesToday, ASSUMED_AVG_SPEED_MPH } from '@/lib/bandilero/services/dispatch';
import type { Job } from '@/types';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.error(`  ✗ ${name}${detail ? `  — ${detail}` : ''}`); }
}

const TODAY = '2026-06-07';
function job(over: Partial<Job>): Job {
  return {
    id: Math.random().toString(36).slice(2), date: TODAY, service: 'Tire', vehicleType: 'Sedan',
    area: '', payment: 'Cash', status: 'Completed', source: '', customerName: '', customerPhone: '',
    tireSize: '', qty: 1, revenue: 0, tireCost: 0, materialCost: 0, miscCost: 0, miles: 0,
    note: '', emergency: false, lateNight: false, highway: false, weekend: false,
    paymentStatus: 'Paid', invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
    ...over,
  } as Job;
}

console.log('\n── haversineMiles ──');
{
  // 1° of latitude ≈ 69 miles.
  const d = haversineMiles(40, -74, 41, -74);
  check('1° latitude ≈ 69 miles', d > 68 && d < 70, `got ${d}`);
  check('same point = 0', haversineMiles(40, -74, 40, -74) === 0);
}

console.log('\n── dispatchMetrics: no coords → route NOT_CONNECTED ──');
{
  const jobs = [job({}), job({})]; // today, no coords
  const m = dispatchMetrics(jobs, TODAY);
  check('geocodedToday LIVE 0', m.geocodedToday.state === 'LIVE' && m.geocodedToday.value === 0);
  check('coveragePct LIVE 0', m.coveragePct.state === 'LIVE' && m.coveragePct.value === 0);
  check('routeMiles NOT_CONNECTED (not 0)', m.routeMiles.state === 'NOT_CONNECTED' && m.routeMiles.value === null);
  check('driveTimeMin NOT_CONNECTED', m.driveTimeMin.state === 'NOT_CONNECTED' && m.driveTimeMin.value === null);
}

console.log('\n── dispatchMetrics: 1 coord still NOT_CONNECTED (need ≥2) ──');
{
  const m = dispatchMetrics([job({ lat: 40, lng: -74 }), job({})], TODAY);
  check('geocodedToday = 1', m.geocodedToday.value === 1);
  check('routeMiles NOT_CONNECTED with single point', m.routeMiles.state === 'NOT_CONNECTED');
}

console.log('\n── dispatchMetrics: 2+ coords → ESTIMATED route ──');
{
  const jobs = [
    job({ lat: 40.0, lng: -74.0 }),
    job({ lat: 40.1, lng: -74.0 }),
    job({}),                                 // no coords — counts toward coverage denominator
    job({ status: 'Cancelled', lat: 41, lng: -75 }), // excluded (cancelled)
    job({ date: '2026-06-06', lat: 42, lng: -76 }),  // excluded (not today)
  ];
  const m = dispatchMetrics(jobs, TODAY);
  check('geocodedToday = 2', m.geocodedToday.value === 2, `got ${m.geocodedToday.value}`);
  check('coveragePct = 67 (2 of 3 scheduled)', m.coveragePct.value === 67, `got ${m.coveragePct.value}`);
  check('routeMiles ESTIMATED > 0', m.routeMiles.state === 'ESTIMATED' && (m.routeMiles.value ?? 0) > 0);
  check('routeMiles assumption states the speed', !!m.routeMiles.assumption && m.routeMiles.assumption.includes(`${ASSUMED_AVG_SPEED_MPH} mph`));
  check('driveTimeMin ESTIMATED', m.driveTimeMin.state === 'ESTIMATED' && (m.driveTimeMin.value ?? 0) > 0);
}

console.log('\n── routeMilesToday excludes cancelled / non-today ──');
{
  const miles = routeMilesToday([
    job({ lat: 40.0, lng: -74.0 }),
    job({ lat: 40.1, lng: -74.0 }),
    job({ status: 'Cancelled', lat: 50, lng: -80 }),
  ], TODAY);
  check('route ≈ 6.9 miles (only the 2 valid points)', miles > 6 && miles < 8, `got ${miles}`);
}

console.log(`\n── DONE: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
