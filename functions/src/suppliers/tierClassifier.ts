import { SupplierTireResult, TierBundle } from './supplierTypes';

// Brand → tier classification. Lowercased keys for case-insensitive
// matching. When a brand isn't on any list, the result is "unknown"
// and the tier-bundle picker falls back to price percentile.

const PREMIUM_BRANDS = new Set<string>([
  'michelin', 'bridgestone', 'continental', 'pirelli', 'goodyear',
  'dunlop', 'yokohama', 'hankook', 'toyo', 'falken',
]);

const MID_BRANDS = new Set<string>([
  'kumho', 'nexen', 'cooper', 'general', 'firestone',
  'bfgoodrich', 'uniroyal', 'sumitomo', 'laufenn',
]);

const BUDGET_BRANDS = new Set<string>([
  'lexani', 'lionhart', 'arroyo', 'ironman', 'westlake',
  'milestar', 'crosswind', 'waterfall', 'prinx', 'fullway',
]);

export type BrandTier = 'premium' | 'mid' | 'budget' | 'unknown';

export function brandTier(brand: string): BrandTier {
  const key = brand.toLowerCase().trim();
  if (PREMIUM_BRANDS.has(key)) return 'premium';
  if (MID_BRANDS.has(key)) return 'mid';
  if (BUDGET_BRANDS.has(key)) return 'budget';
  return 'unknown';
}

// Pick the three tier representatives from a list of supplier results.
//
//   cheapest : lowest-cost result overall (always present if any result)
//   premium  : highest-cost premium-brand result; falls back to top
//              price percentile when no premium brand is present
//   mid      : mid-brand result closest to the median price; falls
//              back to median-price result when no mid brand is present
//
// If only 1-2 results exist, mid and/or premium may be null. That's
// per spec — empty tiers are explicit, not synthesized.
export function classifyTiers(results: SupplierTireResult[]): TierBundle {
  if (results.length === 0) {
    return { cheapest: null, mid: null, premium: null };
  }

  const sorted = [...results].sort((a, b) => a.cost - b.cost);
  const cheapest = sorted[0];

  // Premium: highest-cost premium-brand result, else top price percentile
  const premiumByBrand = sorted.filter((r) => brandTier(r.brand) === 'premium');
  let premium: SupplierTireResult | null = null;
  if (premiumByBrand.length > 0) {
    premium = premiumByBrand[premiumByBrand.length - 1];
  } else if (sorted.length >= 3) {
    premium = sorted[sorted.length - 1];
  }

  // Mid: mid-brand result closest to median, else median-priced result
  const medianIdx = Math.floor(sorted.length / 2);
  const medianPrice = sorted[medianIdx].cost;
  const midByBrand = sorted.filter((r) => brandTier(r.brand) === 'mid');
  let mid: SupplierTireResult | null = null;
  if (midByBrand.length > 0) {
    mid = midByBrand.reduce((best, cur) =>
      Math.abs(cur.cost - medianPrice) < Math.abs(best.cost - medianPrice) ? cur : best
    );
  } else if (sorted.length >= 3) {
    mid = sorted[medianIdx];
  }

  // Dedup: if mid collides with cheapest or premium, drop mid
  if (mid && (mid === cheapest || mid === premium)) mid = null;
  // Dedup: if premium collides with cheapest (2 results only), drop premium
  if (premium && premium === cheapest) premium = null;

  return { cheapest, mid, premium };
}
