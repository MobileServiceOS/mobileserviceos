// ─────────────────────────────────────────────────────────────────────
//  src/lib/tireQuotePricing.ts — Pure pricing math for the Tire Quote
//  Engine. No React, no Firestore — fully unit-testable.
//
//  Formula (per the Phase 1 spec):
//    baseSubtotal =
//        tireCost * quantity
//      + profitTarget          (per category + condition)
//      + travelFee             (flat)
//      + perMileFee * (miles − freeMilesIncluded)   (clamped at 0)
//      + urgencyFee            (when urgency is same-day or emergency)
//      + afterHoursFee         (when urgency is after-hours)
//
//    If showTaxIncludedPrice:
//      customerPrice = round(baseSubtotal * (1 + taxRate))
//    Else:
//      customerPrice = round(baseSubtotal)
//
//    If cashPriceEnabled:
//      cashPrice = round(baseSubtotal)
//      cardPrice = round(baseSubtotal * (1 + taxRate))
//
//    Minimum profit floor: if the computed margin would dip below
//    settings.minimumProfit, bump baseSubtotal upward to preserve it.
//
//  Rounding modes:
//    'nearest 5'  → round to closest multiple of 5 ($75, $80, $85)
//    'nearest 9'  → psychological pricing: $X9 endings ($79, $89, $99)
//    'nearest 10' → round to closest multiple of 10 ($70, $80, $90)
// ─────────────────────────────────────────────────────────────────────

import type {
  TireCategory,
  TireCondition,
  TireQuoteEngineSettings,
  TireQuoteOption,
  TireSupplierPrice,
  Urgency,
  RoundPriceTo,
} from './tireQuoteTypes';

// ─── Public types ──────────────────────────────────────────────────

export interface QuotePriceInput {
  /** Wholesale cost per tire. */
  cost: number;
  quantity: number;
  category: TireCategory;
  condition: TireCondition;
  urgency: Urgency;
  /** Driving miles. Per-mile fee applies above freeMilesIncluded. */
  miles: number;
  settings: TireQuoteEngineSettings;
}

export interface QuotePriceResult {
  /** Pre-rounding, pre-tax subtotal. Useful for debug + breakdown UI. */
  baseSubtotal: number;
  /** Final customer-facing price (rounded; tax-included if configured). */
  customerPrice: number;
  /** Pre-tax cash price (only set when settings.cashPriceEnabled). */
  cashPrice?: number;
  /** Tax-included card price (only set when settings.cashPriceEnabled). */
  cardPrice?: number;
  /** customerPrice − tireSubtotal. Owner/admin only — UI must gate. */
  estimatedProfit: number;
  /** Itemized breakdown for transparent operator-facing view. */
  breakdown: {
    tireSubtotal: number;
    profitTarget: number;
    travelFee: number;
    mileageFee: number;
    urgencyFee: number;
    afterHoursFee: number;
    tax: number;
  };
}

// ─── Rounding ──────────────────────────────────────────────────────

/**
 * Round a price value per the operator's preference.
 *
 *   roundToNearest(77, 5)  === 75
 *   roundToNearest(78, 5)  === 80
 *   roundToNearest(78, 9)  === 79   (psychological — nearest $X9 ending)
 *   roundToNearest(82, 9)  === 79
 *   roundToNearest(85, 9)  === 89
 *   roundToNearest(73, 10) === 70
 *   roundToNearest(75, 10) === 80
 *
 * The "nearest 9" path rounds to the closest 10 then subtracts 1
 * (e.g. 78 → 80 → 79; 82 → 80 → 79; 86 → 90 → 89). Floor at 0 so
 * sub-$5 values don't go negative.
 */
export function roundToNearest(value: number, denom: RoundPriceTo): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (denom === 9) {
    const nearestTen = Math.round(value / 10) * 10;
    return Math.max(0, nearestTen - 1);
  }
  return Math.round(value / denom) * denom;
}

// ─── Internal helpers (pure, unexported) ──────────────────────────

