// tests/shouldPromptReview.test.ts
// Run: npx tsx tests/shouldPromptReview.test.ts
//
// Pins the gate that decides whether Mark Paid surfaces the
// one-tap review-request action-toast. Pure function — the whole
// review-automation feature's "should we prompt?" logic lives here,
// so this test is the contract.

import { shouldPromptReview } from '@/lib/review';
import type { Job, Brand } from '@/types';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
};

function mkBrand(over: Partial<Brand>): Brand {
  return {
    businessName: 'Wheel Rush', logoUrl: '', primaryColor: '#f4b400',
    accentColor: '#f7ca4d', phone: '', email: '', website: '',
    reviewUrl: 'https://g.page/r/CfMRJkXrNBO5EAE/review',
    invoiceFooter: '', serviceArea: '', businessType: 'tire', tagline: '',
    serviceCities: [], serviceRadius: 25,
    onboardingComplete: true, onboardingCompletedAt: null,
    ...over,
  } as Brand;
}

function mkJob(over: Partial<Job>): Job {
  return {
    id: 'j', date: '2026-05-22', service: 'Flat Tire Repair',
    vehicleType: 'Sedan', area: '', payment: 'Cash', status: 'Completed',
    source: '', customerName: 'Serge', customerPhone: '5555550123',
    tireSize: '', qty: 1, revenue: 150, tireCost: 0, materialCost: 0,
    miscCost: 0, miles: 0, note: '', emergency: false, lateNight: false,
    highway: false, weekend: false, tireSource: 'Inventory',
    paymentStatus: 'Paid', invoiceGenerated: false, invoiceSent: false,
    reviewRequested: false, city: '', state: '', fullLocationLabel: '',
    ...over,
  } as Job;
}

console.log('\n┌─ Happy path ──────────────────────────────────────');
check('paid job, review URL set, not yet requested → true',
  shouldPromptReview(mkJob({}), mkBrand({})) === true);

console.log('\n┌─ Setting off ─────────────────────────────────────');
check('autoReviewPrompt:false → false',
  shouldPromptReview(mkJob({}), mkBrand({ autoReviewPrompt: false })) === false);
check('autoReviewPrompt:true → true (explicit on)',
  shouldPromptReview(mkJob({}), mkBrand({ autoReviewPrompt: true })) === true);
check('autoReviewPrompt:undefined → true (default on)',
  shouldPromptReview(mkJob({}), mkBrand({ autoReviewPrompt: undefined })) === true);

console.log('\n┌─ Missing review URL ──────────────────────────────');
check('empty reviewUrl → false (send path would dead-end)',
  shouldPromptReview(mkJob({}), mkBrand({ reviewUrl: '' })) === false);
check('whitespace-only reviewUrl → false',
  shouldPromptReview(mkJob({}), mkBrand({ reviewUrl: '   ' })) === false);

console.log('\n┌─ Already requested ───────────────────────────────');
check('job.reviewRequested:true → false (no double-prompt)',
  shouldPromptReview(mkJob({ reviewRequested: true }), mkBrand({})) === false);

console.log('\n┌─ Combined gates ──────────────────────────────────');
check('setting off AND already requested → false',
  shouldPromptReview(
    mkJob({ reviewRequested: true }),
    mkBrand({ autoReviewPrompt: false }),
  ) === false);
check('all gates open → true',
  shouldPromptReview(
    mkJob({ reviewRequested: false }),
    mkBrand({ autoReviewPrompt: true, reviewUrl: 'https://g.page/x' }),
  ) === true);

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
