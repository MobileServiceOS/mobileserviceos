// tests/tireQuotePricing.test.ts
// Run: npx tsx tests/tireQuotePricing.test.ts

import {
  computeQuotePrice,
  roundToNearest,
  selectGoodBetterBest,
  buildQuoteOptionsFromPrices,
} from '@/lib/tireQuotePricing';
import {
  DEFAULT_TIRE_QUOTE_ENGINE_SETTINGS,
  type TireQuoteEngineSettings,
  type TireSupplierPrice,
} from '@/lib/tireQuoteTypes';

let passed = 0;
let failed = 0;
const check = (label: string, cond: boolean, detail?: string): void => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? `  — ${detail}` : ''}`); }
};
const section = (t: string): void => console.log(`\n┌─ ${t} ─────────────────────`);

// ─── Settings fixtures ─────────────────────────────────────────────
const S_DEFAULT: TireQuoteEngineSettings = { ...DEFAULT_TIRE_QUOTE_ENGINE_SETTINGS };

const S_TAX_INCLUDED: TireQuoteEngineSettings = {
  ...S_DEFAULT,
  showTaxIncludedPrice: true,
};

const S_CASH_PRICE: TireQuoteEngineSettings = {
  ...S_DEFAULT,
  cashPriceEnabled: true,
};

const S_ROUND_5: TireQuoteEngineSettings = { ...S_DEFAULT, roundPriceTo: 5 };
const S_ROUND_10: TireQuoteEngineSettings = { ...S_DEFAULT, roundPriceTo: 10 };

// ─── roundToNearest ────────────────────────────────────────────────
section('roundToNearest');
check('77 nearest 5 → 75', roundToNearest(77, 5) === 75);
check('78 nearest 5 → 80', roundToNearest(78, 5) === 80);
check('78 nearest 9 → 79', roundToNearest(78, 9) === 79);
check('82 nearest 9 → 79', roundToNearest(82, 9) === 79);
check('85 nearest 9 → 89', roundToNearest(85, 9) === 89);
check('86 nearest 9 → 89', roundToNearest(86, 9) === 89);
check('73 nearest 10 → 70', roundToNearest(73, 10) === 70);
check('75 nearest 10 → 80', roundToNearest(75, 10) === 80);
check('0 stays 0', roundToNearest(0, 9) === 0);
check('-5 clamps to 0', roundToNearest(-5, 9) === 0);
check('NaN clamps to 0', roundToNearest(Number.NaN, 9) === 0);
check('4 nearest 9 → 0 (floor)', roundToNearest(4, 9) === 0);

// ─── computeQuotePrice: basic formula ──────────────────────────────
section('Basic formula — no urgency, no travel surcharge');
{
  // 1 tire × $100 cost + $80 new-profit + $25 travel + 0 mileage + 0 urgency = $205 → rounded to $199 (nearest 9)
  const result = computeQuotePrice({
    cost: 100,
    quantity: 1,
    category: 'midrange',
    condition: 'new',
    urgency: 'standard',
    miles: 0,
    settings: S_DEFAULT,
  });
  check('baseSubtotal = 205', result.baseSubtotal === 205);
  check('customerPrice = 209 (rounded to nearest 9)', result.customerPrice === 209);
  check('estimatedProfit = 109 ($209 - $100 cost)', result.estimatedProfit === 109);
  check('breakdown.profitTarget = 80', result.breakdown.profitTarget === 80);
  check('breakdown.travelFee = 25', result.breakdown.travelFee === 25);
  check('breakdown.urgencyFee = 0', result.breakdown.urgencyFee === 0);
  check('breakdown.tax = 0 (not included)', result.breakdown.tax === 0);
  check('cashPrice undefined (not enabled)', result.cashPrice === undefined);
}

// ─── Tax-included pricing ──────────────────────────────────────────
section('Tax-included pricing');
{
  const result = computeQuotePrice({
    cost: 100,
    quantity: 1,
    category: 'midrange',
    condition: 'new',
    urgency: 'standard',
    miles: 0,
    settings: S_TAX_INCLUDED,
  });
  // baseSubtotal 205 + 7% tax = 219.35 → rounded to 219 (nearest 9)
  check('customerPrice includes tax', result.customerPrice === 219);
  check('breakdown.tax ≈ 14.35', Math.abs(result.breakdown.tax - 14.35) < 0.01);
  check('estimatedProfit reflects tax-included price', result.estimatedProfit === 119);
}

// ─── Cash + card split pricing ─────────────────────────────────────
section('Cash + card price split');
{
  const result = computeQuotePrice({
    cost: 100,
    quantity: 1,
    category: 'midrange',
    condition: 'new',
    urgency: 'standard',
    miles: 0,
    settings: S_CASH_PRICE,
  });
  check('cashPrice (pre-tax) = 209', result.cashPrice === 209);
  check('cardPrice (with tax) = 219', result.cardPrice === 219);
  check('customerPrice mirrors pre-tax (showTaxIncluded=false)', result.customerPrice === 209);
}

// ─── Quantity scaling ──────────────────────────────────────────────
section('Quantity scaling');
{
  // 4 tires × $100 cost + $80 profit + $25 travel = $505. nearest 9:
  // round(505/10)*10 = 510, minus 1 = 509.
  const result = computeQuotePrice({
    cost: 100,
    quantity: 4,
    category: 'midrange',
    condition: 'new',
    urgency: 'standard',
    miles: 0,
    settings: S_DEFAULT,
  });
  check('4-tire baseSubtotal = 505', result.baseSubtotal === 505);
  check('4-tire customerPrice = 509 (nearest 9)', result.customerPrice === 509);
  check('estimatedProfit = 109 ($509 - $400 tire cost)', result.estimatedProfit === 109);
}

// ─── Used vs new profit targets ────────────────────────────────────
section('Used vs new profit targets');
{
  // Used: 1 × $50 + $40 used-profit + $25 travel = $115. nearest 9:
  // round(115/10)*10 = 120, minus 1 = 119.
  const used = computeQuotePrice({
    cost: 50, quantity: 1, category: 'midrange', condition: 'used',
    urgency: 'standard', miles: 0, settings: S_DEFAULT,
  });
  check('used customerPrice = 119', used.customerPrice === 119);
  // Premium new: 1 × $100 + $120 premium-profit + $25 travel = $245 → $249 nearest 9
  const premium = computeQuotePrice({
    cost: 100, quantity: 1, category: 'premium', condition: 'new',
    urgency: 'standard', miles: 0, settings: S_DEFAULT,
  });
  check('premium customerPrice = 249', premium.customerPrice === 249);
}

// ─── Urgency surcharges ────────────────────────────────────────────
section('Urgency surcharges');
{
  const sameDay = computeQuotePrice({
    cost: 100, quantity: 1, category: 'midrange', condition: 'new',
    urgency: 'same-day', miles: 0, settings: S_DEFAULT,
  });
  // 100 + 80 + 25 + 25 same-day = 230 → 229 nearest 9
  check('same-day adds $25', sameDay.customerPrice === 229);
  check('breakdown.urgencyFee = 25', sameDay.breakdown.urgencyFee === 25);

  const emergency = computeQuotePrice({
    cost: 100, quantity: 1, category: 'midrange', condition: 'new',
    urgency: 'emergency', miles: 0, settings: S_DEFAULT,
  });
  // 100 + 80 + 25 + 50 emergency = 255 → 259 nearest 9
  check('emergency adds $50', emergency.customerPrice === 259);
  check('breakdown.urgencyFee = 50', emergency.breakdown.urgencyFee === 50);

  const afterHours = computeQuotePrice({
    cost: 100, quantity: 1, category: 'midrange', condition: 'new',
    urgency: 'after-hours', miles: 0, settings: S_DEFAULT,
  });
  // 100 + 80 + 25 + 75 after-hours = 280 → 279 nearest 9
  check('after-hours adds $75', afterHours.customerPrice === 279);
  check('breakdown.afterHoursFee = 75', afterHours.breakdown.afterHoursFee === 75);
  check('after-hours urgencyFee = 0 (it\'s its own line)', afterHours.breakdown.urgencyFee === 0);
}

// ─── Mileage fee with free-miles threshold ─────────────────────────
section('Mileage fee with freeMilesIncluded');
{
  const withPerMile: TireQuoteEngineSettings = {
    ...S_DEFAULT,
    perMileFee: 1.5,
    freeMilesIncluded: 10,
  };
  // Within free miles → no charge
  const inFree = computeQuotePrice({
    cost: 100, quantity: 1, category: 'midrange', condition: 'new',
    urgency: 'standard', miles: 8, settings: withPerMile,
  });
  check('8 miles within freeMilesIncluded → no mileage fee', inFree.breakdown.mileageFee === 0);

  // 25 miles: chargeable = 15, fee = 22.50
  const overFree = computeQuotePrice({
    cost: 100, quantity: 1, category: 'midrange', condition: 'new',
    urgency: 'standard', miles: 25, settings: withPerMile,
  });
  check('25 miles → $22.50 mileage fee', overFree.breakdown.mileageFee === 22.5);
  // 100 + 80 + 25 + 22.5 = 227.5 → 229 nearest 9
  check('mileage fee flows into customerPrice', overFree.customerPrice === 229);
}

// ─── Minimum profit floor ──────────────────────────────────────────
section('Minimum profit floor');
{
  // Settings with very low profit targets — minimum profit floor should kick in
  const lowMargin: TireQuoteEngineSettings = {
    ...S_DEFAULT,
    defaultProfitTargetNew: 5,    // dangerously low
    defaultTravelFee: 0,
    minimumProfit: 100,            // operator's safety net
  };
  // Without floor: 100 + 5 + 0 = 105 → profit only $5
  // With floor: bumped to 100 + 100 = 200 → $199 nearest 9
  const result = computeQuotePrice({
    cost: 100, quantity: 1, category: 'midrange', condition: 'new',
    urgency: 'standard', miles: 0, settings: lowMargin,
  });
  check('minimum profit floor bumps subtotal', result.baseSubtotal === 200);
  check('customerPrice respects floor', result.customerPrice === 199);
  check('estimatedProfit = 99 (close to $100 floor after rounding)', result.estimatedProfit === 99);
}

// ─── Bad inputs (defensive) ───────────────────────────────────────
section('Bad inputs return zero (no throw)');
{
  const negCost = computeQuotePrice({
    cost: -50, quantity: 1, category: 'midrange', condition: 'new',
    urgency: 'standard', miles: 0, settings: S_DEFAULT,
  });
  check('negative cost → 0', negCost.customerPrice === 0);

  const zeroQty = computeQuotePrice({
    cost: 100, quantity: 0, category: 'midrange', condition: 'new',
    urgency: 'standard', miles: 0, settings: S_DEFAULT,
  });
  check('zero quantity → 0', zeroQty.customerPrice === 0);

  const nanCost = computeQuotePrice({
    cost: Number.NaN, quantity: 1, category: 'midrange', condition: 'new',
    urgency: 'standard', miles: 0, settings: S_DEFAULT,
  });
  check('NaN cost → 0', nanCost.customerPrice === 0);
}

// ─── Rounding mode variants ────────────────────────────────────────
section('Rounding modes (5, 10) flow into customerPrice');
{
  // baseSubtotal = 205. nearest 5 = 205. nearest 10 = 210.
  const r5 = computeQuotePrice({
    cost: 100, quantity: 1, category: 'midrange', condition: 'new',
    urgency: 'standard', miles: 0, settings: S_ROUND_5,
  });
  check('round-5 keeps 205', r5.customerPrice === 205);

  const r10 = computeQuotePrice({
    cost: 100, quantity: 1, category: 'midrange', condition: 'new',
    urgency: 'standard', miles: 0, settings: S_ROUND_10,
  });
  check('round-10 → 210', r10.customerPrice === 210);
}

// ─── selectGoodBetterBest ──────────────────────────────────────────
section('selectGoodBetterBest — pick cheapest in-stock per tier');
{
  const fixtures: TireSupplierPrice[] = [
    { id: 'b1', supplierName: 'ATD', tireSize: '225/65R17', brand: 'Sentury', model: 'Touring', cost: 50, quantityAvailable: 5, condition: 'new', category: 'budget', runFlat: false, evRated: false, xlLoad: false, lastUpdated: '2026-05-28', createdBy: 'u1' },
    { id: 'b2', supplierName: 'ATD', tireSize: '225/65R17', brand: 'Atlas', model: 'Force', cost: 60, quantityAvailable: 3, condition: 'new', category: 'budget', runFlat: false, evRated: false, xlLoad: false, lastUpdated: '2026-05-28', createdBy: 'u1' },
    { id: 'm1', supplierName: 'ATD', tireSize: '225/65R17', brand: 'Goodyear', model: 'Assurance', cost: 95, quantityAvailable: 4, condition: 'new', category: 'midrange', runFlat: false, evRated: false, xlLoad: false, lastUpdated: '2026-05-28', createdBy: 'u1' },
    { id: 'p1', supplierName: 'ATD', tireSize: '225/65R17', brand: 'Michelin', model: 'Defender 2', cost: 140, quantityAvailable: 2, condition: 'new', category: 'premium', runFlat: false, evRated: false, xlLoad: false, lastUpdated: '2026-05-28', createdBy: 'u1' },
    { id: 'p2', supplierName: 'ATD', tireSize: '225/65R17', brand: 'Michelin', model: 'Pilot', cost: 180, quantityAvailable: 0, condition: 'new', category: 'premium', runFlat: false, evRated: false, xlLoad: false, lastUpdated: '2026-05-28', createdBy: 'u1' },
  ];
  const picks = selectGoodBetterBest(fixtures);
  check('good = cheapest budget (b1 at $50)', picks.good?.id === 'b1');
  check('better = the midrange entry', picks.better?.id === 'm1');
  check('best = in-stock premium (p1, NOT out-of-stock p2)', picks.best?.id === 'p1');
}

section('selectGoodBetterBest — empty / out-of-stock returns nulls');
{
  const allOutOfStock: TireSupplierPrice[] = [
    { id: 'o1', supplierName: 'ATD', tireSize: '225/65R17', brand: 'X', model: 'Y', cost: 50, quantityAvailable: 0, condition: 'new', category: 'budget', runFlat: false, evRated: false, xlLoad: false, lastUpdated: '2026-05-28', createdBy: 'u1' },
  ];
  const picks = selectGoodBetterBest(allOutOfStock);
  check('good = null when all out of stock', picks.good === null);
  check('better = null when no midrange', picks.better === null);
  check('best = null when no premium', picks.best === null);

  const empty = selectGoodBetterBest([]);
  check('empty array → all nulls', empty.good === null && empty.better === null && empty.best === null);
}

// ─── buildQuoteOptionsFromPrices ──────────────────────────────────
section('buildQuoteOptionsFromPrices — composes pricing per tier');
{
  const fixtures: TireSupplierPrice[] = [
    { id: 'b1', supplierName: 'ATD', tireSize: '225/65R17', brand: 'Sentury', model: 'Touring', cost: 50, quantityAvailable: 5, condition: 'new', category: 'budget', runFlat: false, evRated: false, xlLoad: false, lastUpdated: '2026-05-28', createdBy: 'u1' },
    { id: 'm1', supplierName: 'ATD', tireSize: '225/65R17', brand: 'Goodyear', model: 'Assurance', cost: 95, quantityAvailable: 4, condition: 'new', category: 'midrange', runFlat: false, evRated: false, xlLoad: false, lastUpdated: '2026-05-28', createdBy: 'u1' },
    { id: 'p1', supplierName: 'ATD', tireSize: '225/65R17', brand: 'Michelin', model: 'Defender 2', cost: 140, quantityAvailable: 2, condition: 'new', category: 'premium', runFlat: false, evRated: false, xlLoad: false, lastUpdated: '2026-05-28', createdBy: 'u1' },
  ];
  const options = buildQuoteOptionsFromPrices(fixtures, 4, 'standard', 0, S_DEFAULT);
  check('builds 3 options (one per tier)', options.length === 3);
  check('good tier first', options[0].tier === 'good');
  check('better tier middle', options[1].tier === 'better');
  check('best tier last', options[2].tier === 'best');
  check('good references b1', options[0].supplierPriceId === 'b1');
  check('costPerTire copied from supplier price', options[0].costPerTire === 50);
  check('quantity threads through', options[0].quantity === 4);
}

section('buildQuoteOptionsFromPrices — partial tier coverage');
{
  // Only budget + premium, no midrange in stock
  const fixtures: TireSupplierPrice[] = [
    { id: 'b1', supplierName: 'ATD', tireSize: '225/65R17', brand: 'Sentury', model: 'Touring', cost: 50, quantityAvailable: 5, condition: 'new', category: 'budget', runFlat: false, evRated: false, xlLoad: false, lastUpdated: '2026-05-28', createdBy: 'u1' },
    { id: 'p1', supplierName: 'ATD', tireSize: '225/65R17', brand: 'Michelin', model: 'Defender 2', cost: 140, quantityAvailable: 2, condition: 'new', category: 'premium', runFlat: false, evRated: false, xlLoad: false, lastUpdated: '2026-05-28', createdBy: 'u1' },
  ];
  const options = buildQuoteOptionsFromPrices(fixtures, 1, 'standard', 0, S_DEFAULT);
  check('builds 2 options when midrange empty', options.length === 2);
  check('skipped tier is filtered out (no nulls)', options.every((o) => o !== null));
  check('first option is good', options[0].tier === 'good');
  check('second option is best (better is skipped)', options[1].tier === 'best');
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