function profitTargetFor(
  category: TireCategory,
  condition: TireCondition,
  s: TireQuoteEngineSettings,
): number {
  // Used tires use the lower used-target regardless of category —
  // a "premium used" tire is still a used tire from a margin
  // perspective.
  if (condition === 'used') return s.defaultProfitTargetUsed;
  if (category === 'premium') return s.defaultProfitTargetPremium;
  return s.defaultProfitTargetNew;
}

function urgencySurcharge(u: Urgency, s: TireQuoteEngineSettings): number {
  if (u === 'same-day') return s.sameDayFee;
  if (u === 'emergency') return s.emergencyFee;
  return 0;
}

function afterHoursSurcharge(u: Urgency, s: TireQuoteEngineSettings): number {
  return u === 'after-hours' ? s.afterHoursFee : 0;
}

function mileageSurcharge(miles: number, s: TireQuoteEngineSettings): number {
  const m = Number.isFinite(miles) ? Math.max(0, miles) : 0;
  const chargeable = Math.max(0, m - s.freeMilesIncluded);
  return chargeable * s.perMileFee;
}

// ─── computeQuotePrice — main entry ───────────────────────────────

/**
 * Compute the customer-facing price for a single tire quote option.
 *
 * Pure function — no side effects. Given identical inputs, always
 * returns identical output. Bad inputs (negative cost, zero qty,
 * NaN) return a zero result rather than throwing — caller can
 * detect via `result.customerPrice === 0`.
 */
export function computeQuotePrice(input: QuotePriceInput): QuotePriceResult {
  const { cost, quantity, category, condition, urgency, miles, settings } = input;

  // Defensive: reject bad inputs without throwing.
  if (
    !Number.isFinite(cost) ||
    !Number.isFinite(quantity) ||
    cost < 0 ||
    quantity <= 0
  ) {
    return {
      baseSubtotal: 0,
      customerPrice: 0,
      estimatedProfit: 0,
      breakdown: {
        tireSubtotal: 0,
        profitTarget: 0,
        travelFee: 0,
        mileageFee: 0,
        urgencyFee: 0,
        afterHoursFee: 0,
        tax: 0,
      },
    };
  }

  const tireSubtotal = cost * quantity;
  const profitTarget = profitTargetFor(category, condition, settings);
  const travelFee = settings.defaultTravelFee;
  const mileageFee = mileageSurcharge(miles, settings);
  const urgencyFee = urgencySurcharge(urgency, settings);
  const afterHoursFee = afterHoursSurcharge(urgency, settings);

  // Sum all non-tire-cost fees — these constitute the gross margin.
  const fees = profitTarget + travelFee + mileageFee + urgencyFee + afterHoursFee;

  // Apply minimum profit floor: if fees < minimumProfit, bump.
  // This is the operator's safety net — guarantees that no quote
  // ships with margin below their floor even if individual targets
  // happened to be set low.
  const adjustedFees = Math.max(fees, settings.minimumProfit);

  const baseSubtotal = tireSubtotal + adjustedFees;

  let customerPrice: number;
  let cashPrice: number | undefined;
  let cardPrice: number | undefined;
  let tax = 0;

  if (settings.showTaxIncludedPrice) {
    tax = baseSubtotal * settings.taxRate;
    customerPrice = roundToNearest(baseSubtotal + tax, settings.roundPriceTo);
  } else {
    customerPrice = roundToNearest(baseSubtotal, settings.roundPriceTo);
  }

  if (settings.cashPriceEnabled) {
    cashPrice = roundToNearest(baseSubtotal, settings.roundPriceTo);
    cardPrice = roundToNearest(baseSubtotal * (1 + settings.taxRate), settings.roundPriceTo);
  }

  // Profit derives from the final rounded customer price, NOT the
  // raw subtotal. Rounding can shift profit slightly up or down;
  // operator sees the actual margin they'll capture.
  const estimatedProfit = customerPrice - tireSubtotal;

  return {
    baseSubtotal,
    customerPrice,
    cashPrice,
    cardPrice,
    estimatedProfit,
    breakdown: {
      tireSubtotal,
      profitTarget,
      travelFee,
      mileageFee,
      urgencyFee,
      afterHoursFee,
      tax,
    },
  };
}

