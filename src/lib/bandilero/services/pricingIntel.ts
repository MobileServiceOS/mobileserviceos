// src/lib/bandilero/services/pricingIntel.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — Pricing Intelligence (DETERMINISTIC, no LLM).
//
//  "Never use AI when deterministic rules can answer." This module is
//  entirely deterministic: it reuses the existing pricing engine
//  (calcQuote / flat.ts) read-only and the pricing digest
//  (buildPricingDigest). It NEVER touches AddJob / job logging.
//
//  Two surfaces:
//   • summary  — per-(service,size) median vs configured price + the
//                suggested adjustment, across recent completed jobs.
//   • quote    — a what-if calculator: given service / size / city /
//                travel / time-of-day / qty, returns suggested price,
//                estimated profit, a confidence score (from comparable
//                job sample size + price spread), and a historical
//                acceptance rate (derived from lead Booked/Lost; LIVE
//                when such leads exist, else NOT_CONNECTED).
// ═══════════════════════════════════════════════════════════════════

import type { Job, Lead, Settings, InventoryItem, QuoteForm } from '@/types';
import { calcQuote, normalizeTireSize } from '@/lib/utils';
import { buildPricingDigest } from '@/lib/pricingInsights';
import { type Metric, live, notConnected } from '../confidence';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// ── Summary ─────────────────────────────────────────────────────────

export interface PricingSummaryRow {
  service: string;
  size: string;
  sales: number;
  median: number;
  configuredMin: number;
  gapPct: number;
  /** Raise-to-min adjustment when underpriced; 0 otherwise. */
  suggestedAdjustment: number;
}

/** Per-(service,size) pricing health across recent completed jobs. */
export function pricingSummary(jobs: ReadonlyArray<Job>, settings: Settings, today: string): PricingSummaryRow[] {
  const digest = buildPricingDigest(jobs, settings, today);
  return digest.groups.map((g) => ({
    service: g.service,
    size: g.size,
    sales: g.sales,
    median: g.medianRevenue,
    configuredMin: g.configuredMin,
    gapPct: g.gapPct,
    suggestedAdjustment: g.gapPct < 0 && g.configuredMin > g.medianRevenue
      ? round2(g.configuredMin - g.medianRevenue)
      : 0,
  }));
}

// ── Calculator ──────────────────────────────────────────────────────

export type TimeOfDay = 'standard' | 'late_night' | 'emergency' | 'weekend';

export interface PricingInput {
  service: string;
  vehicleType: string;
  tireSize: string;
  /** Optional — scopes the comparable-job sample (no city-based pricing
   *  exists in the engine, so this affects confidence, not the price). */
  city?: string;
  miles: number;
  qty: number;
  timeOfDay: TimeOfDay;
}

export interface PricingContext {
  jobs: ReadonlyArray<Job>;
  leads: ReadonlyArray<Lead>;
  inventory: ReadonlyArray<InventoryItem>;
  settings: Settings;
}

export interface PricingQuote {
  suggestedPrice: Metric<number>;
  estimatedProfit: Metric<number>;
  /** 0–100 deterministic score from comparable sample size + spread. */
  confidence: Metric<number>;
  /** Overall lead Booked/Lost win rate; NOT_CONNECTED with no outcomes. */
  acceptanceRate: Metric<number>;
  /** Count of comparable completed jobs (same service + size [+ city]). */
  comparableJobs: number;
  /** Per-unit tire cost derived from inventory for the size (0 if none). */
  unitTireCost: number;
}

/** Cheapest inventory unit cost for a tire size (0 when not stocked). */
export function unitTireCostForSize(inventory: ReadonlyArray<InventoryItem>, size: string): number {
  const norm = normalizeTireSize(size || '');
  if (!norm) return 0;
  let best = Infinity;
  for (const i of inventory || []) {
    if (normalizeTireSize(i.size || '') !== norm) continue;
    const cost = Number(i.unitCost ?? i.cost ?? 0);
    if (cost > 0 && cost < best) best = cost;
  }
  return Number.isFinite(best) ? round2(best) : 0;
}

