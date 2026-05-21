// tests/detailingDashboardMetrics.test.ts
// Run: npx tsx tests/detailingDashboardMetrics.test.ts

import { DETAILING_CONFIG } from '@/config/businessTypes/detailing';
import type { Job, Settings } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const settings: Settings = {} as Settings;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function lastWeekISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 8);
  return d.toISOString().slice(0, 10);
}

const j = (over: Partial<Job> & { detailingAddons?: ReadonlyArray<string> } = {}): Job => ({
  id: 'j', date: todayISO(), service: 'Full Detail', vehicleType: 'Car',
  area: '', payment: 'Cash', status: 'Completed', source: 'Google',
  customerName: 'John', customerPhone: '5550001234',
  tireSize: '', qty: 1, revenue: 200, tireCost: 0, materialCost: 0,
  miles: 0, note: '', emergency: false, lateNight: false, highway: false, weekend: false,
  tireSource: 'Inventory', inventoryDeductions: null, paymentStatus: 'Paid',
  invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
  ...over,
} as Job);

const metric = (id: string) => {
  const m = DETAILING_CONFIG.dashboardMetrics.find((x) => x.id === id);
  if (!m) throw new Error(`metric ${id} not found`);
  return m;
};

console.log('\n┌─ details_this_week ───────────────────────────────');
{
  const m = metric('details_this_week');
  check('counts week jobs only',
    m.compute([j({ id: 'a' }), j({ id: 'b' }), j({ id: 'c', date: lastWeekISO() })], settings) === 2);
  check('empty list → 0', m.compute([], settings) === 0);
}

console.log('\n┌─ revenue_week ────────────────────────────────────');
{
  const m = metric('revenue_week');
  check('sums revenue across week jobs',
    m.compute([j({ revenue: 200 }), j({ revenue: 350 }), j({ revenue: 75, date: lastWeekISO() })], settings) === 550);
  check('empty → 0', m.compute([], settings) === 0);
}

console.log('\n┌─ avg_ticket ──────────────────────────────────────');
{
  const m = metric('avg_ticket');
  check('avg of 2 completed jobs',
    m.compute([j({ revenue: 200 }), j({ revenue: 400 })], settings) === 300);
  check('skips Pending jobs',
    m.compute([j({ revenue: 200 }), j({ revenue: 1000, status: 'Pending' })], settings) === 200);
  check('no completed week jobs → 0', m.compute([], settings) === 0);
}

console.log('\n┌─ repeat_customer_pct ─────────────────────────────');
{
  const m = metric('repeat_customer_pct');
  const jobs = [
    j({ id: 'old', date: lastWeekISO(), customerPhone: '5550001234', status: 'Completed' }),
    j({ id: 'this1', customerPhone: '5550001234' }),
    j({ id: 'this2', customerPhone: '5559999999' }),
  ];
  check('1/2 week customers are repeat = 0.5',
    m.compute(jobs, settings) === 0.5);
  check('no week jobs → 0', m.compute([], settings) === 0);
}

console.log('\n┌─ addons_pct ──────────────────────────────────────');
{
  const m = metric('addons_pct');
  const jobs = [
    j({ id: 'a', detailingAddons: ['Pet Hair Removal'] }),
    j({ id: 'b', detailingAddons: [] }),
    j({ id: 'c' }),
    j({ id: 'd', detailingAddons: ['Tire Shine', 'Glass Treatment'] }),
  ];
  check('2/4 jobs have add-ons = 0.5', m.compute(jobs, settings) === 0.5);
  check('zero completed week jobs → 0', m.compute([], settings) === 0);
  check('all jobs with add-ons → 1.0',
    m.compute([j({ detailingAddons: ['x'] }), j({ detailingAddons: ['y'] })], settings) === 1);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
