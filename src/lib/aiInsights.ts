// src/lib/aiInsights.ts
// ═══════════════════════════════════════════════════════════════════
//  AI Insights — pure helpers (roadmap feature #14).
//
//  buildInsightsInput()    — trims the computeInsights() result into a
//                            compact, rounded, PII-free digest.
//  parseInsightsResponse() — parses Claude's reply and enforces the
//                            numeric grounding guard: a bullet
//                            survives only if every number it cites
//                            is a real digest figure.
//
//  Spec: docs/superpowers/specs/2026-05-22-ai-insights-design.md
// ═══════════════════════════════════════════════════════════════════

import type { Insights } from '@/lib/insights';

export interface InsightsDigest {
  weeks: Array<{ week: string; revenue: number; profit: number }>;
  totalRevenue8w: number;
  totalProfit8w: number;
  topServices: Array<{ service: string; revenue: number; profit: number; count: number }>;
  topSources: Array<{ source: string; revenue: number; count: number }>;
  topCities: Array<{ city: string; profit: number; count: number }>;
  repeatCustomerPct: number;
  repeatCustomers: number;
  totalCustomers: number;
  unpaid: Array<{ bucket: string; count: number; total: number }>;
  totalUnpaid: number;
}

export type InsightsResult =
  | { ok: true; bullets: string[] }
  | { ok: false; error: string };

const TOP_N = 5;
const MAX_BULLETS = 6;
const r = Math.round;

export function buildInsightsInput(insights: Insights): InsightsDigest {
  return {
    weeks: insights.revenueTrend.map((w) => ({
      week: w.weekStart, revenue: r(w.revenue), profit: r(w.profit),
    })),
    totalRevenue8w: r(insights.revenueTrend.reduce((s, w) => s + w.revenue, 0)),
    totalProfit8w: r(insights.revenueTrend.reduce((s, w) => s + w.profit, 0)),
    topServices: insights.topServices.slice(0, TOP_N).map((s) => ({
      service: s.service, revenue: r(s.revenue), profit: r(s.profit), count: s.count,
    })),
    topSources: insights.topSources.slice(0, TOP_N).map((s) => ({
      source: s.source, revenue: r(s.revenue), count: s.count,
    })),
    topCities: insights.topCities.slice(0, TOP_N).map((c) => ({
      city: c.city, profit: r(c.profit), count: c.count,
    })),
    repeatCustomerPct: insights.repeat.pct,
    repeatCustomers: insights.repeat.repeat,
    totalCustomers: insights.repeat.total,
    unpaid: insights.unpaidAging.map((a) => ({
      bucket: a.bucket, count: a.count, total: r(a.total),
    })),
    totalUnpaid: r(insights.unpaidAging.reduce((s, a) => s + a.total, 0)),
  };
}

// Every numeric value in the digest — the only numbers a grounded
// bullet is allowed to cite.
function digestNumbers(d: InsightsDigest): Set<number> {
  const set = new Set<number>();
  const add = (n: number): void => { if (Number.isFinite(n)) set.add(n); };
  for (const w of d.weeks) { add(w.revenue); add(w.profit); }
  add(d.totalRevenue8w); add(d.totalProfit8w);
  for (const s of d.topServices) { add(s.revenue); add(s.profit); add(s.count); }
  for (const s of d.topSources) { add(s.revenue); add(s.count); }
  for (const c of d.topCities) { add(c.profit); add(c.count); }
  add(d.repeatCustomerPct); add(d.repeatCustomers); add(d.totalCustomers);
  for (const u of d.unpaid) { add(u.count); add(u.total); }
  add(d.totalUnpaid);
  return set;
}

export function parseInsightsResponse(text: string, digest: InsightsDigest): InsightsResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, error: 'unparseable' };
  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return { ok: false, error: 'unparseable' };
  }
  const raw = (obj as { bullets?: unknown }).bullets;
  if (!Array.isArray(raw)) return { ok: false, error: 'malformed' };

  const numbers = digestNumbers(digest);
  const seen = new Set<string>();
  const bullets: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const bullet = item.trim();
    if (!bullet || seen.has(bullet)) continue;
    // Grounding guard — keep the bullet only if it makes a numeric
    // claim AND every number it cites is a real digest figure.
    const tokens = bullet.match(/\d[\d,]*(?:\.\d+)?/g);
    if (!tokens) continue;
    const grounded = tokens.every((t) => numbers.has(parseFloat(t.replace(/,/g, ''))));
    if (!grounded) continue;
    seen.add(bullet);
    bullets.push(bullet);
    if (bullets.length >= MAX_BULLETS) break;
  }
  if (!bullets.length) return { ok: false, error: 'ungrounded' };
  return { ok: true, bullets };
}
