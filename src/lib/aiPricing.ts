// src/lib/aiPricing.ts
// ═══════════════════════════════════════════════════════════════════
//  AI Price Check — pure helpers (roadmap feature #3).
//
//  buildPricingInput()    — assembles the proxy payload, including a
//                           compact statistical digest of the
//                           business's own job history (no per-job
//                           rows, so no customer PII leaves the app).
//  parsePricingResponse() — parses + sanity-checks Claude's reply.
//
//  Spec: docs/superpowers/specs/2026-05-22-ai-pricing-design.md
// ═══════════════════════════════════════════════════════════════════

import type { Job, QuoteForm, QuoteResult } from '@/types';

// Recency bound — the digest is computed over the most recent N
// matching-service jobs. Old prices are stale; 50 is well past the
// count needed for a stable median.
const HISTORY_WINDOW = 50;

export interface PricingHistoryDigest {
  recentJobCount: number;
  avgPrice: number | null;
  medianPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  lastJobDate: string | null;
  recentEmergencyAvg: number | null;
  recentHighwayAvg: number | null;
  recentLateNightAvg: number | null;
}

export interface PricingInput {
  service: string;
  vehicleType: string;
  vertical: string;
  conditions: string[];
  deterministicQuote: { suggested: number; premium: number; directCosts: number };
  history: PricingHistoryDigest;
}

export type PricingResult =
  | { ok: true; price: number; rationale: string }
  | { ok: false; error: string };

function num(v: number | string): number {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return Math.round(xs.reduce((s, x) => s + x, 0) / xs.length);
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function digest(jobs: Job[]): PricingHistoryDigest {
  const prices = jobs.map((j) => num(j.revenue));
  const condAvg = (flag: 'emergency' | 'highway' | 'lateNight'): number | null =>
    mean(jobs.filter((j) => j[flag]).map((j) => num(j.revenue)));
  return {
    recentJobCount: jobs.length,
    avgPrice: mean(prices),
    medianPrice: median(prices),
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    lastJobDate: jobs.length
      ? jobs.reduce((m, j) => (j.date > m ? j.date : m), jobs[0].date)
      : null,
    recentEmergencyAvg: condAvg('emergency'),
    recentHighwayAvg: condAvg('highway'),
    recentLateNightAvg: condAvg('lateNight'),
  };
}

export function buildPricingInput(
  form: QuoteForm,
  quote: QuoteResult,
  completedJobs: Job[],
  vertical: string,
): PricingInput {
  const conditions: string[] = [];
  if (form.emergency) conditions.push('emergency');
  if (form.lateNight) conditions.push('lateNight');
  if (form.highway) conditions.push('highway');
  if (form.weekend) conditions.push('weekend');

  const matching = completedJobs
    .filter((j) => j.service === form.service)
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, HISTORY_WINDOW);

  return {
    service: form.service,
    vehicleType: form.vehicleType,
    vertical,
    conditions,
    deterministicQuote: {
      suggested: quote.suggested,
      premium: quote.premium,
      directCosts: quote.directCosts,
    },
    history: digest(matching),
  };
}

export function parsePricingResponse(text: string, quote: QuoteResult): PricingResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, error: 'unparseable' };
  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return { ok: false, error: 'unparseable' };
  }
  const o = obj as { price?: unknown; rationale?: unknown };
  const price = typeof o.price === 'number' ? o.price : NaN;
  const rationale = typeof o.rationale === 'string' ? o.rationale.trim() : '';
  if (!Number.isFinite(price) || price <= 0 || !rationale) {
    return { ok: false, error: 'malformed' };
  }
  // Sanity band — catches a hallucinated extra digit or a
  // loss-making price. directCosts 0 ⇒ the floor is simply "> 0".
  const floor = quote.directCosts > 0 ? quote.directCosts : 0;
  const ceil = quote.premium > 0 ? quote.premium * 3 : Infinity;
  if (price < floor || price > ceil) {
    return { ok: false, error: 'out_of_range' };
  }
  return { ok: true, price, rationale };
}