// ─── Good/Better/Best selection ────────────────────────────────────

export interface GoodBetterBestPicks {
  good: TireSupplierPrice | null;
  better: TireSupplierPrice | null;
  best: TireSupplierPrice | null;
}

/**
 * From a list of supplier prices for the same tire size, pick one
 * representative per category to form Good/Better/Best.
 *
 *   good   ← cheapest in-stock budget
 *   better ← cheapest in-stock midrange   (the "Most Popular" pick)
 *   best   ← cheapest in-stock premium
 *
 * "Cheapest" within a category is intentional — the operator's
 * picker already drew the category boundary by tagging the
 * inventory; within a tier we minimize the customer's price.
 *
 * Returns nulls for tiers with no in-stock matches. Caller can
 * decide whether to render a partial Good/Better/Best card grid
 * or substitute another tier into the empty slot.
 */
export function selectGoodBetterBest(
  prices: ReadonlyArray<TireSupplierPrice>,
): GoodBetterBestPicks {
  if (!prices || prices.length === 0) {
    return { good: null, better: null, best: null };
  }

  const pickCheapestInStock = (
    items: ReadonlyArray<TireSupplierPrice>,
  ): TireSupplierPrice | null => {
    const inStock = items.filter((p) => Number(p.quantityAvailable) > 0);
    if (inStock.length === 0) return null;
    return inStock.reduce((min, cur) => (cur.cost < min.cost ? cur : min));
  };

  return {
    good: pickCheapestInStock(prices.filter((p) => p.category === 'budget')),
    better: pickCheapestInStock(prices.filter((p) => p.category === 'midrange')),
    best: pickCheapestInStock(prices.filter((p) => p.category === 'premium')),
  };
}

/**
 * Build a TireQuoteOption[] for the given supplier prices + quote
 * inputs. Each tier with an in-stock match gets a fully-priced
 * option; empty tiers are dropped. The array length is 0–3.
 *
 * This is the integration point the Phase 3 UI calls when the user
 * taps "Build Good/Better/Best Quote" — supplier prices come from
 * the Phase 2 supplier database listener, settings from the
 * pricingSettings/tireQuoteEngine doc.
 */
export function buildQuoteOptionsFromPrices(
  prices: ReadonlyArray<TireSupplierPrice>,
  quantity: number,
  urgency: Urgency,
  miles: number,
  settings: TireQuoteEngineSettings,
): TireQuoteOption[] {
  const picks = selectGoodBetterBest(prices);

  const buildOption = (
    tier: 'good' | 'better' | 'best',
    price: TireSupplierPrice | null,
  ): TireQuoteOption | null => {
    if (!price) return null;
    const pricing = computeQuotePrice({
      cost: price.cost,
      quantity,
      category: price.category,
      condition: price.condition,
      urgency,
      miles,
      settings,
    });
    if (pricing.customerPrice === 0) return null; // bad-input safety
    return {
      tier,
      supplierPriceId: price.id,
      supplierName: price.supplierName,
      brand: price.brand,
      model: price.model,
      tireSize: price.tireSize,
      condition: price.condition,
      category: price.category,
      costPerTire: price.cost,
      quantity,
      customerPrice: pricing.customerPrice,
      estimatedProfit: pricing.estimatedProfit,
      cashPrice: pricing.cashPrice,
      cardPrice: pricing.cardPrice,
    };
  };

  const result: TireQuoteOption[] = [];
  const good = buildOption('good', picks.good);
  const better = buildOption('better', picks.better);
  const best = buildOption('best', picks.best);
  if (good) result.push(good);
  if (better) result.push(better);
  if (best) result.push(best);
  return result;
}
