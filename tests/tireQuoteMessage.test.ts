// tests/tireQuoteMessage.test.ts
// Run: npx tsx tests/tireQuoteMessage.test.ts

import {
  buildQuoteMessage,
  serviceForQuote,
} from '@/lib/tireQuoteMessage';
import type { TireQuoteOption, QuoteOptionTier } from '@/lib/tireQuoteTypes';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean, detail?: string): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? `  — ${detail}` : ''}`); }
};
const section = (t: string): void => console.log(`\n┌─ ${t} ─────────────────────`);

function makeOption(tier: QuoteOptionTier, overrides: Partial<TireQuoteOption> = {}): TireQuoteOption {
  return {
    tier,
    supplierPriceId: `sp-${tier}`,
    supplierName: 'ATD',
    brand: 'Michelin',
    model: 'Defender 2',
    tireSize: '225/65R17',
    condition: tier === 'used_economy' || tier === 'used_premium' ? 'used' : 'new',
    category: tier === 'good' ? 'budget' : tier === 'better' ? 'midrange' : tier === 'best' ? 'premium' : tier === 'used_economy' ? 'budget' : 'premium',
    costPerTire: 100,
    quantity: 4,
    customerPrice: 499,
    estimatedProfit: 99,
    etaDays: 0,
    ...overrides,
  };
}

// ─── ALL OPTIONS mode ─────────────────────────────────────────────
section('ALL OPTIONS mode — every available tier');
{
  const body = buildQuoteMessage({
    customerName: 'Serge',
    businessName: 'Wheel Rush',
    tireSize: '225/65R17',
    options: [
      makeOption('good', { customerPrice: 419 }),
      makeOption('better', { customerPrice: 499 }),
      makeOption('best', { customerPrice: 619, brand: 'Michelin', model: 'Pilot Sport 4S' }),
    ],
  });
  check('greets by name', body.startsWith('Hi Serge,'));
  check('mentions business name', body.includes('Wheel Rush'));
  check('mentions tire size', body.includes('225/65R17'));
  check('contains GOOD line', body.includes('GOOD (Budget New)'));
  check('contains BETTER line', body.includes('BETTER (Most Popular)'));
  check('contains BEST line', body.includes('BEST (Premium)'));
  check('includes installed prices', body.includes('$499') && body.includes('$419'));
  check('ends with reply CTA', body.trim().endsWith('Reply to schedule.'));
}

// ─── Used + New combined ─────────────────────────────────────────
section('Used + New combined');
{
  const body = buildQuoteMessage({
    customerName: 'Serge',
    businessName: 'Wheel Rush',
    tireSize: '225/65R17',
    options: [
      makeOption('best', { customerPrice: 619 }),
      makeOption('used_economy', { customerPrice: 189, brand: 'Goodyear', model: 'Eagle' }),
      makeOption('good', { customerPrice: 419 }),
      makeOption('used_premium', { customerPrice: 279, brand: 'Michelin', model: 'Defender' }),
      makeOption('better', { customerPrice: 499 }),
    ],
  });
  // Cheapest-first ordering: used_economy → used_premium → good → better → best
  const idxOf = (s: string) => body.indexOf(s);
  check('used_economy appears first', idxOf('USED ECONOMY') < idxOf('USED PREMIUM'));
  check('used_premium before good', idxOf('USED PREMIUM') < idxOf('GOOD'));
  check('good before better', idxOf('GOOD (Budget New)') < idxOf('BETTER'));
  check('better before best', idxOf('BETTER (Most Popular)') < idxOf('BEST'));
  check('all 5 tiers present', ['USED ECONOMY', 'USED PREMIUM', 'GOOD', 'BETTER', 'BEST'].every((s) => body.includes(s)));
}

// ─── SELECTED mode ────────────────────────────────────────────────
section('SELECTED mode — single option');
{
  const options = [
    makeOption('good', { customerPrice: 419 }),
    makeOption('better', { customerPrice: 499 }),
    makeOption('best', { customerPrice: 619 }),
  ];
  const body = buildQuoteMessage({
    customerName: 'Serge',
    businessName: 'Wheel Rush',
    tireSize: '225/65R17',
    options,
    selectedTier: 'better',
  });
  check('contains the BETTER price', body.includes('$499'));
  check('does NOT contain GOOD line', !body.includes('GOOD'));
  check('does NOT contain BEST line', !body.includes('BEST'));
  check('still ends with reply CTA', body.trim().endsWith('Reply to schedule.'));
}

// ─── Missing customer name → "Hi there" ──────────────────────────
section('Missing customer name falls back to "Hi there"');
{
  const body = buildQuoteMessage({
    businessName: 'Wheel Rush',
    tireSize: '225/65R17',
    options: [makeOption('good', { customerPrice: 419 })],
  });
  check('starts with "Hi there"', body.startsWith('Hi there,'));
  check('no "there," lowercase opener', !body.startsWith('there,'));
}

// ─── Missing business name → "our team" ──────────────────────────
section('Missing business name falls back to "our team"');
{
  const body = buildQuoteMessage({
    customerName: 'Serge',
    options: [makeOption('good', { customerPrice: 419 })],
  });
  check('uses "our team" fallback', body.includes('our team'));
  check('still greets by name', body.startsWith('Hi Serge,'));
}

// ─── ETA tags ────────────────────────────────────────────────────
section('ETA tag formatting');
{
  const sameDay = buildQuoteMessage({
    customerName: 'S', options: [makeOption('good', { etaDays: 0, customerPrice: 419 })],
    selectedTier: 'good',
  });
  check('ETA 0 → "same day"', sameDay.includes('same day'));

  const nextDay = buildQuoteMessage({
    customerName: 'S', options: [makeOption('good', { etaDays: 1, customerPrice: 419 })],
    selectedTier: 'good',
  });
  check('ETA 1 → "next day"', nextDay.includes('next day'));

  const threeDays = buildQuoteMessage({
    customerName: 'S', options: [makeOption('good', { etaDays: 3, customerPrice: 419 })],
    selectedTier: 'good',
  });
  check('ETA 3 → "3 days"', threeDays.includes('3 days'));

  const tenDays = buildQuoteMessage({
    customerName: 'S', options: [makeOption('good', { etaDays: 10, customerPrice: 419 })],
    selectedTier: 'good',
  });
  check('ETA 10 → "~10 days"', tenDays.includes('~10 days'));

  const noEta = buildQuoteMessage({
    customerName: 'S', options: [makeOption('good', { etaDays: undefined, customerPrice: 419 })],
    selectedTier: 'good',
  });
  check('ETA undefined → no eta tag', !noEta.includes('same day') && !noEta.includes('days'));
}

// ─── serviceForQuote — map quote service type to catalog id ──────
section('serviceForQuote — maps to tire vertical catalog ids');
{
  check('used_tire → Used Tire Replacement',
    serviceForQuote({ serviceType: 'used_tire' }) === 'Used Tire Replacement');
  check('new_tire → New Tire Replacement',
    serviceForQuote({ serviceType: 'new_tire' }) === 'New Tire Replacement');
  check('emergency_replacement → Emergency Highway Service',
    serviceForQuote({ serviceType: 'emergency_replacement' }) === 'Emergency Highway Service');
  check('replacement → Tire Replacement (default)',
    serviceForQuote({ serviceType: 'replacement' }) === 'Tire Replacement');
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
