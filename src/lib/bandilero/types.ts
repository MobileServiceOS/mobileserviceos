// src/lib/bandilero/types.ts
// ═══════════════════════════════════════════════════════════════════
//  Bandilero — shared shapes for the daily briefing + actions.
// ═══════════════════════════════════════════════════════════════════

import type { Metric, LabeledMetric } from './confidence';

/** Connectivity snapshot — which data sources are actually wired. */
export interface Connectivity {
  /** LLM proxy configured (VITE_AI_PROXY_URL set). */
  ai: boolean;
  /** Twilio voice/SMS wired (operational twilioPhoneNumber present). */
  twilio: boolean;
  /** Review automation usable (enabled + a review link set). */
  reviews: boolean;
  /** Google Business Profile API — absent today, always false. */
  gbp: boolean;
  /** Search Console / SEO — absent today, always false. */
  seo: boolean;
  /** Dispatch/ETA — no coordinates on jobs today, always false. */
  dispatch: boolean;
}

/**
 * A briefing section groups related metrics under a heading.
 * `restricted` is an ACCESS overlay (tech can't see financials) — it is
 * NOT a confidence state. When restricted, `metrics` is withheld
 * (empty) and the UI renders a "restricted" card, never a fake value.
 */
export interface BriefingSection {
  key: string;
  title: string;
  metrics: LabeledMetric[];
  /** True when the viewer lacks permission to see these values. */
  restricted?: boolean;
}

/** Severity drives visual weight; impact drives Top-3 ordering. */
export type ActionSeverity = 'high' | 'medium' | 'low';

/**
 * An Action is an alert backed by a real number and its source.
 * `impact` is the estimated (or live) DOLLAR impact used to rank the
 * Top 3 Actions. Every action traces to a metric — never a bare claim.
 */
export interface Action {
  id: string;
  title: string;
  detail: string;
  severity: ActionSeverity;
  /** Dollar impact metric (LIVE for real $, ESTIMATED for modeled). */
  impact: Metric<number>;
  /** Provenance label, e.g. 'jobs', 'leads', 'inventory'. */
  source: string;
}

export interface BriefingGreeting {
  /** Per-user display name (auth/member), or null if unknown. */
  operatorName: string | null;
  /** Tenant business name from brand/settings, or null. */
  businessName: string | null;
  /** e.g. "Saturday, June 7". */
  dateLabel: string;
}

export interface Briefing {
  greeting: BriefingGreeting;
  sections: BriefingSection[];
  /** Alerts sorted by estimated dollar impact, top 3. Empty + flagged
   *  via `actionsRestricted` when the viewer lacks financial access. */
  topActions: Action[];
  /** True when Top-3 Actions were withheld for lacking financial access. */
  actionsRestricted?: boolean;
  /** LLM-written narrative. NOT_CONNECTED when AI is off. */
  narrative: Metric<string>;
  /** The 'YYYY-MM-DD' the briefing was computed for. */
  generatedFor: string;
  /** The connectivity snapshot used to build it. */
  connectivity: Connectivity;
}
