// tests/customerProfiles.test.ts
// Run: npx tsx tests/customerProfiles.test.ts
//
// Pins the Customer CRM derivation — customerKey normalization and
// deriveCustomerProfiles aggregation. The whole CRM reads from
// these two pure functions, so this is the contract.

import { customerKey, customersToCsv, deriveCustomerProfiles } from '@/lib/customers';
import type { Job, Settings } from '@/types';
import type { CustomerMeta } from '@/lib/customers';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const settings = {
  costPerMile: 1, freeMilesIncluded: 0,
} as unknown as Settings;

function mkJob(over: Partial<Job>): Job {
  return {
    id: Math.random().toString(36).slice(2), date: '2026-05-01',
    service: 'Flat Tire Repair', vehicleType: 'Sedan', area: '',
    payment: 'Cash', status: 'Completed', source: '',
    customerName: '', customerPhone: '',
    tireSize: '', qty: 1, revenue: 0, tireCost: 0, materialCost: 0,
    miscCost: 0, miles: 0, note: '', emergency: false, lateNight: false,
    highway: false, weekend: false, tireSource: 'Inventory',
    paymentStatus: 'Paid', invoiceGenerated: false, invoiceSent: false,
    reviewRequested: false, city: '', state: '', fullLocationLabel: '',
    ...over,
  } as Job;
}

console.log('\n┌─ customerKey — normalization ─────────────────────');
check("phone '(555) 123-4567' → 'p_5551234567'",
  customerKey({ customerPhone: '(555) 123-4567', customerName: 'X' }) === 'p_5551234567');
check('differently-formatted same phone → same key',
  customerKey({ customerPhone: '555-123-4567', customerName: 'A' }) ===
  customerKey({ customerPhone: '(555) 123 4567', customerName: 'B' }));
check('no phone → name slug key',
  customerKey({ customerPhone: '', customerName: 'Serge K' }) === 'n_serge-k');
check('phone wins over name',
  customerKey({ customerPhone: '5551112222', customerName: 'Serge' }).startsWith('p_'));
check('no phone, no name → empty (skipped)',
  customerKey({ customerPhone: '', customerName: '' }) === '');
check('name with slashes → safe slug (no /)',
  !customerKey({ customerPhone: '', customerName: 'A/B Co.' }).includes('/'));

console.log('\n┌─ deriveCustomerProfiles — aggregation ────────────');
{
  const jobs = [
    mkJob({ customerPhone: '5551234567', customerName: 'Serge', revenue: 200, date: '2026-05-01', tireSize: '225/65R17' }),
    mkJob({ customerPhone: '(555) 123-4567', customerName: 'Serge', revenue: 300, date: '2026-05-10', tireSize: '235/45R18' }),
    mkJob({ customerPhone: '5559998888', customerName: 'Dana', revenue: 150, date: '2026-05-05' }),
  ];
  const profiles = deriveCustomerProfiles(jobs, settings);
  check('two distinct customers', profiles.length === 2);

  const serge = profiles.find((p) => p.name === 'Serge');
  check('Serge: both phone formats merged into one profile',
    !!serge && serge.jobCount === 2);
  check('Serge: lifetime revenue summed', !!serge && serge.revenue === 500);
  check('Serge: isRepeat true', !!serge && serge.isRepeat === true);
  check('Serge: firstDate is the earliest', !!serge && serge.firstDate === '2026-05-01');
  check('Serge: lastDate is the most recent', !!serge && serge.lastDate === '2026-05-10');
  check('Serge: distinct tire sizes collected',
    !!serge && serge.tireSizes.length === 2);
  check('Serge: jobs sorted most-recent-first',
    !!serge && serge.jobs[0].date === '2026-05-10');

  const dana = profiles.find((p) => p.name === 'Dana');
  check('Dana: single job → isRepeat false', !!dana && dana.isRepeat === false);

  check('sorted by revenue desc (Serge $500 before Dana $150)',
    profiles[0].name === 'Serge');
}

console.log('\n┌─ deriveCustomerProfiles — unpaid + reviews ───────');
{
  const jobs = [
    mkJob({ customerPhone: '5551112222', customerName: 'Pat', revenue: 100, paymentStatus: 'Paid' }),
    mkJob({ customerPhone: '5551112222', customerName: 'Pat', revenue: 250, status: 'Pending', paymentStatus: 'Pending Payment' }),
    mkJob({ customerPhone: '5551112222', customerName: 'Pat', revenue: 80, reviewRequested: true }),
  ];
  const [pat] = deriveCustomerProfiles(jobs, settings);
  check('unpaidCount counts the Pending job', pat.unpaidCount === 1);
  check('unpaidTotal sums outstanding revenue', pat.unpaidTotal === 250);
  check('reviewsSent counts review-requested jobs', pat.reviewsSent === 1);
}

