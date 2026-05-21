// tests/buildTemplateVars.test.ts
// Run: npx tsx tests/buildTemplateVars.test.ts

import { buildTemplateVars } from '@/lib/notificationTemplates';
import type { Job, Brand, Settings } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

const baseJob = (over: Partial<Job> = {}): Job => ({
  id: 'job-1234567890ABC', date: '2026-05-21', service: 'Repair', vehicleType: 'Car',
  area: '', payment: 'Cash', status: 'Pending', source: 'Google',
  customerName: 'John Doe', customerPhone: '5551234567', tireSize: '', qty: 1,
  revenue: 240, tireCost: 0, materialCost: 0, miles: 0, note: '',
  emergency: false, lateNight: false, highway: false, weekend: false,
  tireSource: 'Inventory', inventoryDeductions: null, paymentStatus: 'Paid',
  invoiceGenerated: false, invoiceSent: false, reviewRequested: false,
  ...over,
} as Job);

const brand: Brand = {
  businessName: 'Acme', logoUrl: '', primaryColor: '#000', accentColor: '#000',
  phone: '5559998888', email: 'a@b.com', website: '', reviewUrl: 'https://g.page/r/x',
  invoiceFooter: '', serviceArea: '', businessType: 'Mobile Tire & Roadside',
  tagline: '', state: '', mainCity: '', fullLocationLabel: '',
  serviceCities: [], serviceRadius: 25, onboardingComplete: true, onboardingCompletedAt: null,
};
const settings = {} as Settings;

console.log('\n┌─ buildTemplateVars ───────────────────────────────');
{
  const v = buildTemplateVars(baseJob(), brand, settings, 'Alice');
  check('shortId = last 6 chars uppercased',
    v.job.shortId === '890ABC'); // 'job-1234567890ABC' → last 6 = '890ABC'
}
{
  const v = buildTemplateVars(baseJob({ customerName: 'John Doe' }), brand, settings, 'Alice');
  check('firstName = first whitespace-separated word', v.customer.firstName === 'John');
}
{
  const v = buildTemplateVars(baseJob({ customerName: 'Jane' }), brand, settings, 'Alice');
  check('firstName for single-word name', v.customer.firstName === 'Jane');
}
{
  const v = buildTemplateVars(baseJob({ customerName: '' }), brand, settings, 'Alice');
  check('empty customerName → firstName "there"', v.customer.firstName === 'there');
}
{
  const v = buildTemplateVars(baseJob({ customerName: 'María García López' }), brand, settings, 'Alice');
  check('unicode firstName preserved', v.customer.firstName === 'María');
}
{
  const v = buildTemplateVars(baseJob({ revenue: 240 }), brand, settings, 'Alice');
  check('totalFormatted via money() starts with $',
    v.job.totalFormatted.startsWith('$'));
}
{
  const v = buildTemplateVars(baseJob(), brand, settings, '');
  check('empty techName → "your technician" fallback', v.tech.name === 'your technician');
}
{
  const v = buildTemplateVars(baseJob({ customerEmail: 'j@d.com' }), brand, settings, 'Alice');
  check('customerEmail populated when set', v.customer.email === 'j@d.com');
}
{
  const v = buildTemplateVars(baseJob({ customerEmail: undefined }), brand, settings, 'Alice');
  check('customerEmail undefined when absent', v.customer.email === undefined);
}
{
  const v = buildTemplateVars(baseJob(), brand, settings, 'Alice');
  check('paymentMethods fallback when missing', v.business.paymentMethods.length > 0);
}
{
  const v = buildTemplateVars(baseJob({ service: 'Brake Service' }), brand, settings, 'Alice');
  check('job.service populated', v.job.service === 'Brake Service');
}
{
  const v = buildTemplateVars(baseJob(), brand, settings, 'Alice');
  check('business.name from brand', v.business.name === 'Acme');
}
{
  const empty = { ...brand, businessName: '' } as Brand;
  const v = buildTemplateVars(baseJob(), empty, settings, 'Alice');
  check('business.name fallback when brand empty', v.business.name === 'our business');
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