function timeFlags(t: TimeOfDay): Pick<QuoteForm, 'emergency' | 'lateNight' | 'weekend'> {
  return {
    emergency: t === 'emergency',
    lateNight: t === 'late_night',
    weekend: t === 'weekend',
  };
}

/** Comparable completed jobs: same service + normalized size (+ city if given). */
export function comparableJobs(
  jobs: ReadonlyArray<Job>,
  input: Pick<PricingInput, 'service' | 'tireSize' | 'city'>,
): Job[] {
  const size = normalizeTireSize(input.tireSize || '');
  const city = (input.city || '').trim().toLowerCase();
  return (jobs || []).filter((j) => {
    if (j.status !== 'Completed') return false;
    if (j.service !== input.service) return false;
    if (size && normalizeTireSize(j.tireSize || '') !== size) return false;
    if (city && (j.city || '').trim().toLowerCase() !== city) return false;
    return true;
  });
}

/**
 * Deterministic confidence (0–100) in the suggestion's market fit:
 *   60% from sample size (10+ comparable jobs → full),
 *   40% from price consistency (1 − coefficient of variation).
 * Zero comparable jobs → 0 (honest: nothing to anchor on).
 */
export function confidenceScore(comparables: ReadonlyArray<Job>): number {
  const n = comparables.length;
  const sampleScore = Math.min(1, n / 10);
  let consistency = 0;
  if (n >= 2) {
    const revs = comparables.map((j) => Number(j.revenue) || 0);
    const mean = revs.reduce((t, r) => t + r, 0) / n;
    if (mean > 0) {
      const variance = revs.reduce((t, r) => t + (r - mean) ** 2, 0) / n;
      const cv = Math.sqrt(variance) / mean;
      consistency = Math.max(0, Math.min(1, 1 - cv));
    }
  } else if (n === 1) {
    consistency = 0.5;
  }
  return Math.round(100 * (0.6 * sampleScore + 0.4 * consistency));
}

/** Overall acceptance rate from leads: won (Booked/Closed) ÷ (won + Lost). */
export function acceptanceRate(leads: ReadonlyArray<Lead>): Metric<number> {
  let won = 0;
  let lost = 0;
  for (const l of leads || []) {
    if (l.status === 'Booked' || l.status === 'Closed') won += 1;
    else if (l.status === 'Lost') lost += 1;
  }
  const denom = won + lost;
  if (denom === 0) {
    return notConnected('No quote outcomes yet — needs booked/lost leads', 'leads');
  }
  return live(Math.round((won / denom) * 100), 'leads');
}

/** Deterministic what-if pricing quote. */
export function computePricing(input: PricingInput, ctx: PricingContext): PricingQuote {
  const qty = Math.max(1, Math.floor(Number(input.qty) || 1));
  const unitTireCost = unitTireCostForSize(ctx.inventory, input.tireSize);

  // Note: the pricing engine prices from service + vehicleType +
  // per-unit tireCost + qty + travel + time flags. Tire SIZE is not an
  // engine input — it only drives the inventory-cost lookup (above) and
  // the comparable-job sample (below).
  const form: QuoteForm = {
    service: input.service,
    vehicleType: input.vehicleType,
    miles: Number(input.miles) || 0,
    qty,
    tireCost: unitTireCost, // per-unit; calcFlatQuote scales by qty
    ...timeFlags(input.timeOfDay),
  };

  const q = calcQuote(form, ctx.settings);
  const suggested = round2(q.suggested);
  const profit = round2(q.suggested - q.directCosts);

  const comps = comparableJobs(ctx.jobs, input);

  return {
    suggestedPrice: live(suggested, 'pricing-engine'),
    estimatedProfit: live(profit, 'pricing-engine'),
    confidence: live(confidenceScore(comps), 'jobs'),
    acceptanceRate: acceptanceRate(ctx.leads),
    comparableJobs: comps.length,
    unitTireCost,
  };
}