console.log('\n┌─ deriveCustomerProfiles — mechanic profit ────────');
{
  // Mechanic job: partsCost must be subtracted (jobGrossProfit is
  // vertical-correct). $400 job, $100 parts, no travel → $300.
  const jobs = [
    mkJob({ customerPhone: '5550001111', customerName: 'Fleet Co',
      revenue: 400, partsCost: 100, vehicleMakeModel: '2018 Accord', tireSize: '' }),
  ];
  const [c] = deriveCustomerProfiles(jobs, settings);
  check('mechanic profit subtracts partsCost', c.profit === 300);
  check('vehicles collected from vehicleMakeModel',
    c.vehicles.length === 1 && c.vehicles[0] === '2018 Accord');
  check('tireSizes empty for a mechanic job', c.tireSizes.length === 0);
}

console.log('\n┌─ deriveCustomerProfiles — edge cases ─────────────');
{
  check('empty job list → empty profiles',
    deriveCustomerProfiles([], settings).length === 0);
  const skipped = deriveCustomerProfiles(
    [mkJob({ customerPhone: '', customerName: '' })], settings);
  check('unidentifiable job (no phone/name) → skipped',
    skipped.length === 0);
}

console.log('');
// ─── Phase-3 fields ─────────────────────────────────────────────────
console.log('\n┌─ Phase-3 fields ──────────────────────────────────');
{
  // Same customer, three jobs across 30 days, mixed payment methods.
  const jobs = [
    mkJob({ customerPhone: '5550000001', date: '2026-04-01', revenue: 100, paymentMethod: 'cash' }),
    mkJob({ customerPhone: '5550000001', date: '2026-04-15', revenue: 200, paymentMethod: 'card' }),
    mkJob({ customerPhone: '5550000001', date: '2026-05-01', revenue: 150, paymentMethod: 'cash' }),
  ];
  const [p] = deriveCustomerProfiles(jobs, settings);
  check('paymentMethodCounts: cash → 2', p.paymentMethodCounts.cash === 2);
  check('paymentMethodCounts: card → 1', p.paymentMethodCounts.card === 1);
  check('visitCadenceDays = 15 (30 days / 2 gaps)',
    p.visitCadenceDays !== null && Math.abs(p.visitCadenceDays - 15) < 0.01);

  // Single-job customer → cadence is null.
  const single = deriveCustomerProfiles(
    [mkJob({ customerPhone: '5559999999', date: '2026-05-01', paymentMethod: 'cash' })],
    settings,
  )[0];
  check('single-job customer → visitCadenceDays is null',
    single.visitCadenceDays === null);
  check('single-job customer → paymentMethodCounts has 1 entry',
    single.paymentMethodCounts.cash === 1);
}

// ─── customersToCsv ─────────────────────────────────────────────────
console.log('\n┌─ customersToCsv ──────────────────────────────────');
{
  const jobs = [
    mkJob({ customerPhone: '5550000001', customerName: 'Alice', customerEmail: 'a@x.com', date: '2026-04-01', revenue: 100, paymentMethod: 'cash' }),
    mkJob({ customerPhone: '5550000001', customerName: 'Alice', date: '2026-05-01', revenue: 200, paymentMethod: 'card' }),
    mkJob({ customerPhone: '5550000002', customerName: 'Bob, Jr.', date: '2026-05-01', revenue: 50, paymentMethod: 'cash' }),
  ];
  const profiles = deriveCustomerProfiles(jobs, settings);
  const meta = new Map<string, CustomerMeta>([
    ['p_5550000001', { tags: ['VIP', 'Fleet'], note: 'Always pays on time' }],
  ]);
  const csv = customersToCsv(profiles, meta);
  const lines = csv.split('\n');
  check('first line is the header',
    lines[0].startsWith('Name,Phone,Email,'));
  check('CSV escapes commas in name with quotes',
    lines.find((l) => l.includes('Bob'))?.includes('"Bob, Jr."') === true);
  check('tags joined with semicolon (CSV-safe)',
    csv.includes('VIP; Fleet'));
  check('note included',
    csv.includes('Always pays on time'));
  check('Alice row has revenue 300.00',
    lines.find((l) => l.startsWith('Alice'))?.includes('300.00') === true);
  check('cadence value present for repeat customer (Alice has 2 jobs ~30 days apart)',
    /,\d+\.\d+,/.test(lines.find((l) => l.startsWith('Alice')) || ''));

  const csvNoProfit = customersToCsv(profiles, meta, { includeProfit: false });
  check('includeProfit=false omits Profit column from header',
    !csvNoProfit.split('\n')[0].includes('Profit'));
}

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
